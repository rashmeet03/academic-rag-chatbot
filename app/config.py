import logging
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Centralized application configuration with environment variable support."""

    # --- Application ---
    APP_NAME: str = "Smart Copilot"
    LOG_LEVEL: str = "INFO"

    # --- CORS ---
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # --- Qdrant ---
    QDRANT_PATH: str | None = "./local_qdrant_db"
    QDRANT_URL: str | None = None
    QDRANT_API_KEY: str | None = None
    COLLECTION_NAME: str = "academic_subjects_hybrid"

    # --- Embedding ---
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    SPARSE_EMBEDDING_MODEL: str = "Qdrant/bm25"
    EMBEDDING_DIMENSION: int = 384

    # --- LLM ---
    LLM_MODEL: str = "llama3.2"
    LLM_TEMPERATURE: float = 0.1
    GROQ_API_KEY: str | None = None

    # --- Document Processing ---
    MAX_FILE_SIZE_MB: int = 50
    CHUNK_SIZE: int = 400
    CHUNK_OVERLAP: int = 50

    # --- Retrieval ---
    RETRIEVAL_LIMIT: int = 5
    SCORE_THRESHOLD: float = 0.30

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def setup_logging():
    """Configure application-wide logging."""
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
