import tempfile
import os
import logging
import hashlib
import fitz  # PyMuPDF
import pymupdf4llm
from rapidocr_onnxruntime import RapidOCR

from fastapi import UploadFile, HTTPException
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.models.schemas import Chunk, DocumentMetadata
from app.config import settings

logger = logging.getLogger(__name__)


class DocumentProcessor:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        self.ocr_engine = RapidOCR()

    def _generate_document_summary(self, chunks: list[Chunk]) -> str:
        """Uses local LLM to generate a theme/topic summary over the first ~10 chunks."""
        # Grab first 10 chunks (covers intro/abstract and avoids extreme timeouts)
        intro_text = "\n\n".join([c.text for c in chunks[:10]])
        
        from langchain_ollama import ChatOllama
        from langchain_core.prompts import ChatPromptTemplate
        
        llm = ChatOllama(model=settings.LLM_MODEL, temperature=0.1, num_ctx=8192)
        prompt_template = ChatPromptTemplate.from_messages([
            ("system", "You are an expert academic summarizer. Read the following introductory chapters/abstracts from a textbook and generate a comprehensive 'Global Document Overview'. Keep it around 150-300 words. Focus strictly on explaining what topics and themes the entire document covers."),
            ("human", "Introduction/Abstract text:\n\n{text}\n\nProvide the Document Overview Summary now:")
        ])
        
        logger.info("Generating global document summary...")
        try:
            chain = prompt_template | llm
            summary = chain.invoke({"text": intro_text}).content
            logger.info("Successfully generated global summary.")
            return summary
        except Exception as e:
            logger.warning("Failed to generate global summary: %s", e)
            return "A global summary could not be generated for this document."

    async def process_upload(self, file: UploadFile, subject: str) -> tuple[list[Chunk], str]:
        """
        Process a PDF upload: validate, extract text per-page, chunk, and attach metadata.
        Returns (chunks, file_hash) for duplicate detection.
        """
        # 1. Validate file size
        content = await file.read()
        file_size_mb = len(content) / (1024 * 1024)
        if file_size_mb > settings.MAX_FILE_SIZE_MB:
            raise HTTPException(
                status_code=413,
                detail=f"File too large ({file_size_mb:.1f} MB). Maximum allowed is {settings.MAX_FILE_SIZE_MB} MB.",
            )

        # 2. Compute hash for duplicate detection
        file_hash = hashlib.sha256(content).hexdigest()

        # 3. Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            # 4. Extract text per page with error handling
            try:
                doc = fitz.open(temp_path)
            except Exception as e:
                logger.error("Failed to open PDF '%s': %s", file.filename, e)
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot read PDF file. It may be corrupted or password-protected: {str(e)}",
                )

            processed_chunks = []
            total_pages = len(doc)

            for page_num in range(total_pages):
                try:
                    # Advanced Markdown Extraction (Handles tables, columns, strict reading order)
                    page_text = pymupdf4llm.to_markdown(doc, pages=[page_num]).strip()
                except Exception as e:
                    logger.warning("Markdown extraction failed on page %d: %s", page_num + 1, e)
                    page_text = ""

                # Fallback to OCR if empty (likely scanned or image-heavy document)
                if not page_text.strip():
                    logger.info("Page %d of '%s' missing digital text. Running Neural OCR...", page_num + 1, file.filename)
                    try:
                        page = doc.load_page(page_num)
                        pix = page.get_pixmap(dpi=150)
                        img_data = pix.tobytes("png")
                        
                        ocr_res, _ = self.ocr_engine(img_data)
                        if ocr_res:
                            # ocr_res format: list of tuples (box, text, score)
                            page_text = "\n".join([line[1] for line in ocr_res if line[1]])
                        else:
                            page_text = ""
                    except Exception as e:
                        logger.warning("OCR failed on page %d: %s", page_num + 1, e)

                if not page_text.strip():
                    logger.warning("Skipping page %d: No usable text or OCR returned.", page_num + 1)
                    continue

                # Chunk each page independently to preserve page boundaries
                page_chunks = self.text_splitter.split_text(page_text)

                for chunk_text in page_chunks:
                    metadata = DocumentMetadata(
                        subject=subject.upper(),
                        filename=file.filename,
                        page_number=page_num + 1,  # 1-indexed
                    )
                    processed_chunks.append(Chunk(text=chunk_text, metadata=metadata))

            doc.close()

            if not processed_chunks:
                raise HTTPException(
                    status_code=400,
                    detail="No readable text found in this PDF. It may be a scanned/image-only document.",
                )

            # Generate and inject Global Document Summary
            summary_text = self._generate_document_summary(processed_chunks)
            summary_metadata = DocumentMetadata(
                subject=subject.upper(),
                filename=file.filename,
                page_number=0,
                is_summary=True
            )
            # Prepend or append the summary
            processed_chunks.append(Chunk(text=summary_text, metadata=summary_metadata))

            logger.info(
                "Processed '%s': %d pages → %d chunks",
                file.filename,
                total_pages,
                len(processed_chunks),
            )
            return processed_chunks, file_hash

        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
