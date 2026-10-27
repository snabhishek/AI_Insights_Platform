# AI Insights Platform - Desktop Application (Tauri v2)

This directory contains the desktop conversion system and Tauri v2 application for **AI Insights Platform**. It packages the Next.js frontend into a native desktop application, bundles the Node.js Express backend and Python compute service as internal local services, and generates a standalone Windows NSIS installer.

---

## 1. Quick Build & Run

### A. One-Click Build (Windows)
Double-click `desktop-builder.bat` in the repository root or run:
```powershell
.\desktop-builder.ps1
```

### B. Via NPM Scripts (Root or Desktop Directory)
From the repository root:
```bash
# Build production desktop application and NSIS installer (.exe)
npm run desktop:build

# Run desktop application in development mode with live reload
npm run desktop:dev

# Run dependency diagnostics (Docker, Postgres, LiteLLM, Node)
npm run desktop:deps

# Run automated dependency setup / repair
npm run desktop:setup
```

From `src/ai-insights-desktop`:
```bash
npm run build
npm run dev
npm run deps:check
npm run deps:setup
```

### Build Artifacts
Every build generates:
- **Installer**: `dist-desktop/AI Insights Platform_1.0.0_x64-setup.exe`
- **Native Binary**: `src/ai-insights-desktop/src-tauri/target/release/app.exe`

---

## 2. Architecture & Internal Local Services

```
AI Insights Platform (Desktop)
├── Tauri v2 Native Shell (Rust Window + Webview2)
│   ├── Frontend: Next.js 16 (React 19) Statically Exported SPA
│   └── Process Supervisor (Rust)
│       ├── Node.js Backend Service (Port 22000)
│       │   ├── Express 5 + Drizzle ORM
│       │   ├── Auto-Migrations & Application Data Seeding
│       │   └── LangGraph Multi-Node AI Pipelines
│       └── Python Compute Service (Port 22004)
│           ├── FastAPI + Uvicorn
│           └── Analytical & Feature Engineering Workloads
└── External Service Connectors (Managed / Detected)
    ├── PostgreSQL (Port 22003)
    ├── LiteLLM Proxy (Port 22002)
    └── Docker Engine / Containers
```

### How Internal Local Services Work
1. **Packaging**:
   - The reusable build orchestrator (`scripts/bundle-services.mjs`) bundles the compiled Node.js backend (`dist/`, migrations, package config) and packages the Python FastAPI service as a standalone PyInstaller executable in `src-tauri/resources/services/python-service/`.
   - Python 3 and the dependencies in `src/ai-insights-service/requirements.txt` are needed on the build machine only. The NSIS installer contains the executable and does not require Python on the target machine.
   - The NSIS installer packages these resources into the final installer `.exe`.
2. **Lifecycle Management (`src-tauri/src/supervisor.rs`)**:
   - When the user launches the desktop app, the native Rust supervisor launches:
     - `ai-insights-backend` on port `22000` with `CREATE_NO_WINDOW`
     - `ai-insights-service.exe` on port `22004` with `CREATE_NO_WINDOW`
   - The supervisor waits for PostgreSQL, LiteLLM, Python, and the backend to become healthy before revealing the main window. Startup has no fixed deadline; failures that can be detected are shown on the splash screen with a retry action.
   - Logs, workspace files, PostgreSQL data, and the per-install service credentials are stored in the current user's application-data directory instead of a fixed `C:\` folder.
   - When the desktop app window is closed or exited, the supervisor terminates both process trees (`taskkill /F /T /PID`) so no orphan processes or blocked ports remain.

---

## 3. Desktop Permissions vs. Web Browser

In standard web browsers, web applications run inside sandboxed browser tabs with automatic cross-origin and local access restrictions. For Tauri desktop apps, native permissions are configured explicitly:

| Capability / Domain | Web Browser Behavior | Tauri Desktop Configuration | Purpose in Desktop App |
|---------------------|----------------------|-----------------------------|------------------------|
| **HTTP / API Fetch** | CORS restricted; allows same-origin and permitted origins | Permissive CSP: `http://localhost:* http://127.0.0.1:* https:* ws:*` | Direct fetch to Backend (22000), Python (22004), LiteLLM (22002), and AI providers (Gemini, OpenAI, Azure) |
| **Server-Sent Events** | Handled natively by browser fetch / EventSource | Allowed by Tauri CSP & Webview | Real-time streaming of LangGraph agent thinking steps (`/ai/ingestion/stream`) |
| **File System / Dialogs** | `<input type="file">` limited to browser sandbox | `dialog:default`, `fs:default` (`dialog:allow-open`, `dialog:allow-save`, `fs:allow-read-file`, `fs:allow-write-file`) | Direct selection and export of datasets (CSV, Excel, DuckDB files) without browser download restrictions |
| **Shell & Execution** | Forbidden in web | `shell:default`, `shell:allow-open` | Opening external documentation, LiteLLM UI (`http://localhost:22002/ui`), and launching dependency setup |
| **Clipboard** | Requires explicit user gesture or permission prompt | `clipboard-manager:default` (`clipboard-manager:allow-write-text`) | One-click copy of generated SQL, training configs, and thinking stream logs |
| **Notifications** | Requires web notification permission grant | `notification:default` | Native Windows desktop notifications when long background pipelines complete |
| **Window State** | Governed by browser window | `core:default`, `core:window:default`, `process:default` | Native maximize, minimize, resize, and graceful exit handling |

All capabilities are declared in `src-tauri/capabilities/default.json` and compiled directly into the binary security manifest.

---

## 4. Automated Dependency Detection & Self-Setup

The platform requires Docker Desktop, PostgreSQL, LiteLLM, and the bundled Node.js runtime. The Python compute service is bundled as an executable; Python is needed on developer/build machines but not on installed users' machines.
The desktop conversion provides an automated detection and self-setup engine (`scripts/setup-deps.ps1`):

### 1. Docker and WSL
- **Detection**: Verifies the Docker daemon using `docker info`; an open service port alone is not treated as proof that Docker is running.
- **Auto-Setup**: Attempts to start installed Docker Desktop and install it through `winget` when available. When WSL2 is missing or not ready, setup invokes the Windows WSL installer and requests administrator approval if needed.
- **WSL**: WSL2 must be ready before setup completes. If Windows requires a restart or elevation is denied, the installer reports the reason and must be run again after resolving it.

### 2. PostgreSQL
- **Detection**: Checks the local service at `127.0.0.1:22003`.
- **Auto-Setup**: Docker Compose runs `postgres:16-alpine` with persistent data under the current user's application-data directory. Existing data from earlier installs is copied before the new Compose volume is used.
- Database schema migrations run automatically on startup via Drizzle ORM in the backend.

### 3. LiteLLM Proxy
- **Detection**: Checks LiteLLM's health endpoint at `127.0.0.1:22002`.
- **Auto-Setup**: Docker Compose starts the bundled LiteLLM configuration and setup registers the DuckDuckGo and You.com search tools. Search requests use the configured local LiteLLM credential.

### 4. Node.js
- **Detection**: Uses the bundled `resources/bin/node.exe` runtime; backend dependencies are restored from the verified bundle or installed reproducibly from `package-lock.json`.

The Compose ports are bound to loopback, PostgreSQL does not enable broad `trust` authentication, and infrastructure credentials are generated per user install and stored in the user's application-data directory. Installer setup does not import provider API keys, active models, or LiteLLM virtual keys from a backend `.env`; configure a provider and model from the Configuration page after installation. Docker Desktop preferences are not modified by Compass.

The Python service must be built as the bundled executable before starting Tauri, including in development. Run `npm run build:python-service` from `src/ai-insights-desktop`; the supervisor does not discover or install a host Python interpreter, create a virtual environment, or fall back to Python source.
