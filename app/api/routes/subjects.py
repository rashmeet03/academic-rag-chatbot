import logging
from fastapi import APIRouter
from app.services.vector_store import get_vector_store
from app.models.schemas import SubjectsResponse, SubjectInfo

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/", response_model=SubjectsResponse)
async def list_subjects():
    """Returns all subjects that have been ingested with their document counts."""
    vector_store = get_vector_store()
    subjects_data = vector_store.get_subjects()

    return SubjectsResponse(
        subjects=[
            SubjectInfo(name=s["name"], document_count=s["document_count"])
            for s in subjects_data
        ]
    )
