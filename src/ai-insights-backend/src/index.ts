import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { LocalFileService } from "./services/file.service";
import { ConnectionTesterService } from "./services/connectionTester.service";
import { PostgresConnectorRepository } from "./repositories/connector.repository";
import workspaceRouter from "./routes/workspaces";
import { ConnectorService } from "./services/connector.service";
import { ConnectorController } from "./controllers/connector.controller";
import createConnectorRouter from "./routes/connectors";
import createAIRouter from "./routes/ai";
import { checkAndCreateDatabase, runMigrations, pool } from "./db";
import * as schema from "./db/connectors";
import { IngestionAgentService } from "./services/ai/ingestionAgent.service";
import { AIController } from "./controllers/ai.controller";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

// Enable CORS for frontend workspace
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

let db: any;
let fileService: LocalFileService;
let connectionTester: ConnectionTesterService;
let connectorRepository: PostgresConnectorRepository;
let connectorService: ConnectorService;
let connectorController: ConnectorController;
let ingestionAgentService: IngestionAgentService;
let aiController: AIController;

async function bootstrap() {
  // 1. Wrap PG Pool with Drizzle ORM
  db = drizzle(pool, { schema });

  // 3. Construct Dependencies (Dependency Injection)
  fileService = new LocalFileService();
  connectionTester = new ConnectionTesterService(fileService);
  connectorRepository = new PostgresConnectorRepository(db);
  connectorService = new ConnectorService(connectorRepository, fileService, connectionTester);
  connectorController = new ConnectorController(connectorService, connectionTester);
  ingestionAgentService = new IngestionAgentService(connectorService, connectionTester, fileService);
  aiController = new AIController(ingestionAgentService);

  // 4. Mount Main routers
  app.use("/api/connectors", createConnectorRouter(connectorController));
  app.use("/api/ai", createAIRouter(aiController));
  app.use("/api/workspaces", workspaceRouter);

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  app.listen(PORT, HOST, () => {
    console.log(`[Server] AI Insights Backend listening at http://${HOST}:${PORT}`);
    console.log(`[Server] Health check available at http://${HOST}:${PORT}/api/health`);
  });

  // 5. Run database initialization in the background so the API remains reachable
  void checkAndCreateDatabase().catch((err) => {
    console.error("[DB] Background database check failed:", err.message || err);
  });

  // 6. Run programmatic Drizzle migrations
  await runMigrations(db);
}

bootstrap().catch((err) => {
  console.error("[Bootstrap] Critical server start error:", err.message || err);
});
