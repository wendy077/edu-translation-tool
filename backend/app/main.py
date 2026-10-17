import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from sqlalchemy.exc import SQLAlchemyError

from .database import Database, NotFound, RevisionConflict

logger = logging.getLogger(__name__)
DEFAULT_DATABASE = Path(__file__).resolve().parents[1] / "data" / "translation.sqlite3"


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_text: StrictStr
    base_revision: StrictInt = Field(ge=0)


class SegmentResponse(BaseModel):
    id: int
    position: int
    source_text: str
    target_text: str
    revision: int


class ProjectResponse(BaseModel):
    id: int
    title: str
    instructions: str
    source_language: str
    target_language: str
    segments: list[SegmentResponse]


class SaveResponse(BaseModel):
    id: int
    target_text: str
    revision: int
    saved_at: datetime


def create_app(database_path: Path | None = None) -> FastAPI:
    path = database_path or Path(os.environ.get("EDU_DATABASE_PATH", DEFAULT_DATABASE))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(path)
        app.state.database = database
        try:
            database.initialize()
            yield
        finally:
            database.engine.dispose()

    app = FastAPI(title="Educational Translation Tool", version="0.1.0", lifespan=lifespan)

    @app.get("/api/projects/{project_id}", response_model=ProjectResponse)
    def read_project(project_id: int):
        try:
            return app.state.database.read_project(project_id)
        except NotFound:
            raise HTTPException(404, detail={"code": "not_found", "message": "Exercício não encontrado."})
        except SQLAlchemyError:
            logger.error("Não foi possível ler o exercício da base de dados.")
            raise HTTPException(500, detail={"code": "read_failed", "message": "Não foi possível carregar o exercício."})

    @app.put("/api/projects/{project_id}/segments/{segment_id}", response_model=SaveResponse)
    def save_segment(project_id: int, segment_id: int, body: SaveRequest):
        try:
            return app.state.database.save_segment(
                project_id, segment_id, body.target_text, body.base_revision,
            )
        except NotFound:
            raise HTTPException(404, detail={"code": "not_found", "message": "Segmento não encontrado neste exercício."})
        except RevisionConflict:
            raise HTTPException(409, detail={"code": "revision_conflict", "message": "Existe uma revisão mais recente."})
        except SQLAlchemyError:
            logger.error("Não foi possível guardar a revisão na base de dados.")
            raise HTTPException(500, detail={"code": "save_failed", "message": "Não foi possível guardar a tradução."})

    return app


app = create_app()
