import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_URL = `${API_BASE}/api/v1`;

/**
 * Upload a PDF ebook for a given subject.
 */
export const uploadEbook = async (file, subject) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('subject', subject);

  const response = await axios.post(`${API_URL}/ingest/upload`, formData, {
    timeout: 120000, // 2 minute timeout for large files
  });
  return response.data;
};

/**
 * Fetch all available subjects from the backend.
 */
export const fetchSubjects = async () => {
  const response = await axios.get(`${API_URL}/subjects/`);
  return response.data;
};

/**
 * Stream a question to the chat endpoint with conversation history.
 * Uses NDJSON streaming with proper line buffering to handle partial chunks.
 * Supports aborting the generation via AbortController signal.
 */
export const streamQuestion = async (question, subject, history, onMessage, abortSignal) => {
  try {
    const response = await fetch(`${API_URL}/chat/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, subject, history }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = ''; // Line buffer to handle partial chunks

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines only
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          onMessage(parsed);
        } catch (e) {
          console.warn('Skipping malformed stream chunk:', trimmed);
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        onMessage(parsed);
      } catch (e) {
        console.warn('Skipping final malformed chunk:', buffer.trim());
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Stream aborted by user');
      // We can also trigger an onMessage here to let the UI know it was stopped
      onMessage({ type: 'error', data: 'Generation stopped.' });
    } else {
      throw error;
    }
  }
};

/**
 * Fetch all filenames associated with a subject.
 */
export const fetchSubjectDocuments = async (subject) => {
  const response = await axios.get(`${API_URL}/management/documents/${encodeURIComponent(subject)}`);
  return response.data;
};

export const deleteDocument = async (subject, filename) => {
  const response = await axios.delete(`${API_URL}/management/documents/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`);
  return response.data;
};

export const deleteSubject = async (subject) => {
  const response = await axios.delete(`${API_URL}/management/subject/${encodeURIComponent(subject)}`);
  return response.data;
};
