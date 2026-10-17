"""Persistência SQLite: cada gravação acrescenta uma revisão imutável."""

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    CheckConstraint, Column, ForeignKey, ForeignKeyConstraint, Integer,
    MetaData, String, Table, Text, UniqueConstraint, create_engine, event,
    insert, select, update,
)

metadata = MetaData()
projects = Table(
    "projects", metadata,
    Column("id", Integer, primary_key=True),
    Column("title", Text, nullable=False),
    Column("instructions", Text, nullable=False),
    Column("source_language", String, nullable=False),
    Column("target_language", String, nullable=False),
)
segments = Table(
    "segments", metadata,
    Column("id", Integer, primary_key=True),
    Column("project_id", ForeignKey("projects.id"), nullable=False),
    Column("position", Integer, nullable=False),
    Column("source_text", Text, nullable=False),
    Column("current_revision", Integer, nullable=False),
    UniqueConstraint("project_id", "position"),
    CheckConstraint("position > 0"),
    # A referência diferida permite criar segmento e revisão 0 na mesma transação.
    ForeignKeyConstraint(
        ["id", "current_revision"], ["revisions.segment_id", "revisions.revision"],
        deferrable=True, initially="DEFERRED", name="fk_current_revision",
    ),
)
revisions = Table(
    "revisions", metadata,
    Column("segment_id", ForeignKey("segments.id"), primary_key=True),
    Column("revision", Integer, primary_key=True),
    Column("target_text", Text, nullable=False),
    Column("saved_at", String, nullable=False),
    CheckConstraint("revision >= 0"),
)


class NotFound(Exception):
    pass


class RevisionConflict(Exception):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Database:
    def __init__(self, path: Path):
        path = path.expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            "sqlite:///" + str(path),
            connect_args={"check_same_thread": False, "timeout": 5},
        )

        @event.listens_for(self.engine, "connect")
        def configure_connection(dbapi_connection, _):
            # Transações explícitas, incluindo leituras consistentes e DDL.
            dbapi_connection.isolation_level = None
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        @event.listens_for(self.engine, "begin")
        def begin_transaction(connection):
            writing = connection.get_execution_options().get("sqlite_write", False)
            connection.exec_driver_sql("BEGIN IMMEDIATE" if writing else "BEGIN")

    @contextmanager
    def write(self):
        # Obter o bloqueio antes de ler a revisão evita a corrida read-check-write.
        with self.engine.connect().execution_options(sqlite_write=True) as connection:
            with connection.begin():
                yield connection

    def initialize(self):
        metadata.create_all(self.engine)
        with self.write() as connection:
            if connection.execute(select(projects.c.id).where(projects.c.id == 1)).first():
                return
            connection.execute(insert(projects).values(
                id=1, title="Oficina de tradução",
                instructions="Traduz as informações para os participantes.",
                source_language="en", target_language="pt-PT",
            ))
            originals = (
                "The workshop starts at 10:30.",
                "Bring a notebook.",
                "The session lasts 45 minutes.",
            )
            for position, original in enumerate(originals, start=1):
                connection.execute(insert(segments).values(
                    id=position, project_id=1, position=position,
                    source_text=original, current_revision=0,
                ))
                connection.execute(insert(revisions).values(
                    segment_id=position, revision=0, target_text="", saved_at=utc_now(),
                ))

    def read_project(self, project_id: int) -> dict:
        with self.engine.begin() as connection:
            project = connection.execute(
                select(projects).where(projects.c.id == project_id)
            ).mappings().first()
            if project is None:
                raise NotFound
            rows = connection.execute(
                select(
                    segments.c.id, segments.c.position, segments.c.source_text,
                    revisions.c.target_text, revisions.c.revision,
                ).select_from(segments.join(revisions,
                    (segments.c.id == revisions.c.segment_id)
                    & (segments.c.current_revision == revisions.c.revision)
                )).where(segments.c.project_id == project_id).order_by(segments.c.position)
            ).mappings().all()
            return {**project, "segments": [dict(row) for row in rows]}

    def save_segment(self, project_id: int, segment_id: int, target_text: str, base_revision: int) -> dict:
        with self.write() as connection:
            segment = connection.execute(select(segments).where(
                segments.c.id == segment_id, segments.c.project_id == project_id,
            )).mappings().first()
            if segment is None:
                raise NotFound
            if segment["current_revision"] != base_revision:
                raise RevisionConflict
            current = connection.execute(select(revisions).where(
                revisions.c.segment_id == segment_id, revisions.c.revision == base_revision,
            )).mappings().one()
            if current["target_text"] == target_text:
                return {"id": segment_id, "target_text": target_text,
                        "revision": base_revision, "saved_at": current["saved_at"]}
            result = {"id": segment_id, "target_text": target_text,
                      "revision": base_revision + 1, "saved_at": utc_now()}
            connection.execute(insert(revisions).values(
                segment_id=segment_id, revision=result["revision"],
                target_text=target_text, saved_at=result["saved_at"],
            ))
            connection.execute(update(segments).where(segments.c.id == segment_id).values(
                current_revision=result["revision"],
            ))
            return result
