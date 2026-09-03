# Workflow Logs Fix Plan: Static Logs to Real-time Updates

## 1. Problem Summary & Root Cause Analysis

### 🔴 Primary Issue: Disconnected Logging System
Agent thinking logs in the AI workflow system appear static, freeze during execution, and fail to update seamlessly. Users encounter frozen logs or "Output is not received yet" placeholders even while agents are actively executing or after workflows complete.

### Root Causes
1. **Frontend State Disconnect in SSE Stream**:
   - The SSE stream in `src/ai-insights-webapp/app/components/pages/ProjectsPage.tsx` parses incoming chunks in `updateWorkflowState()`, updating statuses and stage outputs, but completely drops `chunk.data.agentThinking`.
   - `ProjectsPage.tsx` never stored `agentThinking` in React state or passed it down to `ProjectDetailPage.tsx`.
   - `ProjectDetailPage.tsx` passes a static `agentState={project.agentState}` to `<CardModal>`, which is the snapshot loaded when the page opened. It never receives live SSE updates.
2. **CardModal Static Fetching & Disconnected Lifecycle**:
   - `CardModal.tsx` fetches thinking logs only once on mount or when `activeStep.id` changes via `fetchAgentThinkingApi()`.
   - Once rendered, logs never update during workflow progress.
   - For completed workflows, there is no polling fallback or automatic refresh mechanism.
   - When a step has no structured data output yet, `CardModal` only checks `stepOutputContent`, displaying a blank "Output is not received yet" message instead of directing users to the active agent reasoning.
3. **Inconsistent Naming & Stage Mapping**:
   - Backend LangGraph uses node IDs (`inspect`, `profileData`, `preprocess`, `resolveSchema`, `hierarchyMapperNode`, `featureArchitectNode`, `exogenousScout`).
   - Frontend UI uses step IDs (`Data Inspection`, `Data Profiling`, `Schema Resolver`, `Hierarchy Mapper`, `Feature Architect`, `Feature Validator`, `Exogenous Scout`).
   - `getAllProjectPipelineThinking()` relies on a hardcoded list and inconsistent pipeline strings (`"Data Ingestion"` vs `"Feature Engineering"`), leading to missed logs.
4. **Backend Multi-Query DB Latency**:
   - `getAllProjectPipelineThinking()` currently performs 19 to 57 sequential database queries (`getThinking()`) on every thinking update, causing unnecessary latency on each emitted SSE chunk.

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Backend ["AI Insights Backend"]
        Agent["Agent Node / Tool Reasoning"] -->|logAgentMessagesAsThinking| ATS["AgentThinkingService"]
        ATS -->|Bulk save to Postgres| DB[(agent_thinking Table)]
        ATS -->|onThinkingUpdate| IAS["IngestionAgentService"]
        IAS -->|getAllProjectPipelineThinking (single query)| IAS
        IAS -->|Emit job:update with agentThinking| SSE["SSE Stream (/ai/ingestion)"]
        Ctrl["AIController (GET /ai/thinking?projectId=...)"] -->|Bulk Fetch| ATS
    end

    subgraph Frontend ["AI Insights WebApp"]
        SSE -->|Live Chunk with agentThinking| PP["ProjectsPage.tsx (updateWorkflowState)"]
        PP -->|setAgentThinking state| PDP["ProjectDetailPage.tsx"]
        PDP -->|Live agentThinking prop| CM["CardModal.tsx"]
        CM -->|Live Auto-scrolling Terminal| ART["Agent Reasoning Tab"]
        CM -->|Optional Fallback Polling / Refresh| Ctrl
    end
```

---

## 3. Implementation Phases

### Phase 1: Backend - High-Performance Log Aggregation & Endpoints

#### Task 1.1: Add Bulk Log Retrieval to Repository and Service
**Files**:
- `src/ai-insights-backend/src/repositories/agentThinking.repository.interface.ts`
- `src/ai-insights-backend/src/repositories/agentThinking.repository.ts`
- `src/ai-insights-backend/src/services/ai/agent-thinking/agentThinking.service.interface.ts`
- `src/ai-insights-backend/src/services/ai/agent-thinking/agentThinking.service.ts`

**Changes Required**:
1. Add `getAllThinking(projectId: string, pipeline?: string): Promise<Record<string, ThinkingLog[]>>` to repository interface and implementation.
2. Implement using a single performant SQL query:
   ```typescript
   async getAllThinking(projectId: string, pipeline?: string): Promise<Record<string, ThinkingLog[]>> {
     const conditions = [eq(agentThinking.projectId, projectId)];
     if (pipeline) {
       conditions.push(eq(agentThinking.pipeline, pipeline));
     }
     const rows = await db
       .select()
       .from(agentThinking)
       .where(and(...conditions));

     const map: Record<string, ThinkingLog[]> = {};
     for (const row of rows) {
       map[row.substep] = (row.thinking as ThinkingLog[]) || [];
     }
     return map;
   }
   ```
3. Expose through `AgentThinkingService`.

**Acceptance Criteria**:
- [ ] Single DB query retrieves all substep logs for a project in < 10ms.
- [ ] Replaces 19–57 sequential queries in `getAllProjectPipelineThinking()`.

#### Task 1.2: Standardize Stage Mapping & Optimize IngestionAgentService
**File**: `src/ai-insights-backend/src/services/ai/ingestion-agent/ingestionAgent.service.ts`

**Changes Required**:
1. Define a centralized canonical stage alias map:
   ```typescript
   export const STAGE_ALIAS_MAP: Record<string, string[]> = {
     "Data Inspection": ["inspect", "Data Inspection", "Data Ingestion"],
     "Data Profiling": ["profileData", "preprocess", "Data Profiling"],
     "Schema Resolver": ["resolveSchema", "Schema Resolver"],
     "Hierarchy Mapper": ["hierarchyMapper", "hierarchyMapperNode", "Hierarchy Mapper", "relationshipBuilder", "formBuilder"],
     "Feature Architect": ["featureArchitect", "featureArchitectNode", "Feature Architect", "featureSupervisor", "featureCreation", "featureTransformation", "buildDataset", "featureExtraction", "featureSelection", "programRectifier", "Feature Engineering"],
     "Feature Validator": ["featureValidator", "featureValidatorNode", "Feature Validator", "dataValidation"],
     "Exogenous Scout": ["exogenous", "exogenousScout", "Exogenous Scout"],
   };
   ```
2. Refactor `getAllProjectPipelineThinking(projectId, pipeline)`:
   - Call `this.agentThinkingService.getAllThinking(projectId)`.
   - Normalize and populate both canonical UI step names (`"Data Inspection"`) and internal node names (`"inspect"`) so the frontend finds logs under any identifier.
   - Aggregate worker sub-logs (e.g. `featureSupervisor`, `featureCreation`) into `"Feature Architect"` seamlessly without duplicate text entries.
3. Ensure every SSE emission (`job:update`, completion, pause, error) includes `result.agentThinking`.

**Acceptance Criteria**:
- [ ] All substep logs are indexed under both canonical titles and node IDs.
- [ ] No missing logs due to pipeline name mismatch (`"Data Ingestion"` vs `"Feature Engineering"`).
- [ ] End-of-workflow updates guarantee `agentThinking` is populated.

#### Task 1.3: Enhance `/ai/thinking` API Endpoint
**Files**:
- `src/ai-insights-backend/src/controllers/ai.controller.ts`
- `src/ai-insights-backend/src/routes/ai.ts`

**Changes Required**:
1. Update `getThinking` in `AIController` to make `substep` optional:
   - If `substep` is provided: return `{ success: true, data: { thinking: [...] } }`.
   - If `substep` is omitted: return all project logs: `{ success: true, data: { agentThinking: Record<string, ThinkingLog[]> } }`.
2. Add support for cache-control headers (`no-cache`) to ensure fresh logs.

**Acceptance Criteria**:
- [ ] `GET /ai/thinking?projectId=...` returns all substep logs in one payload.
- [ ] Backward compatible with `GET /ai/thinking?projectId=...&pipeline=...&substep=...`.

---

## 4. Phase 2: Frontend - Real-Time State Integration

#### Task 2.1: Update Workflow Service Types & API Methods
**File**: `src/ai-insights-webapp/app/services/aiWorkflowService.ts`

**Changes Required**:
1. Add `agentThinking` to `WorkflowResponseData`:
   ```typescript
   export interface WorkflowResponseData {
     status: string;
     summary: string;
     stageStatuses?: Record<string, string>;
     stageOutputs?: Record<string, unknown>;
     agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
     sessionId?: string;
     requiresApproval?: boolean;
     nextStep?: string;
     currentNode?: string;
     currentStage?: string;
     message?: string;
   }
   ```
2. Add `fetchProjectThinkingApi(projectId: string, pipeline?: string)` to retrieve the full thinking dictionary.
3. Add a safe `createLogPollingSubscription(projectId, pipeline, onLogUpdate, intervalMs)` utility as a fallback for background or completed runs.

**Acceptance Criteria**:
- [ ] TypeScript interfaces reflect `agentThinking`.
- [ ] Client can fetch full thinking map in a single call.

#### Task 2.2: Integrate Real-time Thinking State in ProjectsPage
**File**: `src/ai-insights-webapp/app/components/pages/ProjectsPage.tsx`

**Changes Required**:
1. Add React state for live thinking logs:
   ```typescript
   const [agentThinking, setAgentThinking] = useState<Record<string, Array<{ time: string; text: string; done: boolean }>>>({});
   ```
2. In `updateWorkflowState(payload)`:
   ```typescript
   if (payload.agentThinking) {
     setAgentThinking((prev) => ({
       ...prev,
       ...payload.agentThinking,
     }));
   }
   ```
3. When selecting or loading a project, initialize `agentThinking` from `selectedProject.agentState?.agentThinking` and invoke `fetchProjectThinkingApi` to populate any completed historical logs.
4. Pass `agentThinking={agentThinking}` down to `<ProjectDetailPage>`.

**Acceptance Criteria**:
- [ ] SSE chunks immediately trigger React state updates for thinking logs.
- [ ] Logs persist between step changes and workflow pause/resume.
- [ ] Initial project load displays historical logs immediately.

#### Task 2.3: Pass Live Logs Through ProjectDetailPage
**File**: `src/ai-insights-webapp/app/components/projects/ProjectDetailPage.tsx`

**Changes Required**:
1. Add `agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>` to `ProjectDetailPageProps`.
2. Pass `agentThinking={agentThinking}` into `<CardModal>`.
3. Pass `agentThinking` into step output components where applicable.

**Acceptance Criteria**:
- [ ] Clean prop threading from `ProjectsPage` to `CardModal`.
- [ ] No stale `project.agentState` closures.

---

## 5. Phase 3: Frontend - Enhanced CardModal & Output Components

#### Task 3.1: Modernize CardModal "Agent Reasoning" Live Console
**File**: `src/ai-insights-webapp/app/components/shared/ui/CardModal.tsx`

**Changes Required**:
1. Update `CardModalProps` to accept `agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>`.
2. Synchronize active step logs reactively:
   - Prefer live `agentThinking[activeStep.id]`.
   - Fallback to canonical aliases (e.g. `agentThinking["inspect"]` if `activeStep.id === "Data Inspection"`).
   - If empty and project is idle/completed, trigger `fetchProjectThinkingApi(projectId)` once.
3. Auto-scroll terminal log container:
   ```typescript
   const logsEndRef = useRef<HTMLDivElement>(null);
   useEffect(() => {
     if (activeTab === "thinking") {
       logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
     }
   }, [thinkingLogs, activeTab]);
   ```
4. Add manual "Refresh Logs" button and loading indicator in header.
5. In "Step Output" tab: when `hasOutput` is false, add an interactive callout:
   *"Step output is currently being generated. [View Live Agent Reasoning →]"* that switches `activeTab` to `"thinking"`.

**Acceptance Criteria**:
- [ ] Agent Reasoning logs update in real-time as SSE events arrive.
- [ ] Auto-scroll keeps latest logs visible during execution.
- [ ] Empty output state guides user to the Reasoning tab instead of showing a dead-end placeholder.

#### Task 3.2: Create Shared AgentLogDisplay Component
**File**: `src/ai-insights-webapp/app/components/projects/pipeline-outputs/shared/AgentLogDisplay.tsx` (new file)

**Changes Required**:
1. Build a reusable, styled component that renders timestamped agent thinking entries with:
   - Pulse animation for active step
   - Checkmark for completed entries
   - Syntax-highlighted reasoning and tool invocation parameters
   - Copy-to-clipboard button for debugging

**Acceptance Criteria**:
- [ ] Clean, reusable UI component adhering to design system.
- [ ] Reusable across modal, drawer, or standalone output views.

#### Task 3.3: Implement ModelTrainingValidationStepOutput UI
**File**: `src/ai-insights-webapp/app/components/projects/pipeline-outputs/ModelTrainingValidationStepOutput.tsx`

**Changes Required**:
1. Replace empty fragment `<></>` with a proper step output placeholder displaying:
   - Model configuration overview
   - Candidate models list (e.g., LightGBM, XGBoost, Prophet)
   - Status badge and agent reasoning integration

**Acceptance Criteria**:
- [ ] Component renders structured information instead of blank whitespace.

---

## 6. Phase 4: Testing & Verification Plan

### Automated & Build Verification
1. **Backend Build**:
   ```bash
   cd src/ai-insights-backend && npm run build
   ```
2. **Frontend Build / Typecheck**:
   ```bash
   cd src/ai-insights-webapp && npm run build
   ```

### Manual Verification
1. **Real-time Streaming Test**:
   - Start ingestion workflow on a project with an active data connector.
   - Open `<CardModal>` on "Data Inspection" or "Data Profiling".
   - Switch to "Agent Reasoning" tab: verify that reasoning logs stream line-by-line in real-time with timestamps.
   - Verify auto-scroll pins to bottom as new logs arrive.
2. **Historical / Completed Workflow Test**:
   - Open a project whose workflow finished earlier.
   - Open `<CardModal>`: verify logs are immediately visible without needing to re-run.
3. **Step Navigation Test**:
   - Click between different steps in `CardModal` left sidebar (e.g., "Data Inspection", "Data Profiling", "Schema Resolver").
   - Verify logs update to match the selected step immediately.
4. **Pause / Resume Test**:
   - Pause workflow: verify logs reflect paused status.
   - Resume workflow: verify logs resume appending without wiping previous history.

---

## 7. Risk Mitigation

| Risk | Mitigation |
| :--- | :--- |
| **High SSE message frequency causing React lag** | State update in `updateWorkflowState` merges shallow dictionary; use memoization on log rows. |
| **Database connection pool exhaustion** | Replace loop queries with single bulk query `WHERE project_id = $1`. |
| **Name mismatch between backend & frontend** | Bidirectional alias mapping (`STAGE_ALIAS_MAP`) resolves both node names and display titles. |