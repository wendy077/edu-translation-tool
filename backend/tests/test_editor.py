from concurrent.futures import ThreadPoolExecutor
import sqlite3
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


def save(client, text, revision=0, project_id=1, segment_id=1, **fields):
    return client.put(f"/api/projects/{project_id}/segments/{segment_id}", json={
        "target_text": text, "base_revision": revision, **fields,
    })


def test_seed_and_persistence_across_restarts(tmp_path):
    path = tmp_path / "restart.sqlite3"
    exact_text = '  A oficina começa às 10:30.\n«Tradução»\t\n '
    with TestClient(create_app(path)) as client:
        project = client.get("/api/projects/1").json()
        assert [s["position"] for s in project["segments"]] == [1, 2, 3]
        assert all(s["target_text"] == "" and s["revision"] == 0 for s in project["segments"])
        assert all(s["status"] == "untranslated" for s in project["segments"])
        response = save(client, exact_text)
        assert response.status_code == 200
        assert response.json()["saved_at"].endswith("Z")
    with TestClient(create_app(path)) as client:
        project = client.get("/api/projects/1").json()
        assert len(project["segments"]) == 3
        assert project["segments"][0]["target_text"] == exact_text
        assert project["segments"][0]["revision"] == 1
        assert project["segments"][0]["status"] == "in_review"


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


def test_export_empty_exercise_is_versioned_and_downloadable(client):
    response = client.get("/api/projects/1/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["content-disposition"] == 'attachment; filename="exercicio-1.json"'
    assert response.headers["cache-control"] == "no-store"
    document = response.json()
    assert document == {"format_version": 1, "project": client.get("/api/projects/1").json()}
    assert [segment["position"] for segment in document["project"]["segments"]] == [1, 2, 3]
    assert all(segment["revision"] == 0 and segment["status"] == "untranslated"
        for segment in document["project"]["segments"])


def test_export_reads_latest_saved_versions_without_changing_history(client):
    text = '  Tradução «revista» 📝\nAspas: "texto"\t\\\r\n '
    with client.app.state.database.write() as connection:
        connection.execute(update(projects).where(projects.c.id == 1).values(
            title="Oficina — tradução", instructions="Linha 1\nLinha 2",
        ))
        connection.execute(update(segments).where(segments.c.id == 1).values(source_text='  Original "text"\n'))
    assert save(client, "Versão anterior").status_code == 200
    assert save(client, text, 1).status_code == 200
    assert save(client, text, 2, status="completed").status_code == 200
    assert save(client, " \t\n ", segment_id=2).status_code == 200
    expected = client.get("/api/projects/1").json()
    with client.app.state.database.engine.connect() as connection:
        history = connection.execute(select(revisions).order_by(revisions.c.segment_id, revisions.c.revision)).all()

    for _ in range(2):
        document = client.get("/api/projects/1/export").json()
        assert document["project"] == expected
        first, second, third = document["project"]["segments"]
        assert first["target_text"] == text and first["revision"] == 3 and first["status"] == "completed"
        assert second["target_text"] == " \t\n " and third["target_text"] == ""

    with client.app.state.database.engine.connect() as connection:
        assert connection.execute(select(revisions).order_by(revisions.c.segment_id, revisions.c.revision)).all() == history
    assert client.get("/api/projects/1").json() == expected


def test_export_unknown_project(client):
    response = client.get("/api/projects/999/export")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"
    assert "content-disposition" not in response.headers


def test_export_read_failure_returns_error_instead_of_download(client, monkeypatch):
    def fail_read(_project_id):
        raise OperationalError("SELECT", {}, Exception("private database details"))

    monkeypatch.setattr(client.app.state.database, "read_project", fail_read)
    response = client.get("/api/projects/1/export")
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "export_failed"
    assert "private database details" not in response.text
    assert "content-disposition" not in response.headers


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
        response = save(client, "Não deve ficar guardado", status="completed")
        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "save_failed"
    finally:
        event.remove(engine, "before_cursor_execute", fail_update)
    assert client.get("/api/projects/1").json()["segments"][0]["revision"] == 0
    assert client.get("/api/projects/1").json()["segments"][0]["status"] == "untranslated"
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


def test_status_only_revisions_noop_and_history(client):
    assert save(client, "Tradução").json()["status"] == "in_review"
    completed = save(client, "Tradução", 1, status="completed").json()
    assert completed["status"] == "completed" and completed["revision"] == 2
    assert save(client, "Tradução", 2, status="completed").json() == completed
    assert save(client, "Tradução", 2).json() == completed  # Cliente 5A preserva o estado.
    assert save(client, "Tradução", 2, status="in_review").json()["revision"] == 3
    assert save(client, "Tradução", 3, status="untranslated").json()["revision"] == 4
    with client.app.state.database.engine.connect() as connection:
        rows = connection.execute(select(revisions.c.revision, revisions.c.status, revisions.c.target_text)
            .where(revisions.c.segment_id == 1).order_by(revisions.c.revision)).all()
    assert rows == [
        (0, "untranslated", ""), (1, "in_review", "Tradução"), (2, "completed", "Tradução"),
        (3, "in_review", "Tradução"), (4, "untranslated", "Tradução"),
    ]


@pytest.mark.parametrize("text", ["", " \t\n ", "\u00a0\u2003"])
def test_blank_translation_cannot_be_completed(client, text):
    response = save(client, text, status="completed")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_status"
    segment = client.get("/api/projects/1").json()["segments"][0]
    assert segment["revision"] == 0 and segment["status"] == "untranslated"
    # O texto em branco continua a ser aceite sem o estado concluído.
    assert save(client, text).json()["status"] == "untranslated"


@pytest.mark.parametrize("status", ["done", "", 1, True, []])
def test_unknown_status_is_rejected_without_writing(client, status):
    assert save(client, "Tradução", status=status).status_code == 422
    assert client.get("/api/projects/1").json()["segments"][0]["revision"] == 0


def test_legacy_client_reopens_completed_translation_when_editing(client):
    assert save(client, "Tradução", status="completed").json()["revision"] == 1
    edited = save(client, "  Tradução revista\n", 1).json()
    assert edited["status"] == "in_review"
    assert edited["target_text"] == "  Tradução revista\n"
    assert save(client, " \t\n", 2).json()["status"] == "untranslated"


def test_concurrent_status_changes_cannot_overwrite(client):
    assert save(client, "Tradução").status_code == 200
    barrier = Barrier(2)

    def submit(status):
        barrier.wait()
        return save(client, "Tradução", 1, status=status)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, ["completed", "untranslated"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json()["status"] for response in responses if response.status_code == 200)
    segment = client.get("/api/projects/1").json()["segments"][0]
    assert segment["target_text"] == "Tradução" and segment["status"] == winner
    assert segment["revision"] == 2


def test_status_persists_after_restart(tmp_path):
    path = tmp_path / "status.sqlite3"
    with TestClient(create_app(path)) as client:
        assert save(client, "Tradução", status="completed").status_code == 200
    with TestClient(create_app(path)) as client:
        segment = client.get("/api/projects/1").json()["segments"][0]
        assert segment["target_text"] == "Tradução" and segment["status"] == "completed"
        assert segment["revision"] == 1


def test_upgrade_from_5a_preserves_data_and_is_idempotent(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    # Esquema real de 5A, sem a coluna status. Não depende dos modelos atuais.
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, instructions TEXT NOT NULL,
                source_language VARCHAR NOT NULL, target_language VARCHAR NOT NULL
            );
            CREATE TABLE segments (
                id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
                position INTEGER NOT NULL CHECK (position > 0), source_text TEXT NOT NULL,
                current_revision INTEGER NOT NULL, UNIQUE(project_id, position),
                FOREIGN KEY (id, current_revision) REFERENCES revisions(segment_id, revision)
                    DEFERRABLE INITIALLY DEFERRED
            );
            CREATE TABLE revisions (
                segment_id INTEGER NOT NULL REFERENCES segments(id),
                revision INTEGER NOT NULL CHECK (revision >= 0), target_text TEXT NOT NULL,
                saved_at VARCHAR NOT NULL, PRIMARY KEY (segment_id, revision)
            );
        """)
        connection.execute("INSERT INTO projects VALUES (1, 'Exercício antigo', 'Instruções', 'en', 'pt-PT')")
        connection.execute("INSERT INTO segments VALUES (1, 1, 1, 'Original', 2)")
        original_rows = [
            (1, 0, "", "2026-10-17T09:00:00Z"),
            (1, 1, " \t\n\u00a0", "2026-10-17T09:01:00Z"),
            (1, 2, "  Tradução antiga 📝\n ", "2026-10-17T09:02:00Z"),
        ]
        connection.executemany("INSERT INTO revisions VALUES (?, ?, ?, ?)", original_rows)

    for _ in range(2):
        with TestClient(create_app(path)) as client:
            project = client.get("/api/projects/1").json()
            assert project["title"] == "Exercício antigo" and len(project["segments"]) == 1
            segment = project["segments"][0]
            assert segment["revision"] == 2 and segment["status"] == "in_review"
            assert segment["target_text"] == original_rows[-1][2]
            with client.app.state.database.engine.connect() as connection:
                rows = connection.execute(select(
                    revisions.c.segment_id, revisions.c.revision, revisions.c.target_text, revisions.c.saved_at,
                ).order_by(revisions.c.revision)).all()
                assert rows == original_rows
                assert connection.execute(select(revisions.c.status).order_by(revisions.c.revision)).scalars().all() == [
                    "untranslated", "untranslated", "in_review",
                ]
                assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
                assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1

    with TestClient(create_app(path)) as client:
        assert save(client, original_rows[-1][2], 2, status="completed").json()["revision"] == 3
    with TestClient(create_app(path)) as client:
        assert client.get("/api/projects/1").json()["segments"][0]["status"] == "completed"
