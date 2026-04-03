import { useState, useRef, useEffect, useCallback, Component } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import toast, { Toaster } from 'react-hot-toast';
import { uploadEbook, streamQuestion, fetchSubjects, fetchSubjectDocuments, deleteDocument, deleteSubject } from './api';
import './App.css';

/* ─── Error Boundary ─── */
class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center" style={{ color: 'var(--text-secondary)' }}>
          <p>⚠️ Something went wrong rendering this message.</p>
          <button className="btn-ghost mt-2" onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Markdown Renderer (memoized) ─── */
function MarkdownContent({ content }) {
  return (
    <ErrorBoundary>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <div className="code-block-wrapper">
                <div className="code-block-header">
                  <span className="code-lang-badge">{match[1]}</span>
                  <button
                    className="code-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(String(children));
                      toast.success('Copied!', { duration: 1500 });
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Copy
                  </button>
                </div>
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ background: 'rgba(0,0,0,0.3)', padding: '16px', margin: 0, borderRadius: '0 0 10px 10px', fontSize: '13px' }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code {...props} className={`inline-code ${className || ''}`}>
                {children}
              </code>
            );
          },
          table({ children }) {
            return <div className="table-wrapper"><table className="md-table">{children}</table></div>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </ErrorBoundary>
  );
}

/* ─── Suggestion Chips ─── */
const SUGGESTIONS = [
  { icon: '📋', text: 'Summarize this document' },
  { icon: '🔑', text: 'What are the key concepts?' },
  { icon: '❓', text: 'Explain the main topics covered' },
];

/* ─── Management Modal ─── */
function ManagementModal({ isOpen, onClose, subject, onDocsUpdated, loadSubjects }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadDocs = useCallback(async () => {
    if (!subject) return;
    setLoading(true);
    try {
      const data = await fetchSubjectDocuments(subject);
      setDocs(data.documents || []);
    } catch (err) { 
      const msg = err.response?.data?.detail || err.message || "Failed to load documents";
      toast.error(msg);
    }
    setLoading(false);
  }, [subject]);

  useEffect(() => {
    if (isOpen) loadDocs();
  }, [isOpen, loadDocs]);

  const handleDeleteFile = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      await deleteDocument(subject, filename);
      toast.success(`Deleted ${filename}`);
      loadDocs();
      onDocsUpdated();
    } catch { toast.error("Delete failed"); }
  };

  const handlePurgeSubject = async () => {
    if (!window.confirm(`WARNING: This will permanently delete ALL documents in "${subject}". Continue?`)) return;
    try {
      await deleteSubject(subject);
      toast.success(`Purged subject ${subject}`);
      onDocsUpdated();
      loadSubjects();
      onClose();
    } catch { toast.error("Purge failed"); }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Manage Knowledge Base</h3>
            <p className="modal-subtitle">Subject: {subject}</p>
          </div>
          <button className="btn-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="modal-body custom-scrollbar">
          {loading ? (
            <div className="modal-loading">
              <svg className="spin" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            </div>
          ) : docs.length === 0 ? (
            <div className="modal-empty">No documents found in this subject.</div>
          ) : (
            <div className="doc-list">
              {docs.map((doc, i) => (
                <div key={i} className="doc-item">
                  <div className="doc-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="doc-name text-truncate">{doc}</span>
                  </div>
                  <button className="btn-icon-delete" onClick={() => handleDeleteFile(doc)} title="Delete file">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-danger w-full" onClick={handlePurgeSubject} disabled={docs.length === 0}>
            Purge Entire Subject
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main App ─── */
function App() {
  const [subject, setSubject] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [file, setFile] = useState(null);
  const [query, setQuery] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [threadList, setThreadList] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  
  // ─── Theme State ───
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme ? savedTheme === 'dark' : true;
  });

  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkTheme]);

  const activeSubject = subject === '__custom__' ? customSubject.toUpperCase() : subject;

  // ─── Thread Index Persistence ───
  useEffect(() => {
    if (activeSubject) {
      const savedIndex = localStorage.getItem(`thread_index_${activeSubject}`);
      let parsed = [];
      if (savedIndex) {
        try { parsed = JSON.parse(savedIndex); } catch { parsed = []; }
      }
      setThreadList(parsed);
      
      if (parsed.length > 0) {
        setActiveThreadId(parsed[0].id); // default to most recent
      } else {
        setActiveThreadId(null);
        setChatHistory([]);
      }
    } else {
      setThreadList([]);
      setActiveThreadId(null);
      setChatHistory([]);
    }
  }, [activeSubject]);

  // ─── Active Thread Persistence ───
  useEffect(() => {
    if (activeThreadId) {
      const saved = localStorage.getItem(`thread_data_${activeThreadId}`);
      if (saved) {
        try { setChatHistory(JSON.parse(saved)); } catch { setChatHistory([]); }
      } else {
        setChatHistory([]);
      }
    }
  }, [activeThreadId]);

  useEffect(() => {
    // Save only when not streaming to avoid saving partial states
    if (activeThreadId && !isStreaming) {
      localStorage.setItem(`thread_data_${activeThreadId}`, JSON.stringify(chatHistory));
    }
  }, [chatHistory, activeThreadId, isStreaming]);

  // ─── Thread Management ───
  const createNewThread = () => {
    setActiveThreadId(null);
    setChatHistory([]);
    if (window.innerWidth <= 768) setSidebarOpen(false); // Close sidebar on mobile
  };

  const switchThread = (id) => {
    if (isStreaming) return;
    setActiveThreadId(id);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const deleteThread = (e, id) => {
    e.stopPropagation();
    if (isStreaming) return;
    
    const newThreads = threadList.filter(t => t.id !== id);
    setThreadList(newThreads);
    localStorage.setItem(`thread_index_${activeSubject}`, JSON.stringify(newThreads));
    localStorage.removeItem(`thread_data_${id}`);
    
    if (activeThreadId === id) {
      setActiveThreadId(newThreads.length > 0 ? newThreads[0].id : null);
      if (newThreads.length === 0) setChatHistory([]);
    }
    toast.success('Chat deleted');
  };

  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);

  // ─── Load subjects ───
  const loadSubjects = useCallback(async () => {
    try {
      const data = await fetchSubjects();
      setSubjects(data.subjects || []);
      if (data.subjects?.length > 0 && !subject) {
        setSubject(data.subjects[0].name);
      }
    } catch { /* silent */ }
  }, [subject]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  // ─── Auto-scroll ───
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isStreaming]);

  // ─── Auto-resize textarea ───
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [query]);

  // ─── File Drop ───
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.toLowerCase().endsWith('.pdf')) {
      setFile(droppedFile);
      toast.success(`Selected: ${droppedFile.name}`);
    } else {
      toast.error('Only PDF files are supported.');
    }
  };

  // ─── Upload ───
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return toast.error('Please select a PDF file.');
    if (!activeSubject.trim()) return toast.error('Please select or enter a subject.');

    setUploading(true);
    const uploadToast = toast.loading(`Processing "${file.name}"...`);

    try {
      const res = await uploadEbook(file, activeSubject);
      toast.success(`Embedded ${res.total_chunks} chunks from "${file.name}"`, {
        id: uploadToast, duration: 4000,
      });
      setFile(null);
      loadSubjects();
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Upload failed';
      toast.error(detail, { id: uploadToast, duration: 5000 });
    }
    setUploading(false);
  };

  // ─── Chat ───
  const handleChat = async (questionText) => {
    const q = questionText || query;
    if (!q.trim() || isStreaming) return;
    if (!activeSubject.trim()) return toast.error('Please select a subject first.');

    // Thread initialization logic
    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      currentThreadId = `thread_${Date.now()}`;
      const newTitle = q.length > 25 ? q.substring(0, 25) + '...' : q;
      const newThread = { id: currentThreadId, title: newTitle, updatedAt: Date.now() };
      
      const newThreadsList = [newThread, ...threadList];
      setThreadList(newThreadsList);
      localStorage.setItem(`thread_index_${activeSubject}`, JSON.stringify(newThreadsList));
      setActiveThreadId(currentThreadId);
    } else {
      // Update the unupdatedAt time
      const updatedList = threadList.map(t => 
        t.id === currentThreadId ? { ...t, updatedAt: Date.now() } : t
      ).sort((a, b) => b.updatedAt - a.updatedAt);
      setThreadList(updatedList);
      localStorage.setItem(`thread_index_${activeSubject}`, JSON.stringify(updatedList));
    }

    const userMsg = { role: 'user', content: q };
    const aiMsgPlaceholder = { role: 'ai', content: '', sources: [] };

    setChatHistory((prev) => [...prev, userMsg, aiMsgPlaceholder]);
    setQuery('');
    setIsStreaming(true);

    abortControllerRef.current = new AbortController();
    const recentHistory = chatHistory.slice(-6).map(({ role, content }) => ({ role, content }));

    try {
      await streamQuestion(q, activeSubject, recentHistory, (parsedData) => {
        setChatHistory((prev) => {
          const newHistory = [...prev];
          const lastIndex = newHistory.length - 1;
          const currentAiMsg = { ...newHistory[lastIndex] };

          if (parsedData.type === 'sources') currentAiMsg.sources = parsedData.data;
          else if (parsedData.type === 'content') currentAiMsg.content += parsedData.data;
          else if (parsedData.type === 'error') currentAiMsg.content += `\n\n⚠️ ${parsedData.data}`;

          newHistory[lastIndex] = currentAiMsg;
          return newHistory;
        });
      }, abortControllerRef.current.signal);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setChatHistory((prev) => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1] = {
            role: 'ai', content: `⚠️ Connection error: ${error.message}`, sources: [],
          };
          return newHistory;
        });
      }
    }
    setIsStreaming(false);
    abortControllerRef.current = null;
    textareaRef.current?.focus();
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleChat();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChat();
    }
  };

  const stopGenerating = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
  };

  const clearChat = () => {
    if (activeThreadId) {
      setChatHistory([]);
      localStorage.removeItem(`thread_data_${activeThreadId}`);
      toast.success('Thread history cleared');
    }
  };

  const copyMessage = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!', { duration: 1500 });
  };

  // ─── Render ───
  return (
    <div className="app-shell">
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'toast-custom',
          style: {
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-default)', borderRadius: '12px',
            boxShadow: 'var(--shadow-lg)', backdropFilter: 'blur(10px)',
          },
          success: { iconTheme: { primary: '#34d399', secondary: '#0a0a0f' } },
          error: { iconTheme: { primary: '#f87171', secondary: '#0a0a0f' } },
        }}
      />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ═══ Sidebar ═══ */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">Smart Copilot</h1>
            <span className="brand-subtitle">Hybrid RAG Engine</span>
          </div>
          <button className="sidebar-close md-hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="sidebar-body">
          {/* Subject Selector */}
          <div className="sidebar-section">
            <label className="section-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              Domain Context
            </label>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className="select-field">
              {subjects.length === 0 && <option value="">No subjects yet</option>}
              {subjects.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.document_count} doc{s.document_count !== 1 ? 's' : ''})
                </option>
              ))}
              <option value="__custom__">+ New subject...</option>
            </select>
            {subject === '__custom__' && (
              <input
                type="text" value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value.toUpperCase())}
                placeholder="e.g. MACHINE LEARNING"
                className="input-field mt-3 slide-down"
              />
            )}
          </div>

          {/* Upload */}
          <div className="sidebar-section">
            <label className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Knowledge Base
              </span>
              <button 
                type="button" 
                className="btn-ghost btn-icon-small" 
                onClick={() => setMgmtOpen(true)}
                title="Manage documents"
                disabled={!activeSubject}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </label>
            <form onSubmit={handleUpload}>
              <div
                className={`drop-zone ${dragOver ? 'drop-zone--active' : ''} ${file ? 'drop-zone--has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                <input id="file-input" type="file" accept="application/pdf" hidden onChange={(e) => setFile(e.target.files[0])} />
                {file ? (
                  <div className="drop-zone-file">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="drop-zone-filename">{file.name}</span>
                    <span className="drop-zone-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                ) : (
                  <div className="drop-zone-empty">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>Drop PDF or click to browse</span>
                  </div>
                )}
              </div>
              <button type="submit" disabled={uploading || !file} className="btn-primary w-full mt-3">
                {uploading ? (
                  <span className="btn-loading">
                    <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Embedding...
                  </span>
                ) : 'Embed Document'}
              </button>
            </form>
          </div>

          {/* Threads */}
          {activeSubject && (
            <div className="sidebar-section thread-section">
              <label className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Recent Chats
                </span>
                <button className="btn-ghost btn-icon-small" onClick={createNewThread} title="New Chat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </label>
              <div className="thread-list custom-scrollbar">
                {threadList.length === 0 ? (
                  <div className="thread-empty">No chats yet</div>
                ) : (
                  threadList.map((thread) => (
                    <div 
                      key={thread.id} 
                      className={`thread-item ${activeThreadId === thread.id ? 'thread-item--active' : ''}`}
                      onClick={() => switchThread(thread.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="thread-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      <span className="thread-title">{thread.title}</span>
                      <button className="thread-delete" onClick={(e) => deleteThread(e, thread.id)} title="Delete chat">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button onClick={clearChat} className="btn-ghost" style={{ flex: 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Clear Chat
            </button>
            <button 
              className="btn-ghost" 
              onClick={() => setIsDarkTheme(!isDarkTheme)}
              title={isDarkTheme ? "Switch to Light Mode" : "Switch to Dark Mode"}
              style={{ width: '38px', flexShrink: 0, padding: '0' }}
            >
              {isDarkTheme ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
          </div>
          <div className="status-badge">
            <span className="status-dot" />
            <span>Hybrid RRF Active</span>
          </div>
        </div>
      </aside>

      {/* ═══ Main ═══ */}
      <main className="main-area">
        {/* Mobile header */}
        <header className="mobile-header md-hidden">
          <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>
          <span className="mobile-title">
            {activeSubject || 'Smart Copilot'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeSubject && <span className="mobile-badge">Hybrid</span>}
            <button 
              className="btn-ghost" 
              onClick={() => setIsDarkTheme(!isDarkTheme)}
              style={{ width: '32px', height: '32px', padding: 0 }}
            >
              {isDarkTheme ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
          </div>
        </header>

        {/* Chat feed */}
        <div className="chat-feed custom-scrollbar">
          <div className="chat-container">
            {/* Welcome */}
            {chatHistory.length === 0 && (
              <div className="welcome animate-fade-in-up">
                <div className="welcome-icon-wrap">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h2 className="welcome-title">
                  {activeSubject ? `Ask about ${activeSubject}` : 'Welcome to Smart Copilot'}
                </h2>
                <p className="welcome-desc">
                  {activeSubject
                    ? 'Powered by Hybrid Dense + Sparse retrieval with Reciprocal Rank Fusion.'
                    : 'Upload a PDF and select a subject to begin.'}
                </p>

                {activeSubject && (
                  <div className="suggestion-grid">
                    {SUGGESTIONS.map((s, i) => (
                      <button key={i} className="suggestion-chip" onClick={() => handleChat(s.text)}>
                        <span className="suggestion-icon">{s.icon}</span>
                        <span>{s.text}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`msg-row ${msg.role === 'user' ? 'msg-row--user' : 'msg-row--ai'} animate-message-entrance`} style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}>
                {/* Avatar */}
                <div className={`msg-avatar ${msg.role === 'user' ? 'msg-avatar--user' : 'msg-avatar--ai'}`}>
                  {msg.role === 'user' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  )}
                </div>

                {/* Bubble */}
                <div className="msg-content-wrap">
                  <div className={msg.role === 'user' ? 'msg-user' : 'msg-ai'}>
                    {msg.role === 'user' ? (
                      <p className="msg-text">{msg.content}</p>
                    ) : msg.content ? (
                      <div className="markdown-content">
                        <MarkdownContent content={msg.content} />
                      </div>
                    ) : (
                      <div className="typing-indicator">
                        <span /><span /><span />
                      </div>
                    )}
                  </div>

                  {/* Action bar for AI messages */}
                  {msg.role === 'ai' && msg.content && !isStreaming && (
                    <div className="msg-actions">
                      <button className="msg-action-btn" onClick={() => copyMessage(msg.content)} title="Copy response">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copy
                      </button>
                    </div>
                  )}

                  {/* Citations */}
                  {msg.role === 'ai' && msg.sources?.length > 0 && (
                    <div className="citations">
                      {msg.sources.map((s, i) => (
                        <span key={i} className="citation-tag">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <span className="citation-name">{s.source}</span>
                          {s.page > 0 && <span className="citation-page">p.{s.page}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div ref={chatEndRef} className="h-4" />
          </div>
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-container">
            <form onSubmit={handleFormSubmit} className="input-form">
              <div className={`input-box ${isStreaming ? 'input-box--disabled' : ''}`}>
                <textarea
                  ref={textareaRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={activeSubject ? `Ask about ${activeSubject}...` : 'Select a subject to start...'}
                  disabled={isStreaming || !activeSubject.trim()}
                  rows={1}
                  className="input-textarea"
                />
                {isStreaming ? (
                  <button type="button" onClick={stopGenerating} className="btn-stop">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!query.trim() || !activeSubject.trim()} className="btn-send">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                )}
              </div>
            </form>
            <p className="input-hint">
              <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line
            </p>
          </div>
        </div>
      </main>

      {/* Management Modal */}
      <ManagementModal 
        isOpen={mgmtOpen} 
        onClose={() => setMgmtOpen(false)} 
        subject={activeSubject}
        onDocsUpdated={loadSubjects}
        loadSubjects={loadSubjects}
      />
    </div>
  );
}

export default App;
