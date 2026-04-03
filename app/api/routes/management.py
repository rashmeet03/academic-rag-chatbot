import logging
from fastapi import APIRouter, HTTPException
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/documents/{subject}")
async def get_subject_documents(subject: str):
    """List all unique filenames for a given subject."""
    try:
        vector_store = get_vector_store()
        documents = vector_store.get_documents_in_subject(subject)
        return {"subject": subject.upper(), "documents": documents}
    except Exception as e:
        logger.exception("Failed to fetch documents for %s", subject)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/documents/{subject}/{filename}")
async def delete_document(subject: str, filename: str):
    """Delete a specific document placeholder and its chunks."""
    try:
        vector_store = get_vector_store()
        vector_store.delete_document(subject, filename)
        return {"message": f"Document '{filename}' deleted from subject '{subject}'"}
    except Exception as e:
        logger.exception("Failed to delete document %s", filename)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/subject/{subject}")
async def purge_subject(subject: str):
    """Wipe an entire subject namespace."""
    try:
        vector_store = get_vector_store()
        vector_store.delete_subject(subject)
        return {"message": f"Subject '{subject}' purged successfully"}
    except Exception as e:
        logger.exception("Failed to purge subject %s", subject)
        raise HTTPException(status_code=500, detail=str(e))
