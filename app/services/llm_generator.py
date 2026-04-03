import logging
import asyncio
from langchain_ollama import ChatOllama
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.tools import DuckDuckGoSearchRun
from app.config import settings

logger = logging.getLogger(__name__)


class LLMGeneratorService:
    def __init__(self):
        # Choose between Groq (Cloud) or Ollama (Local)
        if settings.GROQ_API_KEY:
            logger.info("Initializing Groq Cloud LLM (Free Tier)")
            self.llm = ChatGroq(
                api_key=settings.GROQ_API_KEY,
                model="llama-3.3-70b-versatile", # Latest stable Groq model
                temperature=settings.LLM_TEMPERATURE,
                streaming=True,
            )
        else:
            logger.info("Initializing Ollama Local LLM")
            self.llm = ChatOllama(
                model=settings.LLM_MODEL,
                temperature=settings.LLM_TEMPERATURE,
                num_ctx=8192,
                streaming=True, 
            )

        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a strict, highly accurate Academic Copilot.
You will be provided with a user's question, specific text excerpts from academic materials, and optionally recent conversation history for context.

Rules:
1. If the provided context excerpts do NOT contain the answer to the user's question, you MUST immediately output exactly one sentence explaining the absence, followed by the specific marker: [TRIGGER_SEARCH_NOW]
2. If the context DOES contain the answer, provide a detailed response using ONLY that information.
3. Reference sources when possible (e.g., "According to [filename], page X...").
4. NEVER invent facts or use general knowledge if you are responding via Rule 2.
5. Format with markdown: use **bold** for key terms, bullet points for lists, and code blocks where appropriate.
6. If conversation history is provided, use it to understand follow-up questions but NEVER cite information from the history — only from the provided excerpts.
"""),
            ("human", """{history_section}Context Materials:
{context}

User Question: {question}"""),
        ])

    def route_query_intent(self, question: str) -> str:
        """Classify if the question needs GLOBAL summarization or LOCAL fact lookup."""
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an intent classifier for an Academic Copilot.
Classify the user's question into one of three categories:
1. GLOBAL: If the user asks for a broad, high-level summary of a document or subject.
2. LOCAL: If the user asks for a specific fact, concept definition, or detail that is likely to be in a textbook or technical document.
3. INTERNET: If the user asks about current events, jokes, general knowledge unrelated to the subject, or explicit requests to search the web.

Respond with EXACTLY one word: 'GLOBAL', 'LOCAL', or 'INTERNET'. Do not provide any other text."""),
            ("human", "Question: {question}\n\nIntent:")
        ])
        
        try:
            # We enforce a low temperature parameter specifically for the router if possible, but the default 0.1 is fine
            chain = prompt | self.llm
            result = chain.invoke({"question": question}).content.strip().upper()
            if "GLOBAL" in result:
                return "GLOBAL"
            if "INTERNET" in result:
                return "INTERNET"
            return "LOCAL"
        except Exception as e:
            logger.warning("Routing failed, defaulting to LOCAL: %s", e)
            return "LOCAL"

    async def stream_answer(self, question: str, retrieved_chunks: list[dict], history: list[dict] = None):
        """Streams the grounded answer token by token."""
        # Format context with source attribution
        formatted_context = ""
        if retrieved_chunks:
            for i, chunk in enumerate(retrieved_chunks):
                formatted_context += f"--- Excerpt {i + 1} ---\n"
                formatted_context += f"Source: {chunk['source']} (Page {chunk['page']})\n"
                formatted_context += f"Relevance Score: {chunk['score']}\n"
                formatted_context += f"Text: {chunk['text']}\n\n"
        else:
            formatted_context = "No relevant context found. Tell the user you don't have enough academic context to answer."

        # Format conversation history if provided (truncate to avoid long contexts)
        history_section = ""
        if history and len(history) > 0:
            history_section = "Recent Conversation:\n"
            
            # Simple character/token bounding for history, keep total history under ~1500 chars
            allowed_chars = 1500
            current_chars = 0
            
            # Process in reverse to keep the most recent messages
            valid_history = []
            for msg in reversed(history[-6:]):
                content_len = len(msg.get('content', ''))
                if current_chars + content_len < allowed_chars:
                    valid_history.append(msg)
                    current_chars += content_len
                else:
                    break
                    
            # Reverse back to chronological
            for msg in reversed(valid_history):
                role = "User" if msg.get("role") == "user" else "Assistant"
                history_section += f"{role}: {msg.get('content', '')}\n"
            history_section += "\n"

        chain = self.prompt | self.llm

        try:
            async for chunk in chain.astream({
                "context": formatted_context,
                "question": question,
                "history_section": history_section,
            }):
                if chunk.content:
                    yield chunk.content
                    # Subtle delay (20ms) to ensure smooth token-by-token UI rendering
                    await asyncio.sleep(0.02) 
        except Exception as e:
            logger.error("LLM streaming error: %s", e)
            yield f"\n\n⚠️ An error occurred while generating the response: {str(e)}"

    def execute_web_search(self, query: str) -> str:
        """Runs a DuckDuckGo search and returns results as a string."""
        try:
            search = DuckDuckGoSearchRun()
            results = search.run(query)
            return results
        except Exception as e:
            logger.error("Web search failed: %s", e)
            return f"Error performing web search: {str(e)}"

    async def stream_web_answer(self, question: str, web_context: str, history: str = ""):
        """Generated a response based on web search results."""
        web_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a helpful AI assistant. You will be provided with a user's question and search results from the internet.
Answer the question using the provided search results. 
If the information is not in the results, use your general knowledge but clearly state you are doing so.
Maintain a professional and helpful academic tone.
"""),
            ("human", """{history}
Web Search results:
{web_context}

User Question: {question}"""),
        ])
        
        chain = web_prompt | self.llm
        
        try:
            async for chunk in chain.astream({
                "web_context": web_context,
                "question": question,
                "history": history
            }):
                if chunk.content:
                    yield chunk.content
                    await asyncio.sleep(0.02)
        except Exception as e:
            logger.error("Web LLM streaming error: %s", e)
            yield f"\n\n⚠️ An error occurred while generating the web-based response: {str(e)}"
