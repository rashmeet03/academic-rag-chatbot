import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.document_processor import DocumentProcessor
from app.models.schemas import IngestionResponse
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter()
processor = DocumentProcessor()


@router.post("/upload", response_model=IngestionResponse)
async def upload_ebook(
    file: UploadFile = File(...),
    subject: str = Form(...),
):
    """Upload and embed a PDF document into the knowledge base."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are currently supported.",
        )

    try:
        # Phase 1: Parse, validate, and chunk (includes size & corruption checks)
        chunks, file_hash = await processor.process_upload(file, subject)

        # Phase 2: Remove old version if re-uploading same file
        vector_store = get_vector_store()
        deleted = vector_store.delete_by_filename_and_subject(file.filename, subject)
        if deleted > 0:
            logger.info("Replaced %d old chunks for '%s'", deleted, file.filename)

        # Phase 3: Embed and store
        vectors_inserted = vector_store.ingest_chunks(chunks)

        return IngestionResponse(
            message=f"Successfully processed and embedded '{file.filename}' ({vectors_inserted} chunks)",
            total_chunks=vectors_inserted,
            subject=subject.upper(),
            sample_chunks=chunks[:1],
        )

    except HTTPException:
        raise  # Re-raise validation errors as-is
    except Exception as e:
        logger.exception("Upload failed for '%s'", file.filename)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
