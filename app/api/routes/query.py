import json
import logging
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import QueryRequest
from app.services.vector_store import get_vector_store
from app.services.llm_generator import LLMGeneratorService

logger = logging.getLogger(__name__)
router = APIRouter()
llm_generator = LLMGeneratorService()


@router.post("/ask")
async def ask_question(request: QueryRequest):
    """
    Rules:
    1. If the provided context excerpts are irrelevant or do NOT contain the answer, you MUST output ONLY this exact sentence: "Thinking... [TRIGGER_SEARCH_NOW]"
    2. If the context contains the answer, provide it using ONLY the context.
    3. Cite sources (e.g., "[filename], p. X").
    4. Markdown for formatting.
    """
    try:
        # 1. Route Intent
        intent = llm_generator.route_query_intent(request.question)
        logger.info("Query Intent Classified as: %s for query '%s'", intent, request.question)
        
        # 2. Retrieve relevant context based on intent
        vector_store = get_vector_store()
        context_chunks = []
        
        if intent == "INTERNET":
            logger.info("Bypassing vector search for INTERNET intent.")
            context_chunks = [] # Explicitly empty to trigger the search logic
        elif intent == "GLOBAL":
            context_chunks = vector_store.get_global_summaries(subject=request.subject)
            if not context_chunks:
                logger.info("No global summaries found, falling back to LOCAL Hybrid Search.")
                context_chunks = vector_store.search(
                    query_text=request.question,
                    subject=request.subject,
                )
        else:
            context_chunks = vector_store.search(
                query_text=request.question,
                subject=request.subject,
            )

        # 3. Convert history to plain dicts for the LLM
        history_dicts = None
        if request.history:
            history_dicts = [msg.model_dump() for msg in request.history]

        # 4. Stream the async response
        async def generate():
            try:
                # If we have NO context chunks at all, trigger web search immediately without calling the first LLM
                if not context_chunks:
                    yield json.dumps({"type": "sources", "data": []}) + "\n"
                    status_update = "I couldn't find any relevant academic materials for your question in this subject. \n\n**🌐 Searching the internet...**\n\n"
                    yield json.dumps({"type": "content", "data": status_update}) + "\n"
                    
                    web_results = await asyncio.to_thread(llm_generator.execute_web_search, request.question)
                    async for web_token in llm_generator.stream_web_answer(
                        request.question, 
                        web_results, 
                        history=history_dicts[-1]['content'] if history_dicts else ""
                    ):
                        yield json.dumps({"type": "web_content", "data": web_token}) + "\n"
                    yield json.dumps({"type": "done", "data": ""}) + "\n"
                    return

                # Otherwise, yield sources and call LLM
                yield json.dumps({"type": "sources", "data": context_chunks}) + "\n"

                full_response = ""
                trigger_found = False
                trigger_tag = "[TRIGGER_SEARCH_NOW]"

                async for token in llm_generator.stream_answer(
                    request.question,
                    context_chunks,
                    history=history_dicts,
                ):
                    full_response += token
                    if trigger_tag in full_response:
                        trigger_found = True
                        break
                    yield json.dumps({"type": "content", "data": token}) + "\n"

                if trigger_found:
                    status_update = "\n\n**🌐 Document context insufficient. Searching the internet...**\n\n"
                    yield json.dumps({"type": "content", "data": status_update}) + "\n"
                    web_results = await asyncio.to_thread(llm_generator.execute_web_search, request.question)
                    async for web_token in llm_generator.stream_web_answer(
                        request.question, 
                        web_results, 
                        history=history_dicts[-1]['content'] if history_dicts else ""
                    ):
                        yield json.dumps({"type": "web_content", "data": web_token}) + "\n"

                yield json.dumps({"type": "done", "data": ""}) + "\n"

            except Exception as e:
                logger.exception("Error during streaming")
                yield json.dumps({
                    "type": "error",
                    "data": f"An error occurred: {str(e)}",
                }) + "\n"

        return StreamingResponse(
            generate(), 
            media_type="application/x-ndjson",
            headers={"X-Accel-Buffering": "no"}
        )

    except Exception as e:
        logger.exception("Failed to process question")
        raise HTTPException(status_code=500, detail=str(e))
