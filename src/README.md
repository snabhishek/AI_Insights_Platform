# AI Insights Platform

An end-to-end autonomous data intelligence and AI pipeline platform. The platform connects to diverse data sources, performs automated schema extraction and safe profiling, orchestrates multi-stage LangGraph AI agents for semantic resolution and feature architecture, and delivers an interactive Next.js web application for monitoring and control.

---

## Architecture Overview

```
AI-Insights-Platform/
└── src/
    ├── ai-insights-backend/    # Express + TypeScript core backend, Drizzle ORM, LangGraph agents, DuckDB
    ├── ai-insights-webapp/     # Next.js 16 (React 19) dashboard, visual pipeline & live agent stream
    ├── ai-insights-service/    # Python (FastAPI) microservice for high-performance AI/data compute
    └── packages/               # Shared project assets and schema definitions
```

---

## Applications & Features

### 1. Backend Core (`ai-insights-backend`)
- **Layered Architecture**: Express 5 + TypeScript structured into Controllers, Services, and Repositories with constructor dependency injection.
- **Multi-Source Connectors**: Connects to PostgreSQL, MySQL, MSSQL, DuckDB, Excel/CSV, and local data files with schema inspection, connection testing, and preview generation.
- **Drizzle ORM & PostgreSQL**: Database migrations, workspace management, project run persistence, and connector metadata.
- **DuckDB Analytical Engine**: Embedded high-performance in-memory and file-based OLAP processing for fast query profiling and sampling.
- **Autonomous LangGraph AI Pipeline**:
  - **1.1 Inspector**: Deterministic schema catalog queries and LLM-assisted hidden relationship/key inference.
  - **1.2 Data Profiler**: Production-safe sampling queries (strict timeouts, row caps) and LLM classification (PII detection, column semantics, categorical distributions).
  - **1.3 Schema Resolver**: Synthesizes profiling outputs into human-readable semantic data dictionaries and isolated, table-specific system prompts for Text-to-SQL.
  - **Feature Architecture & Training**: Multi-node agent workflows for automated feature engineering and model training validation.
- **Agent Thinking Stream**: Tracks reasoning steps, pauses, resumes, and state checkpoints with real-time API visibility.

### 2. Frontend Dashboard (`ai-insights-webapp`)
- **Next.js 16 & React 19**: Modern UI built with Tailwind CSS v4 and responsive layouts.
- **Workspaces & Projects**: Organize data workflows into isolated workspaces and individual analytical projects.
- **Data Source Manager**: Interactive UI to configure, test, sync, preview, and monitor database/file connections.
- **Visual Workflow Pipeline**: Visual progress tracker across Ingestion, Profiling, Feature Engineering, and Model Training stages.
- **Live Agent Thinking Stream**: Real-time observability into LLM reasoning, node transitions, and execution logs.

### 3. Python Service (`ai-insights-service`)
- **FastAPI Microservice**: Lightweight, high-throughput Python 3.12+ ASGI service for dedicated data processing and ML workloads.
- **OpenAPI / Swagger**: Auto-generated interactive API docs (`/docs`) and built-in health diagnostics (`/health`).

---

## Quick Start Guide

### Prerequisites
- **Node.js**: v20+ & `npm`
- **Python**: v3.12+
- **PostgreSQL**: Running instance (default: `localhost:5434` or configured via `.env`)

---

### 1. Backend (`ai-insights-backend`)

1. **Navigate & configure**:
   ```bash
   cd src/ai-insights-backend
   cp .env.example .env
   # Update DB credentials (DB_PORT, DB_PASS) and AI keys (GEMINI_API_KEY / OPENAI_API_KEY) in .env
   ```

2. **Install & start**:
   ```bash
   npm install
   npm run dev
   ```
   - **API Server**: `http://localhost:5000`
   - **Health Check**: `http://localhost:5000/api/health`

---

### 2. Web App (`ai-insights-webapp`)

1. **Navigate & configure**:
   ```bash
   cd src/ai-insights-webapp
   # Ensure .env.local contains: NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:5000/api
   ```

2. **Install & start**:
   ```bash
   npm install
   npm run dev
   ```
   - **Web Dashboard**: `http://localhost:3000`

---

### 3. AI Service (`ai-insights-service`)

1. **Navigate & activate environment**:
   ```bash
   cd src/ai-insights-service

   # Windows (PowerShell / CMD)
   .venv\Scripts\activate

   # Linux / macOS
   source .venv/bin/activate
   ```

2. **Install & start**:
   ```bash
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
   - **Service Endpoint**: `http://localhost:8000`
   - **Swagger Docs**: `http://localhost:8000/docs`
   - **Health Check**: `http://localhost:8000/health`
