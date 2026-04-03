import logging
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
)
from fastembed import TextEmbedding, SparseTextEmbedding
from app.models.schemas import Chunk
from app.config import settings
import uuid

logger = logging.getLogger(__name__)

# Module-level singleton (lazily initialized)
_vector_store_instance = None


def get_vector_store():
    """Lazy singleton to avoid file-lock issues at import time."""
    global _vector_store_instance
    if _vector_store_instance is None:
        _vector_store_instance = VectorStoreService()
    return _vector_store_instance


class VectorStoreService:
    def __init__(self):
        # Choose between Cloud URL or Local Path
        if settings.QDRANT_URL:
            logger.info("Initializing Qdrant Cloud Client")
            self.client = QdrantClient(
                url=settings.QDRANT_URL,
                api_key=settings.QDRANT_API_KEY,
            )
        else:
            logger.info("Initializing Qdrant Local Client (Path: %s)", settings.QDRANT_PATH)
            self.client = QdrantClient(path=settings.QDRANT_PATH)
            
        self.collection_name = settings.COLLECTION_NAME
        self._dense_model = None
        self._sparse_model = None
        self._ensure_collection_exists()

    @property
    def dense_model(self):
        if self._dense_model is None:
            logger.info("Lazily loading Dense Embedding Model: %s", settings.EMBEDDING_MODEL)
            self._dense_model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
        return self._dense_model

    @property
    def sparse_model(self):
        if self._sparse_model is None:
            logger.info("Lazily loading Sparse Embedding Model: %s", settings.SPARSE_EMBEDDING_MODEL)
            self._sparse_model = SparseTextEmbedding(model_name=settings.SPARSE_EMBEDDING_MODEL)
        return self._sparse_model

    def _ensure_collection_exists(self):
        """Creates the collection if it doesn't exist."""
        collections = self.client.get_collections().collections
        exists = any(col.name == self.collection_name for col in collections)

        if not exists:
            # Create a collection with named vectors for hybrid search
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config={
                    "dense": VectorParams(
                        size=settings.EMBEDDING_DIMENSION,
                        distance=Distance.COSINE,
                    )
                },
                sparse_vectors_config={
                    "sparse": SparseVectorParams(
                        index=SparseIndexParams(
                            on_disk=False,
                        )
                    )
                }
            )
            logger.info("Created collection '%s' for Hybrid Search", self.collection_name)

    def delete_by_filename_and_subject(self, filename: str, subject: str) -> int:
        """Delete existing points for a filename+subject combo (duplicate removal)."""
        try:
            # Scroll through matching points to get their IDs
            result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="filename", match=MatchValue(value=filename)),
                        FieldCondition(key="subject", match=MatchValue(value=subject.upper())),
                    ]
                ),
                limit=10000,
            )
            point_ids = [point.id for point in result[0]]
            if point_ids:
                self.client.delete(
                    collection_name=self.collection_name,
                    points_selector=point_ids,
                )
                logger.info(
                    "Deleted %d existing points for '%s' in subject '%s'",
                    len(point_ids),
                    filename,
                    subject,
                )
            return len(point_ids)
        except Exception as e:
            logger.warning("Failed to delete old points: %s", e)
            return 0

    def ingest_chunks(self, chunks: list[Chunk]) -> int:
        """Embeds text chunks and uploads them to Qdrant with metadata."""
        if not chunks:
            return 0

        texts = [chunk.text for chunk in chunks]
        
        # Generate both embeddings
        dense_embeddings = list(self.dense_model.embed(texts))
        sparse_embeddings = list(self.sparse_model.embed(texts))

        points = []
        for i, chunk in enumerate(chunks):
            # SparseTextEmbedding returns an object with `indices` and `values`
            sparse_emb = sparse_embeddings[i]
            
            point = PointStruct(
                id=str(uuid.uuid4()),
                vector={
                    "dense": dense_embeddings[i].tolist(),
                    "sparse": SparseVector(
                        indices=sparse_emb.indices.tolist(),
                        values=sparse_emb.values.tolist(),
                    )
                },
                payload={
                    "text": chunk.text,
                    "subject": chunk.metadata.subject,
                    "filename": chunk.metadata.filename,
                    "page_number": chunk.metadata.page_number,
                    "is_summary": getattr(chunk.metadata, 'is_summary', False),
                    "file_hash": getattr(chunk.metadata, 'file_hash', ''),
                },
            )
            points.append(point)

        # Batch upsert (Qdrant handles large batches internally)
        self.client.upsert(
            collection_name=self.collection_name,
            points=points,
        )

        logger.info("Ingested %d chunks (Hybrid mapping)", len(points))
        return len(points)

    def search(self, query_text: str, subject: str, limit: int = None) -> list[dict]:
        """Hybrid searches the vector database within the isolated subject namespace."""
        limit = limit or settings.RETRIEVAL_LIMIT

        # Generate both query embeddings
        dense_query = list(self.dense_model.embed([query_text]))[0]
        sparse_query_obj = list(self.sparse_model.embed([query_text]))[0]

        subject_filter = Filter(
            must=[
                FieldCondition(
                    key="subject",
                    match=MatchValue(value=subject.upper()),
                ),
                FieldCondition(
                    key="is_summary",
                    match=MatchValue(value=False),
                ),
            ]
        )

        search_result = self.client.query_points(
            collection_name=self.collection_name,
            prefetch=[
                Prefetch(
                    query=dense_query.tolist(),
                    using="dense",
                    limit=limit * 2,
                    filter=subject_filter,
                ),
                Prefetch(
                    query=SparseVector(
                        indices=sparse_query_obj.indices.tolist(),
                        values=sparse_query_obj.values.tolist()
                    ),
                    using="sparse",
                    limit=limit * 2,
                    filter=subject_filter,
                )
            ],
            query=FusionQuery(fusion=Fusion.RRF),
            limit=limit,
        ).points

        # Format results
        retrieved_context = []
        for hit in search_result:
            retrieved_context.append({
                "text": hit.payload["text"],
                "score": round(hit.score, 4), # Note: RRF fusion returns rank-based scores
                "source": hit.payload["filename"],
                "page": hit.payload.get("page_number", 1),
            })

        logger.info(
            "Search for '%s' in '%s': %d results (RRF Fused)",
            query_text[:50],
            subject,
            len(retrieved_context),
        )
        return retrieved_context

    def get_global_summaries(self, subject: str) -> list[dict]:
        """Fetches only document-level summaries for the entire subject bypassing semantic search."""
        result = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=Filter(
                must=[
                    FieldCondition(key="subject", match=MatchValue(value=subject.upper())),
                    FieldCondition(key="is_summary", match=MatchValue(value=True)),
                ]
            ),
            limit=20,
            with_payload=True,
            with_vectors=False,
        )
        
        summaries = []
        for point in result[0]:
            summaries.append({
                "text": point.payload.get("text", ""),
                "score": 1.0, # Semantic score doesn't matter for explicitly routed summaries
                "source": point.payload.get("filename", "Overview"),
                "page": 0,
            })
            
        logger.info("Retrieved %d global summaries for subject '%s'", len(summaries), subject)
        return summaries

    def get_subjects(self) -> list[dict]:
        """Returns a list of distinct subjects with their document counts."""
        try:
            result = self.client.scroll(
                collection_name=self.collection_name,
                limit=10000,
                with_payload=True,
                with_vectors=False,
            )

            subject_files = {}
            for point in result[0]:
                subj = point.payload.get("subject", "UNKNOWN")
                filename = point.payload.get("filename", "unknown")
                if subj not in subject_files:
                    subject_files[subj] = set()
                subject_files[subj].add(filename)

            return [
                {"name": subj, "document_count": len(files)}
                for subj, files in sorted(subject_files.items())
            ]
        except Exception as e:
            logger.error("Failed to get subjects: %s", e)
            return []

    def get_documents_in_subject(self, subject: str) -> list[str]:
        """Returns a unique list of filenames indexed under a specific subject."""
        try:
            result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="subject", match=MatchValue(value=subject.upper())),
                    ]
                ),
                limit=10000,
                with_payload=True,
                with_vectors=False,
            )
            
            filenames = set()
            for point in result[0]:
                filenames.add(point.payload.get("filename", "unknown"))
            
            return sorted(list(filenames))
        except Exception as e:
            logger.error("Failed to get documents for subject %s: %s", subject, e)
            return []

    def delete_subject(self, subject: str) -> int:
        """Deletes all documents and metadata associated with a specific subject."""
        try:
            # We use the filter directly in the delete call
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(key="subject", match=MatchValue(value=subject.upper())),
                    ]
                ),
            )
            logger.info("Purged all documents for subject '%s'", subject)
            return 1
        except Exception as e:
            logger.error("Failed to purge subject %s: %s", subject, e)
            return 0

    def delete_document(self, subject: str, filename: str) -> int:
        """Deletes chunks for a specific document within a specific subject."""
        return self.delete_by_filename_and_subject(filename, subject)
