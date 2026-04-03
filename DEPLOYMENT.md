# Cloud Deployment Guide

This guide will help you deploy your Academic RAG Chatbot to the cloud for free using **Groq** (LLM), **Qdrant Cloud** (Vector DB), and **Render/Vercel**.

## 🚀 Phase 1: Get Your Free API Keys

1.  **Groq API Key (Fast & Free)**:
    -   Go to [console.groq.com](https://console.groq.com/).
    -   Create a free account and generate an **API Key**.
    -   This will replace Ollama in the cloud.

2.  **Qdrant Cloud (Persistent Storage)**:
    -   Go to [qdrant.tech](https://qdrant.tech/) and create a free account.
    -   Create a free cluster (choose "Free Tier").
    -   Copy the **API Key** and the **Cluster URL** (looks like `https://xxx.qdrant.io`).

## 🛠️ Phase 2: Update Your `.env` File

Add these new keys to your `.env` file before deploying:

```bash
# LLM (Using Groq for Deployment)
GROQ_API_KEY=your_groq_api_key_here

# Vector DB (Using Qdrant Cloud)
QDRANT_URL=https://your-cluster-url.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key_here
```

## 🌐 Phase 3: Deployment Steps

### 1. Deploy the Backend (FastAPI) on Render
-   **Link GitHub**: Connect your repository to [Render.com](https://render.com/).
-   **Create Secret**: Choose "New Web Service".
-   **Build Command**: `pip install -r requirements.txt`
-   **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
-   **Environment Variables**: Paste all your `.env` keys into Render's dashboard.

### 2. Deploy the Frontend (React Vite) on Vercel
-   **Vercel Import**: Connect your repo to [Vercel](https://vercel.com/).
-   **Framework**: It should auto-detect "Vite".
-   **Environment Variable**: Add `VITE_API_URL` and set it to your Render backend URL (e.g., `https://your-backend.onrender.com`).
-   **Deploy**!

## 🧪 Phase 4: Local Production Test

Before deploying, you can test the "cloud" setup locally using Docker:

```bash
# 1. Ensure your .env has the GROQ and QDRANT_URL keys
# 2. Run the production container
docker-compose up --build
```

Now your app will be running on `http://localhost:8000` but using the **Cloud LLM** and **Cloud Qdrant**!
