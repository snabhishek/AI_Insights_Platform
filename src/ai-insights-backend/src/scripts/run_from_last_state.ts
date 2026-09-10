import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { MemorySaver } from "@langchain/langgraph";
import { drizzle } from "drizzle-orm/node-postgres";
import { desc } from "drizzle-orm";
import { createAgentGraph } from "../agents/graph";
import { IngestionServices } from "../agents/state";
import { AgentTraceHelper } from "../agents/utils/agentUtils";
import { LocalFileService } from "../services/file/file.service";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { ConnectorService } from "../services/connector/connector.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";
import { PostgresConnectorRepository } from "../repositories/connector.repository";
import { PostgresProjectRepository } from "../repositories/project.repository";
import { pool, initializeDatabaseSchemas } from "../db";
import * as connectorsSchema from "../db/connectors";
import * as agentThinkingSchema from "../db/agentThinking";
import * as agentJobsSchema from "../db/agentJobs";
import * as modelSelectionSchema from "../db/modelSelection";

const schema = {
  ...connectorsSchema,
  ...agentThinkingSchema,
  ...agentJobsSchema,
  ...modelSelectionSchema,
};

// Load environment variables from .env if present
dotenv.config();

/**
 * Graph node name mapping.
 * When resuming at a target node, LangGraph needs the state set as if the
 * **preceding** node produced it. This map resolves target -> predecessor.
 */
const NODE_ORDER = [
  "inspect",
  "profileData",
  "resolveSchema",
  "hierarchyMapperNode",
  "featureArchitectNode",
  "exogenous",
  "modelSelectionNode",
  "trainingConfigurationNode",
  "modelTrainingNode",
  "modelValidationNode",
] as const;

function normalizeGraphNode(node: string): string {
  const map: Record<string, string> = {
    inspect: "inspect",
    profileData: "profileData",
    preprocess: "profileData",
    resolveSchema: "resolveSchema",
    hierarchyMapper: "hierarchyMapperNode",
    hierarchyMapperNode: "hierarchyMapperNode",
    featureArchitect: "featureArchitectNode",
    featureArchitectNode: "featureArchitectNode",
    exogenous: "exogenous",
    exogenousScout: "exogenous",
    modelSelection: "modelSelectionNode",
    modelSelectionNode: "modelSelectionNode",
    trainingConfiguration: "trainingConfigurationNode",
    trainingConfigurationNode: "trainingConfigurationNode",
    modelTraining: "modelTrainingNode",
    modelTrainingNode: "modelTrainingNode",
    modelValidation: "modelValidationNode",
    modelValidationNode: "modelValidationNode",
  };
  return map[node] || node;
}

function getPredecessorNode(targetNode: string): string | null {
  const normalized = normalizeGraphNode(targetNode);
  const idx = NODE_ORDER.indexOf(normalized as any);
  return idx > 0 ? NODE_ORDER[idx - 1] : null;
}

async function fetchLatestFeatureEngineeringStateFromDB(db: any): Promise<any | null> {
  try {
    const runs = await db
      .select()
      .from(connectorsSchema.projectRuns)
      .orderBy(desc(connectorsSchema.projectRuns.createdAt))
      .limit(20);

    for (const run of runs) {
      const state = run.agentState as any;
      if (!state) continue;

      const hasExogenous = Boolean(state.exogenousScout && Object.keys(state.exogenousScout).length > 0);
      const hasArchitect = Boolean(state.featureArchitect && Object.keys(state.featureArchitect).length > 0);
      const feCompleted =
        state.stageStatuses?.exogenousScout === "Completed" ||
        state.stageStatuses?.featureArchitect === "Completed" ||
        state.stageStatuses?.hierarchyMapper === "Completed";

      if (hasExogenous || hasArchitect || feCompleted) {
        console.log(`🔍 Found latest feature engineering state from DB in run "${run.id}" (Project: "${run.projectId}")`);
        return {
          ...state,
          projectId: run.projectId || state.projectId,
          useCase: run.useCase || state.useCase,
        };
      }
    }
  } catch (error: any) {
    console.warn("⚠️  Could not fetch latest feature engineering state from DB:", error?.message || error);
  }
  return null;
}

async function runFromLastState() {
  console.log("=================================================");
  console.log(" LangGraph Workflow Resumption Test Runner ");
  console.log("=================================================\n");

  const db = drizzle(pool, { schema });
  await initializeDatabaseSchemas();

  const logsDir = path.resolve(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const defaultPath = path.join(logsDir, "agent_state_last_run.json");
  const jsonPath = process.argv[2] && process.argv[2].endsWith(".json")
    ? path.resolve(process.argv[2])
    : defaultPath;

  // 1. Fetch latest feature engineering state from PostgreSQL DB and dump to file
  console.log("📡 Querying database for latest feature engineering run state...");
  const dbFeState = await fetchLatestFeatureEngineeringStateFromDB(db);

  let savedState: any = null;

  if (dbFeState) {
    fs.writeFileSync(defaultPath, JSON.stringify(dbFeState, null, 2), "utf8");
    const feLogsPath = path.join(logsDir, "agent_state_feature_engineering_last.json");
    fs.writeFileSync(feLogsPath, JSON.stringify(dbFeState, null, 2), "utf8");
    console.log(`💾 Dumped latest feature engineering DB state to: ${defaultPath}`);
    console.log(`💾 Also saved copy to: ${feLogsPath}\n`);
    savedState = dbFeState;
  } else if (fs.existsSync(jsonPath)) {
    console.log(`📂 Reading existing fallback state from: ${jsonPath}`);
    savedState = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } else {
    console.error(`❌ No state found in DB and file not found at: ${jsonPath}`);
    process.exit(1);
  }

  // 2. Determine target node to execute
  // If target node passed as CLI argument (e.g. ts-node run_from_last_state.ts modelSelectionNode)
  let targetNode: string = "modelSelectionNode";
  if (process.argv[2] && !process.argv[2].endsWith(".json")) {
    targetNode = process.argv[2];
  } else if (savedState.currentNode && savedState.currentNode !== "exogenous") {
    targetNode = savedState.currentNode;
  }
  targetNode = normalizeGraphNode(targetNode);

  console.log(`✅ Target node to execute: "${targetNode}"`);
  console.log(
    `   Steps completed in loaded state: ${
      Array.isArray(savedState.steps)
        ? savedState.steps.map((s: any) => s.name).join(", ")
        : "None"
    }`
  );

  // 3. Determine predecessor node
  const predecessorNode = getPredecessorNode(targetNode);
  if (!predecessorNode) {
    console.error(`❌ Cannot determine predecessor for target node "${targetNode}". Is it the first node?`);
    process.exit(1);
  }
  console.log(`   Predecessor node (asNode): "${predecessorNode}"\n`);

  // 4. Setup real services for node execution
  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectorRepo = new PostgresConnectorRepository(db);
  const projectRepo = new PostgresProjectRepository(db);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);
  const connectorService = new ConnectorService(connectorRepo, fileService, connectionTester, duckDBService);

  const services: IngestionServices = {
    projectId: savedState.projectId || "test-project-awesome",
    pipeline: "Model Training & Validation",
    connectorService,
    connectionTester,
    fileService,
    duckDBService,
    agentThinkingService: {
      getThinking: async () => null,
      saveThinking: async (_pId: string, _pipe: string, substep: string, logs: any[]) => {
        const latest = logs[logs.length - 1];
        if (typeof latest?.text === "string") {
          latest.text.includes("Tool output")
            ? (latest.text = "Tool output")
            : latest.text.includes("Invoking tool")
            ? (latest.text = "Tool input")
            : latest.text;
        }
        if (latest) {
          console.log(`   🧠 [Thinking - ${substep}]: ${latest.text}`);
        }
      },
      clearProjectPipelineThinking: async () => {},
      deleteThinking: async () => {},
    },
    projectService: {
      getById: async (id: string) => projectRepo.getById(id),
      updateAgentState: async (id: string, state: any, useCase?: string) =>
        projectRepo.updateAgentState(id, state, useCase),
    } as any,
    traceHelper: new AgentTraceHelper(),
  };

  // 5. Initialize LangGraph workflow with MemorySaver checkpointer
  const checkpointer = new MemorySaver();
  const workflow = createAgentGraph(checkpointer);

  const threadId = `resume-test-${Date.now()}`;
  const config = {
    configurable: {
      thread_id: threadId,
      services,
    },
  };

  // 6. Assign state to LangGraph checkpoint using the predecessor node
  console.log(`⚙️  Assigning saved state to LangGraph checkpointer as node "${predecessorNode}"...`);
  await workflow.updateState(config, savedState, predecessorNode);

  const initialStateCheck = await workflow.getState(config);
  console.log(`📍 Current graph state position (next node to execute): [${initialStateCheck.next.join(", ")}]`);

  if (initialStateCheck.next.length === 0) {
    console.error(`❌ LangGraph reports no next node. State may already be past "${targetNode}".`);
    process.exit(1);
  }

  // 7. Stream workflow execution from the target node
  console.log(`\n🚀 Resuming workflow — executing "${targetNode}"...\n`);

  try {
    const stream = await workflow.stream(null, config);
    for await (const event of stream) {
      const nodeName = Object.keys(event)[0];
      console.log(`✨ Completed Node: "${nodeName}"`);
      const nodeOutput = (event as Record<string, any>)[nodeName];
      if (nodeOutput?.summary) {
        console.log(`   Summary: ${nodeOutput.summary}`);
      }
      if (nodeOutput?.steps) {
        console.log(`   Steps added:`, JSON.stringify(nodeOutput.steps, null, 2));
      }
    }

    // 8. Output final state after execution & save back to JSON file
    const finalGraphState = await workflow.getState(config);
    console.log("\n=================================================");
    console.log(" Workflow Execution Completed Successfully ");
    console.log("=================================================");
    console.log(`Next Nodes: [${finalGraphState.next.join(", ")}]`);

    // Prepare updated state payload combining original saved state with new state values
    const updatedState = {
      ...savedState,
      ...finalGraphState.values,
      currentNode:
        finalGraphState.next.length === 0
          ? targetNode
          : finalGraphState.next[0] || targetNode,
    };

    // Save updated state to a new JSON file in the logs directory
    const outputJsonPath = path.resolve(
      path.dirname(jsonPath),
      `agent_state_${targetNode}_run.json`
    );
    fs.writeFileSync(outputJsonPath, JSON.stringify(updatedState, null, 2), "utf8");
    console.log(`\n💾 Saved updated agent state to new file: ${outputJsonPath}`);

    if (finalGraphState.values.modelSelection) {
      console.log("\n🎯 Model Selection Output Results:");
      const ms = finalGraphState.values.modelSelection as any;
      console.log(`   Target Entity: ${ms.target_entity?.name || "N/A"}`);
      console.log(`   Recommended Primary: ${ms.recommended_model?.model_id} (Score: ${ms.recommended_model?.suitability_score})`);
      console.log(`   Candidate Count: ${ms.candidates?.length || 0}`);
      if (Array.isArray(ms.candidates)) {
        ms.candidates.forEach((c: any) => {
          console.log(`     [Rank ${c.rank}] ${c.model_id} (${c.recommendation}) - Score: ${c.suitability_score}`);
        });
      }
    }
  } catch (error) {
    console.error("\n❌ Workflow execution failed:", error);
  }
}

// Execute runner
runFromLastState();
