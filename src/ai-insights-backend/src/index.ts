import { setupTimestampedLogging } from "./utils/logger";
setupTimestampedLogging();

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { LocalFileService } from "./services/file/file.service";
import { getWorkspacesBasePath } from "./config/fileServer.config";
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
import * as modelSelectionSchema from "./db/modelSelection";
import * as modelValidationSchema from "./db/modelValidation";
import * as chatSuggestionsSchema from "./db/chatSuggestions";
const schema = { ...connectorsSchema, ...agentThinkingSchema, ...agentJobsSchema, ...modelSelectionSchema, ...modelValidationSchema, ...chatSuggestionsSchema };
import { PostgresAgentThinkingRepository } from "./repositories/agentThinking.repository";
import { PostgresModelValidationRepository } from "./repositories/modelValidation.repository";
import { PostgresChatSuggestionRepository } from "./repositories/chatSuggestion.repository";
import { ChatSuggestionService } from "./services/chat/chatSuggestion.service";
import { ChatSuggestionController } from "./controllers/chatSuggestion.controller";
import createChatSuggestionRouter from "./routes/chatSuggestions";
import { AgentThinkingService } from "./services/ai/agent-thinking/agentThinking.service";
import { IngestionAgentService } from "./services/ai/ingestion-agent/ingestionAgent.service";
import { QueueService } from "./services/queue/queue.service";
import { AIController } from "./controllers/ai.controller";
import { PostgresDomainRepository } from "./repositories/domain.repository";
import { DomainService } from "./services/domain/domain.service";
import { DomainController } from "./controllers/domain.controller";
import createDomainRouter from "./routes/domains";
import { SourceRegistryService } from "./services/sourceRegistry/sourceRegistry.service";
import { PostgresModelSelectionRepository } from "./repositories/modelSelection.repository";
import { ModelDiscoveryService } from "./services/ai/model-selection/modelDiscovery.service";
import { defaultModelCapabilityRegistry } from "./agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionLLMService } from "./services/ai/model-selection/modelSelectionLLM.service";
import { ModelSelectionService } from "./services/ai/model-selection/modelSelection.service";
import { ModelSelectionController } from "./controllers/modelSelection.controller";
import createModelSelectionRouter from "./routes/modelSelection";
import { TrainingConfigService } from "./services/ai/training-config/trainingConfig.service";
import { TrainingConfigController } from "./controllers/trainingConfig.controller";
import createTrainingConfigRouter from "./routes/trainingConfig";
import { ModelValidationService } from "./services/ai/model-validation/modelValidation.service";
import { ModelValidationController } from "./controllers/modelValidation.controller";
import createModelValidationRouter from "./routes/modelValidation";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT!);
const HOST = process.env.HOST!;

app.use(
  cors({
    origin: (origin, callback) => {

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

let ingestionAgentService: IngestionAgentService;
let aiController: AIController;

async function bootstrap() {

  db = drizzle(pool, { schema });

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
  connectorService = new ConnectorService(connectorRepository, fileService, connectionTester, duckDBService, workspaceRepository);
  const sourceRegistryService = new SourceRegistryService(connectorRepository, connectionTester, duckDBService, projectRepository);
  connectorController = new ConnectorController(connectorService, connectionTester, sourceRegistryService);

  const queueService = new QueueService(db);
  ingestionAgentService = new IngestionAgentService(connectorService, connectionTester, fileService, projectService, agentThinkingService, queueService, duckDBService);
  aiController = new AIController(ingestionAgentService, agentThinkingService);

  const domainRepository = new PostgresDomainRepository();
  const domainService = new DomainService(domainRepository);
  const domainController = new DomainController(domainService);

  const modelSelectionRepository = new PostgresModelSelectionRepository(db);
  const modelSelectionLLMService = new ModelSelectionLLMService();
  const modelDiscoveryService = new ModelDiscoveryService(modelSelectionRepository);
  const modelSelectionService = new ModelSelectionService(
    modelSelectionRepository,
    modelSelectionLLMService,
    projectService,
    defaultModelCapabilityRegistry,
    modelDiscoveryService
  );
  const modelSelectionController = new ModelSelectionController(modelSelectionService);
  const trainingConfigService = new TrainingConfigService(projectService);
  const trainingConfigController = new TrainingConfigController(trainingConfigService);
  const modelValidationRepository = new PostgresModelValidationRepository(db);
  const modelValidationService = new ModelValidationService(
    projectService,
    workspaceService,
    modelValidationRepository,
    agentThinkingService
  );
  const modelValidationController = new ModelValidationController(modelValidationService);

  const chatSuggestionRepository = new PostgresChatSuggestionRepository(db);
  const chatSuggestionService = new ChatSuggestionService(chatSuggestionRepository);
  const chatSuggestionController = new ChatSuggestionController(chatSuggestionService);

  app.get("/api/filter-options", connectorController.getFilterOptions);
  app.use("/api/connectors", createConnectorRouter(connectorController));
  app.use("/api/domains", createDomainRouter(domainController));
  app.use("/api/model-selection", createModelSelectionRouter(modelSelectionController));
  app.use("/api/training-config", createTrainingConfigRouter(trainingConfigController));
  app.use("/api/model-validation", createModelValidationRouter(modelValidationController));
  app.use("/api/chat-suggestions", createChatSuggestionRouter(chatSuggestionController));

  const agentRouter = express.Router();

  app.use("/api/ai", createAIRouter(aiController));
  app.use("/api/workspaces", createWorkspaceRouter(workspaceController));
  app.use("/workspaces", express.static(getWorkspacesBasePath()));

  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  app.listen(PORT, HOST, () => {
    console.log(`[Server] AI Insights Backend listening at http://${HOST}:${PORT}`);
    console.log(`[Server] Health check available at http://${HOST}:${PORT}/api/health`);
  });

  try {
    await checkAndCreateDatabase();
  } catch (err: any) {
    console.error("[DB] Database check failed:", err.message || err);
  }

  await runMigrations(db);
}

bootstrap().catch((err) => {
  console.error("[Bootstrap] Critical server start error:", err.message || err);
});
