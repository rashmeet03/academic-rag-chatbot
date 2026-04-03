from pydantic import BaseModel, Field
from typing import List, Optional


class DocumentMetadata(BaseModel):
    subject: str = Field(..., description="The academic subject of the document (e.g., DBMS, ML)")
    filename: str
    page_number: int = 1
    is_summary: bool = False


class Chunk(BaseModel):
    text: str
    metadata: DocumentMetadata


class IngestionResponse(BaseModel):
    message: str
    total_chunks: int
    subject: str
    sample_chunks: List[Chunk] = []


class ChatMessage(BaseModel):
    role: str = Field(..., description="Either 'user' or 'ai'")
    content: str


class QueryRequest(BaseModel):
    question: str = Field(..., description="The user's academic question")
    subject: str = Field(..., description="The isolated subject to search within")
    history: Optional[List[ChatMessage]] = Field(
        default=[], description="Recent conversation messages for context"
    )


class RetrievedContext(BaseModel):
    text: str
    score: float
    source: str
    page: int


class QueryResponse(BaseModel):
    question: str
    subject: str
    answer: str
    retrieved_chunks: List[RetrievedContext]


class SubjectInfo(BaseModel):
    name: str
    document_count: int


class SubjectsResponse(BaseModel):
    subjects: List[SubjectInfo]
