# AI Insights Platform — REST API Documentation

- **Base URL**: `http://localhost:5000/api` (or `http://127.0.0.1:5000/api`)
- **Default Headers**:
  ```http
  Content-Type: application/json
  Accept: application/json
  ```
- **Composition Root**: [src/index.ts](file:///d:/CEI_AI_DEV/AI-Insights-Platform/AI_Insights_Platform/src/ai-insights-backend/src/index.ts)

---

## Table of Contents
1. [System & Health](#1-system--health)
2. [Workspaces & Projects](#2-workspaces--projects)
3. [Connectors & Data Sources](#3-connectors--data-sources)
4. [Dynamic Filter Options](#4-dynamic-filter-options)
5. [AI Workflow & Agent Thinking](#5-ai-workflow--agent-thinking)
6. [Business Domains](#6-business-domains)
7. [Error Handling & Status Codes](#7-error-handling--status-codes)

---

## 1. System & Health

### `GET /api/health`
Performs a lightweight liveness and health check on the backend instance.

* **Method**: `GET`
* **Path**: `/api/health`
* **Request Headers**: None
* **Request Body**: None
* **Response**: `200 OK`
```json
{
  "status": "healthy",
  "timestamp": "2026-09-09T12:00:00.000Z"
}
```

---

## 2. Workspaces & Projects

### `GET /api/workspaces`
Returns all workspaces ordered with the default workspace first, followed by custom workspaces sorted by creation date.

* **Method**: `GET`
* **Path**: `/api/workspaces`
* **Request Body**: None
* **Response**: `200 OK`
```json
[
  {
    "id": "default",
    "name": "Default Workspace",
    "isDefault": true,
    "createdAt": "2026-09-01T08:00:00.000Z"
  },
  {
    "id": "ws-550e8400-e29b-41d4-a716-446655440000",
    "name": "Finance Analytics",
    "isDefault": false,
    "createdAt": "2026-09-05T10:30:00.000Z"
  }
]
```

---

### `POST /api/workspaces`
Creates a new workspace.

* **Method**: `POST`
* **Path**: `/api/workspaces`
* **Request Body**:
```json
{
  "name": "Marketing Analytics"
}
```
* **Validation**:
  * `name` (`string`, required): Workspace name cannot be blank or duplicate.
* **Response**: `201 Created`
```json
{
  "id": "ws-771f8400-e29b-41d4-a716-446655440111",
  "name": "Marketing Analytics",
  "isDefault": false,
  "createdAt": "2026-09-09T12:15:00.000Z"
}
```
* **Errors**:
  * `400 Bad Request`: `{ "success": false, "message": "Workspace name is required." }`
  * `409 Conflict`: `{ "success": false, "message": "Workspace named \"Marketing Analytics\" already exists." }`

---

### `DELETE /api/workspaces/:id`
Deletes a non-default workspace along with its associated projects, metadata YAMLs, and DuckDB storage files.

* **Method**: `DELETE`
* **Path**: `/api/workspaces/:id`
* **URL Parameter**: `:id` (e.g., `ws-771f8400-e29b-41d4-a716-446655440111`)
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Workspace deleted."
}
```
* **Errors**:
  * `403 Forbidden`: Cannot delete default workspace (`"The Default Workspace cannot be deleted."`).
  * `404 Not Found`: Workspace ID does not exist.

---

### `GET /api/workspaces/:id/projects`
Retrieves all projects belonging to the specified workspace.

* **Method**: `GET`
* **Path**: `/api/workspaces/:id/projects`
* **URL Parameter**: `:id` (Workspace ID, e.g. `default` or `ws-550e...`)
* **Response**: `200 OK`
```json
[
  {
    "id": "proj-982c7300-e29b-41d4-a716-446655440022",
    "name": "Customer Churn Prediction",
    "role": "OWNER",
    "dataSources": ["conn-101", "conn-102"],
    "initials": "JD",
    "workspaceId": "default",
    "useCase": "Identify high-risk churn customers in Q3.",
    "domain": "Retail & E-Commerce",
    "subDomain": "Customer & Loyalty Analytics",
    "status": "idle",
    "createdAt": "2026-09-06T14:20:00.000Z"
  }
]
```

---

### `POST /api/workspaces/:id/projects`
Creates an analytical project in a workspace, generates the project schema YAML file, and automatically ingests connected sources into DuckDB under `Projects/<projectName>/`.

* **Method**: `POST`
* **Path**: `/api/workspaces/:id/projects`
* **URL Parameter**: `:id` (Workspace ID, e.g. `default`)
* **Request Body**:
```json
{
  "name": "Customer Churn Prediction",
  "dataSources": [
    "conn-101"
  ],
  "role": "OWNER",
  "domain": "Retail & E-Commerce",
  "subDomain": "Customer & Loyalty Analytics",
  "useCase": "Predict customer churn probability and analyze risk factors.",
  "initials": "JD"
}
```
* **Field Specifications**:
  * `name` (`string`, required): Project name.
  * `dataSources` (`string[]`, required): Non-empty array of connector IDs.
  * `role` (`"OWNER" | "MEMBER"`, optional, default: `"OWNER"`).
  * `domain` (`string`, optional): Business domain.
  * `subDomain` (`string`, optional): Business sub-domain.
  * `useCase` (`string`, optional): Business problem definition.
  * `initials` (`string`, optional, default: `"US"`).
* **Response**: `201 Created`
```json
{
  "id": "proj-982c7300-e29b-41d4-a716-446655440022",
  "name": "Customer Churn Prediction",
  "role": "OWNER",
  "dataSources": ["conn-101"],
  "initials": "JD",
  "workspaceId": "default",
  "useCase": "Predict customer churn probability and analyze risk factors.",
  "domain": "Retail & E-Commerce",
  "subDomain": "Customer & Loyalty Analytics",
  "agentState": {},
  "createdAt": "2026-09-09T12:30:00.000Z"
}
```
* **Errors**:
  * `400 Bad Request`: Name missing, or `dataSources` is empty/missing.
  * `404 Not Found`: Workspace ID not found.
  * `409 Conflict`: Project with the same name and identical data sources already exists.

---

### `PUT /api/workspaces/:id/projects/:pid`
Updates an existing project's metadata, status, connected sources, or AI agent state.

* **Method**: `PUT`
* **Path**: `/api/workspaces/:id/projects/:pid`
* **URL Parameters**: `:id` (Workspace ID), `:pid` (Project ID)
* **Request Body**:
```json
{
  "name": "Customer Churn Prediction v2",
  "useCase": "Updated scope: churn prediction for premium tier only",
  "dataSources": ["conn-101", "conn-102"],
  "status": "running",
  "agentState": {
    "currentStage": "data_profile",
    "completedSteps": ["inspection", "schema_resolution"]
  }
}
```
* **Response**: `200 OK` (Returns updated `Project` object)

---

### `GET /api/workspaces/:id/projects/:pid/runs`
Fetches all historical workflow runs recorded for a project.

* **Method**: `GET`
* **Path**: `/api/workspaces/:id/projects/:pid/runs`
* **URL Parameters**: `:id` (Workspace ID), `:pid` (Project ID)
* **Response**: `200 OK`
```json
[
  {
    "id": "run-1a2b3c4d",
    "projectId": "proj-982c7300-e29b-41d4-a716-446655440022",
    "useCase": "Predict customer churn probability.",
    "status": "completed",
    "agentState": {
      "accuracy": 0.89,
      "generatedParquet": "selected_features.parquet"
    },
    "createdAt": "2026-09-08T10:00:00.000Z"
  }
]
```

---

### `DELETE /api/workspaces/:id/projects/:pid`
Deletes a project and removes its schema YAML definitions and DuckDB folder.

* **Method**: `DELETE`
* **Path**: `/api/workspaces/:id/projects/:pid`
* **URL Parameters**: `:id` (Workspace ID), `:pid` (Project ID)
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Project deleted."
}
```

---

## 3. Connectors & Data Sources

Supported types: `postgres`, `mysql`, `sqlserver`, `snowflake`, `mongodb`, `excel`, `csv`, `tsv`, `restapi`.

### `GET /api/connectors`
Lists all data source connectors. Optionally filters by `workspaceId`.

* **Method**: `GET`
* **Path**: `/api/connectors`
* **Query Parameters**:
  * `workspaceId` (`string`, optional): e.g. `?workspaceId=default`
* **Response**: `200 OK`
```json
[
  {
    "id": "conn-101",
    "name": "Production Postgres",
    "subtext": "Core transactional database",
    "type": "postgres",
    "status": "Connected",
    "health": "Healthy",
    "lastSyncTime": "14:32",
    "lastSyncDate": "2026-09-09",
    "createdAt": "2026-09-01T08:00:00.000Z",
    "workspaceId": "default",
    "connectionConfig": {
      "host": "localhost",
      "port": "5432",
      "database": "ecommerce_db",
      "username": "postgres"
    },
    "assets": {
      "tables": 14,
      "views": 2,
      "pipelines": 1
    }
  }
]
```

---

### `POST /api/connectors/test`
Validates a connection configuration without persisting it.

* **Method**: `POST`
* **Path**: `/api/connectors/test`
* **Request Body**:
```json
{
  "type": "postgres",
  "config": {
    "host": "localhost",
    "port": "5432",
    "database": "ecommerce_db",
    "username": "postgres",
    "password": "secretpassword"
  }
}
```
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Connection successful",
  "latencyMs": 14
}
```

---

### `POST /api/connectors`
Registers and persists a new connector. Pre-validates the connection before saving.

* **Method**: `POST`
* **Path**: `/api/connectors`
* **Request Body (Database Source)**:
```json
{
  "name": "Production Postgres",
  "type": "postgres",
  "subtext": "Core transactional database",
  "workspaceId": "default",
  "config": {
    "host": "localhost",
    "port": "5432",
    "database": "ecommerce_db",
    "username": "postgres",
    "password": "secretpassword"
  }
}
```
* **Request Body (File Source: CSV/Excel)**:
```json
{
  "name": "Quarterly Sales Upload",
  "type": "csv",
  "subtext": "Manual CSV dump",
  "workspaceId": "default",
  "config": {
    "fileName": "q3_sales.csv",
    "fileContent": "data:text/csv;base64,b3JkZXJfaWQ..."
  }
}
```
* **Response**: `201 Created` (Returns created `Connector` object)
* **Errors**:
  * `400 Bad Request`: Missing `name`, `type`, or `subtext`, or connection test failed.
  * `409 Conflict`: Connector with identical name and type exists in workspace.

---

### `GET /api/connectors/:id`
Fetches a single connector's details by ID.

* **Method**: `GET`
* **Path**: `/api/connectors/:id`
* **URL Parameter**: `:id` (e.g., `conn-101`)
* **Response**: `200 OK` (Returns `Connector` JSON)

---

### `PUT /api/connectors/:id`
Updates connector name and merged configuration parameters.

* **Method**: `PUT`
* **Path**: `/api/connectors/:id`
* **URL Parameter**: `:id`
* **Request Body**:
```json
{
  "name": "Production Postgres (Primary)",
  "config": {
    "host": "postgres.production.internal",
    "port": "5432"
  }
}
```
* **Response**: `200 OK` (Returns updated `Connector` JSON)

---

### `DELETE /api/connectors/:id`
Removes a connector and cascades deletions where configured.

* **Method**: `DELETE`
* **Path**: `/api/connectors/:id`
* **URL Parameter**: `:id`
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Connector deleted successfully"
}
```

---

### `GET /api/connectors/:id/schema`
Discovers tables, views, columns, and data types for the connector.

* **Method**: `GET`
* **Path**: `/api/connectors/:id/schema`
* **URL Parameter**: `:id`
* **Response**: `200 OK`
```json
{
  "success": true,
  "type": "postgres",
  "tables": [
    {
      "name": "customers",
      "columns": [
        { "name": "customer_id", "type": "integer", "isNullable": false },
        { "name": "email", "type": "varchar", "isNullable": true },
        { "name": "created_at", "type": "timestamp", "isNullable": false }
      ]
    },
    {
      "name": "orders",
      "columns": [
        { "name": "order_id", "type": "integer", "isNullable": false },
        { "name": "customer_id", "type": "integer", "isNullable": false },
        { "name": "total_amount", "type": "numeric", "isNullable": false }
      ]
    }
  ]
}
```

---

### `GET /api/connectors/:id/preview`
Returns a sample preview of rows from a table or file source.

* **Method**: `GET`
* **Path**: `/api/connectors/:id/preview`
* **URL Parameter**: `:id`
* **Query Parameters**:
  * `table` (`string`, optional for single files, required for relational databases): e.g. `?table=customers`
* **Response**: `200 OK`
```json
{
  "success": true,
  "headers": ["customer_id", "email", "created_at"],
  "rows": [
    [1001, "alice@example.com", "2026-01-15T09:30:00Z"],
    [1002, "bob@example.com", "2026-01-16T14:12:00Z"]
  ]
}
```

---

### `GET /api/connectors/:id/health`
Executes an on-demand latency and health check for a connector, updating its status in the database.

* **Method**: `GET`
* **Path**: `/api/connectors/:id/health`
* **URL Parameter**: `:id`
* **Response**: `200 OK`
```json
{
  "success": true,
  "health": "Healthy",
  "message": "Connected successfully",
  "latencyMs": 18
}
```

---

### `POST /api/connectors/:id/sync`
Triggers an asynchronous background metadata refresh for the connector.

* **Method**: `POST`
* **Path**: `/api/connectors/:id/sync`
* **URL Parameter**: `:id`
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Sync started"
}
```

---

### `POST /api/connectors/sync-all`
Initiates a background sync across all configured connectors.

* **Method**: `POST`
* **Path**: `/api/connectors/sync-all`
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Syncing all connectors"
}
```

---

### `POST /api/connectors/:id/disconnect`
Sets the connector status to `Disconnected`.

* **Method**: `POST`
* **Path**: `/api/connectors/:id/disconnect`
* **URL Parameter**: `:id`
* **Response**: `200 OK` (Returns updated `Connector` JSON)

---

### `POST /api/connectors/:id/connect`
Sets the connector status back to `Connected`.

* **Method**: `POST`
* **Path**: `/api/connectors/:id/connect`
* **URL Parameter**: `:id`
* **Response**: `200 OK` (Returns updated `Connector` JSON)

---

## 4. Dynamic Filter Options

### `GET /api/connectors/filter-options` *(also mounted at `GET /api/filter-options`)*
Fetches cascaded distinct values or date ranges for dashboard exploratory controls.

* **Method**: `GET`
* **Path**: `/api/connectors/filter-options` or `/api/filter-options`
* **Query Parameters**:
  * `sourceId` (`string`, required): Connector ID or Project ID.
  * `fieldId` (`string`, required): Target column name (e.g., `order_status` or `order_date`).
  * `table` (`string`, optional): Specific table name.
  * `search` (`string`, optional): Search query to filter option values.
  * `controlType` (`string`, optional): e.g., `dropdown`, `multiselect`, `daterange`.
  * `parents` (`string`, optional): JSON string of parent filter selections (e.g. `{"country":"US"}`).
  * `limit` (`number`, optional, default: `50`): Max options to return.
* **Example URL**:
  ```http
  GET /api/filter-options?sourceId=conn-101&table=orders&fieldId=order_status&search=Comp
  ```
* **Response**: `200 OK`
```json
{
  "success": true,
  "sourceId": "conn-101",
  "fieldId": "order_status",
  "values": [
    "Completed",
    "Partially Completed"
  ],
  "totalCount": 2,
  "dateRange": null,
  "isIndependentFallback": false
}
```

---

## 5. AI Workflow & Agent Thinking

### `POST /api/ai/ingestion`
Starts or resumes the multi-stage AI Data Ingestion Agent workflow.  
> [!IMPORTANT]
> This endpoint uses **Server-Sent Events (SSE)** streaming. The client should maintain an open connection reading `text/event-stream`.

* **Method**: `POST`
* **Path**: `/api/ai/ingestion`
* **Headers**: `Content-Type: application/json`
* **Request Body**:
```json
{
  "connectorId": ["conn-101"],
  "userPrompt": "Focus on high-value transaction outliers and prepare data for churn modeling.",
  "projectId": "proj-982c7300-e29b-41d4-a716-446655440022",
  "sessionId": "sess-449102",
  "action": "resume",
  "step": "schema_resolution"
}
```
* **Field Specifications**:
  * `connectorId` (`string[]`, required): List of connector IDs to ingest and analyze.
  * `userPrompt` / `prompt` (`string`, optional): Instructions or analytical focus for the AI agents.
  * `projectId` (`string`, optional): Project context ID for persisting logs and outputs.
  * `sessionId` (`string`, optional): Resumes a previous session ID.
  * `action` (`"approve" | "retry" | "resume"`, optional): User action on human-in-the-loop steps.
  * `step` (`string`, optional): Targeted pipeline step to resume or retry.
* **Response Stream**: `200 OK` (`Content-Type: text/event-stream`)
```text
: keep-alive

data: {"success":true,"data":{"currentNode":"injection_inspection","currentStage":"inspection","status":"running","summary":"Inspecting 2 database tables...","steps":[{"name":"Inspection","status":"running","summary":"Inferring primary keys and data types"}]}}

data: {"success":true,"data":{"currentNode":"schema_resolution","currentStage":"schema_resolution","status":"running","summary":"Schema inferred and normalized.","requiresApproval":false}}

data: [DONE]
```

---

### `POST /api/ai/ingestion/pause`
Pauses an active AI ingestion workflow run.

* **Method**: `POST`
* **Path**: `/api/ai/ingestion/pause`
* **Request Body**:
```json
{
  "sessionId": "sess-449102",
  "projectId": "proj-982c7300-e29b-41d4-a716-446655440022"
}
```
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Workflow paused successfully",
  "data": {
    "status": "paused",
    "sessionId": "sess-449102"
  }
}
```

---

### `POST /api/ai/ingestion/stop`
Cancels and terminates an active AI ingestion workflow run.

* **Method**: `POST`
* **Path**: `/api/ai/ingestion/stop`
* **Request Body**:
```json
{
  "sessionId": "sess-449102",
  "projectId": "proj-982c7300-e29b-41d4-a716-446655440022"
}
```
* **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Workflow stopped successfully",
  "data": {
    "status": "stopped",
    "sessionId": "sess-449102"
  }
}
```

---

### `GET /api/ai/thinking`
Fetches agent reasoning logs (step-by-step thoughts) for a project and pipeline.

* **Method**: `GET`
* **Path**: `/api/ai/thinking`
* **Query Parameters**:
  * `projectId` (`string`, required): Project ID (e.g. `proj-982c7300...`).
  * `pipeline` (`string`, optional): e.g. `"Data Ingestion"` or `"Feature Engineering"`.
  * `substep` (`string`, optional): e.g. `"inspection"`, `"schema_resolution"`.

#### Example 1: Fetching specific substep thinking
```http
GET /api/ai/thinking?projectId=proj-982c7300...&pipeline=Data%20Ingestion&substep=inspection
```
* **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "thinking": [
      { "time": "14:21:05", "text": "Inspecting table customer_profiles...", "done": true },
      { "time": "14:21:07", "text": "Detected primary key: customer_id", "done": true }
    ]
  }
}
```

#### Example 2: Fetching all thinking logs for a project
```http
GET /api/ai/thinking?projectId=proj-982c7300...
```
* **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "agentThinking": [
      {
        "id": "think-01",
        "projectId": "proj-982c7300...",
        "pipeline": "Data Ingestion",
        "substep": "inspection",
        "thinking": [
          { "time": "14:21:05", "text": "Inspecting tables...", "done": true }
        ],
        "createdAt": "2026-09-09T14:21:05.000Z",
        "updatedAt": "2026-09-09T14:21:10.000Z"
      }
    ]
  }
}
```

---

## 6. Business Domains

### `GET /api/domains`
Returns standard business domains and their respective sub-domains used for prompt grounding and project classification.

* **Method**: `GET`
* **Path**: `/api/domains`
* **Request Body**: None
* **Response**: `200 OK`
```json
[
  {
    "id": "dom-1",
    "domain": "Retail & E-Commerce",
    "subDomains": [
      "Order Management",
      "Inventory & Stock Control",
      "Customer & Loyalty Analytics",
      "Pricing & Promotions",
      "E-Commerce Fulfillment"
    ]
  },
  {
    "id": "dom-2",
    "domain": "Finance & Banking",
    "subDomains": [
      "Risk Management",
      "Fraud Detection",
      "Credit & Loan Origination",
      "Wealth Management",
      "Transaction Auditing"
    ]
  },
  {
    "id": "dom-3",
    "domain": "Healthcare & Life Sciences",
    "subDomains": [
      "Patient Health Records",
      "Clinical Trial Analytics",
      "Hospital Operations",
      "Medical Billing & Claims",
      "Pharmaceutical Supply"
    ]
  },
  {
    "id": "dom-4",
    "domain": "Supply Chain & Logistics",
    "subDomains": [
      "Demand Forecasting & Planning",
      "Warehouse Operations",
      "Freight & Transportation",
      "Supplier Performance"
    ]
  }
]
```

---

## 7. Error Handling & Status Codes

Standardized JSON error envelope:
```json
{
  "success": false,
  "message": "Human readable explanation of the error"
}
```

| HTTP Code | Description | Example Scenario |
| :--- | :--- | :--- |
| `200 OK` | Request succeeded. | Retrieval or state update. |
| `201 Created` | Resource created. | Created workspace, project, or connector. |
| `400 Bad Request` | Missing required parameters or failed test. | Empty project name, invalid connector config. |
| `403 Forbidden` | Operation disallowed. | Attempting to delete the default workspace. |
| `404 Not Found` | Target resource does not exist. | Non-existent connector or project ID. |
| `409 Conflict` | Duplicate resource detected. | Project or workspace with identical name/sources. |
| `500 Internal Server Error` | Unhandled error or internal database failure. | Unhandled database connection or SQL query failure. |
