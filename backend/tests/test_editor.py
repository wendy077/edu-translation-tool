from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from app.database import projects, revisions, segments
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "test.sqlite3")) as instance:
        yield instance


def save(client, text, revision=0, project_id=1, segment_id=1):
    return client.put(f"/api/projects/{project_id}/segments/{segment_id}", json={
        "target_text": text, "base_revision": revision,
    })


def test_seed_and_persistence_across_restarts(tmp_path):
    path = tmp_path / "restart.sqlite3"
    exact_text = '  A oficina começa às 10:30.\n«Tradução»\t\n '
    with TestClient(create_app(path)) as client:
        project = client.get("/api/projects/1").json()
        assert [s["position"] for s in project["segments"]] == [1, 2, 3]
        assert all(s["target_text"] == "" and s["revision"] == 0 for s in project["segments"])
        response = save(client, exact_text)
        assert response.status_code == 200
        assert response.json()["saved_at"].endswith("Z")
    with TestClient(create_app(path)) as client:
        project = client.get("/api/projects/1").json()
        assert len(project["segments"]) == 3
        assert project["segments"][0]["target_text"] == exact_text
        assert project["segments"][0]["revision"] == 1


@pytest.mark.parametrize("text", ["", " \t\n ", 'Aspas "duplas" e apóstrofo: d’água 📝'])
def test_preserves_text_including_empty_and_unicode(client, text):
    assert save(client, text).status_code == 200
    assert client.get("/api/projects/1").json()["segments"][0]["target_text"] == text


def test_noop_and_immutable_history(client):
    assert save(client, "Primeira").json()["revision"] == 1
    same = save(client, "Primeira", 1).json()
    assert same["revision"] == 1
    assert save(client, "Segunda", 1).json()["revision"] == 2
    with client.app.state.database.engine.connect() as connection:
        rows = connection.execute(select(revisions.c.revision, revisions.c.target_text)
            .where(revisions.c.segment_id == 1).order_by(revisions.c.revision)).all()
    assert rows == [(0, ""), (1, "Primeira"), (2, "Segunda")]


def test_stale_revision_cannot_overwrite_even_with_same_text(client):
    assert save(client, "Mais recente").status_code == 200
    for text in ("Outra tradução", "Mais recente"):
        response = save(client, text)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "revision_conflict"
    assert client.get("/api/projects/1").json()["segments"][0]["target_text"] == "Mais recente"


def test_simultaneous_saves_from_same_revision(client):
    barrier = Barrier(2)

    def submit(text):
        barrier.wait()
        return save(client, text)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, ["Versão A", "Versão B"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json()["target_text"] for response in responses if response.status_code == 200)
    assert client.get("/api/projects/1").json()["segments"][0]["target_text"] == winner


def test_unknown_and_wrong_project(client):
    with client.app.state.database.write() as connection:
        connection.execute(insert(projects).values(id=2, title="Outro", instructions="",
            source_language="en", target_language="pt-PT"))
    assert client.get("/api/projects/999").status_code == 404
    assert save(client, "Texto", project_id=2).status_code == 404
    assert save(client, "Texto", segment_id=999).status_code == 404


@pytest.mark.parametrize("body", [
    {}, {"target_text": None, "base_revision": 0},
    {"target_text": 123, "base_revision": 0},
    {"target_text": "x", "base_revision": -1},
    {"target_text": "x", "base_revision": True},
    {"target_text": "x", "base_revision": "0"},
    {"target_text": "x", "base_revision": 0, "saved_at": "inventado"},
])
def test_invalid_input_is_rejected_without_writing(client, body):
    assert client.put("/api/projects/1/segments/1", json=body).status_code == 422
    assert client.get("/api/projects/1").json()["segments"][0]["revision"] == 0


def test_failed_pointer_update_rolls_back_new_revision(client):
    engine = client.app.state.database.engine

    def fail_update(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE segments"):
            raise OperationalError(statement, parameters, Exception("simulated failure"))

    event.listen(engine, "before_cursor_execute", fail_update)
    try:
        response = save(client, "Não deve ficar guardado")
        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "save_failed"
    finally:
        event.remove(engine, "before_cursor_execute", fail_update)
    assert client.get("/api/projects/1").json()["segments"][0]["revision"] == 0
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(revisions)
            .where(revisions.c.segment_id == 1)) == 1
    assert save(client, "Nova tentativa").status_code == 200


def test_foreign_keys_protect_current_revision(client):
    database = client.app.state.database
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    with pytest.raises(IntegrityError):
        with database.write() as connection:
            connection.execute(update(segments).where(segments.c.id == 1).values(current_revision=999))
    assert client.get("/api/projects/1").json()["segments"][0]["revision"] == 0
