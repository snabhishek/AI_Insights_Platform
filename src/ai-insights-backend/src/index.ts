import { setupTimestampedLogging } from "./utils/logger";
setupTimestampedLogging();

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { LocalFileService } from "./services/file/file.service";
import { DuckDBService } from "./services/duckdb/duckdb.service";
import { ConnectionTesterService } from "./services/connector/connectionTester.service";
import { PostgresConnectorRepository } from "./repositories/connector.repository";
import { PostgresProjectRepository } from "./repositories/project.repository";
import { ProjectService } from "./services/project/project.service";
import { PostgresWorkspaceRepository } from "./repositories/workspace.repository";
import { WorkspaceService } from "./services/project/workspace.service";
import { WorkspaceController } from "./controllers/workspace.controller";
import createWorkspaceRouter from "./routes/workspaces";
import { ConnectorService } from "./services/connector/connector.service";
import { ConnectorController } from "./controllers/connector.controller";
import createConnectorRouter from "./routes/connectors";
import createAIRouter from "./routes/ai";
import { checkAndCreateDatabase, runMigrations, pool } from "./db";
import * as connectorsSchema from "./db/connectors";
import * as agentThinkingSchema from "./db/agentThinking";
import * as agentJobsSchema from "./db/agentJobs";
const schema = { ...connectorsSchema, ...agentThinkingSchema, ...agentJobsSchema };
import { PostgresAgentThinkingRepository } from "./repositories/agentThinking.repository";
import { AgentThinkingService } from "./services/ai/agent-thinking/agentThinking.service";
// import { AgentController } from "./controllers/agent.controller";
import { IngestionAgentService } from "./services/ai/ingestion-agent/ingestionAgent.service";
import { QueueService } from "./services/queue/queue.service";
import { AIController } from "./controllers/ai.controller";
import { PostgresDomainRepository } from "./repositories/domain.repository";
import { DomainService } from "./services/domain/domain.service";
import { DomainController } from "./controllers/domain.controller";
import createDomainRouter from "./routes/domains";
import { SourceRegistryService } from "./services/sourceRegistry/sourceRegistry.service";


dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "0.0.0.0";

// Enable CORS for frontend workspace
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like curl, postman) or from any localhost / 127.0.0.1 port
      if (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

let db: any;
let fileService: LocalFileService;
let duckDBService: DuckDBService;
let connectionTester: ConnectionTesterService;
let connectorRepository: PostgresConnectorRepository;
let connectorService: ConnectorService;
let connectorController: ConnectorController;
// let agentController: AgentController;
let ingestionAgentService: IngestionAgentService;
let aiController: AIController;

async function bootstrap() {
  // 1. Wrap PG Pool with Drizzle ORM
  db = drizzle(pool, { schema });

  // 3. Construct Dependencies (Dependency Injection)
  fileService = new LocalFileService();
  duckDBService = new DuckDBService(fileService);
  connectionTester = new ConnectionTesterService(fileService, duckDBService);
  connectorRepository = new PostgresConnectorRepository(db);
  const workspaceRepository = new PostgresWorkspaceRepository(db);
  const projectRepository = new PostgresProjectRepository(db);
  const projectService = new ProjectService(projectRepository, duckDBService);
  const workspaceService = new WorkspaceService(workspaceRepository, projectRepository, connectorRepository, duckDBService);
  const workspaceController = new WorkspaceController(workspaceService);
  const agentThinkingRepository = new PostgresAgentThinkingRepository(db);
  const agentThinkingService = new AgentThinkingService(agentThinkingRepository);
  connectorService = new ConnectorService(connectorRepository, fileService, connectionTester, duckDBService);
  const sourceRegistryService = new SourceRegistryService(connectorRepository, connectionTester, duckDBService, projectRepository);
  connectorController = new ConnectorController(connectorService, connectionTester, sourceRegistryService);
  // agentController = new AgentController(connectorService);
  const queueService = new QueueService(db);
  ingestionAgentService = new IngestionAgentService(connectorService, connectionTester, fileService, projectService, agentThinkingService, queueService, duckDBService);
  aiController = new AIController(ingestionAgentService, agentThinkingService);


  const domainRepository = new PostgresDomainRepository();
  const domainService = new DomainService(domainRepository);
  const domainController = new DomainController(domainService);

  // 4. Mount Main routers
  app.get("/api/filter-options", connectorController.getFilterOptions);
  app.use("/api/connectors", createConnectorRouter(connectorController));
  app.use("/api/domains", createDomainRouter(domainController));

  // Agent Router
  const agentRouter = express.Router();
  // agentRouter.post("/inspect", agentController.runInspector);
  // app.use("/api/agents", agentRouter);

  app.use("/api/ai", createAIRouter(aiController));
  app.use("/api/workspaces", createWorkspaceRouter(workspaceController));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  app.listen(PORT, HOST, () => {
    console.log(`[Server] AI Insights Backend listening at http://${HOST}:${PORT}`);
    console.log(`[Server] Health check available at http://${HOST}:${PORT}/api/health`);
  });

  // 5. Run database initialization guard
  try {
    await checkAndCreateDatabase();
  } catch (err: any) {
    console.error("[DB] Database check failed:", err.message || err);
  }

  // 6. Run programmatic Drizzle migrations
  await runMigrations(db);
}

bootstrap().catch((err) => {
  console.error("[Bootstrap] Critical server start error:", err.message || err);
});
