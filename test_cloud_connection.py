import logging
import asyncio
from app.api.routes import query # This will trigger the service initializations
from app.services.llm_generator import LLMGeneratorService
from app.services.vector_store import get_vector_store
from app.config import setup_logging

async def test_connections():
    setup_logging()
    print("\n--- 🔍 Testing Cloud Connections ---")
    
    # 1. Test Vector Store (Qdrant Cloud)
    print("\n[1/2] Connecting to Qdrant Cloud...")
    try:
        v_store = get_vector_store()
        subjects = v_store.get_subjects()
        print(f"✅ Success! Connected to Qdrant. Found {len(subjects)} subjects.")
    except Exception as e:
        print(f"❌ Qdrant Connection Failed: {e}")

    # 2. Test LLM Generator (Groq)
    print("\n[2/2] Connecting to Groq Cloud API...")
    try:
        llm_service = LLMGeneratorService()
        # Test a simple non-streaming message
        response = await llm_service.llm.ainvoke("Hi, are you working via Groq?")
        print(f"✅ Success! Groq responded: '{response.content[:50]}...'")
    except Exception as e:
        print(f"❌ Groq Connection Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_connections())
