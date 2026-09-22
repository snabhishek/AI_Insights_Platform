import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
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
import { ProjectService } from "../services/project/project.service";
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
  "preFlightNode",
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
    preflight: "preFlightNode",
    preFlight: "preFlightNode",
    preFlightNode: "preFlightNode",
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

async function fetchLatestWorkflowStateFromDB(db: any): Promise<any | null> {
  try {
    const runs = await db
      .select()
      .from(connectorsSchema.projectRuns)
      .orderBy(desc(connectorsSchema.projectRuns.createdAt))
      .limit(30);

    for (const run of runs) {
      const state = run.agentState as any;
      if (!state) continue;

      const hasTrainingConfig = Boolean(state.trainingConfiguration && Object.keys(state.trainingConfiguration).length > 0);
      const hasPreFlight = Boolean(state.preFlight && Object.keys(state.preFlight).length > 0);
      const hasModelSelection = Boolean(state.modelSelection && Object.keys(state.modelSelection).length > 0);
      const hasArchitect = Boolean(state.featureArchitect && Object.keys(state.featureArchitect).length > 0);
      const hasExogenous = Boolean(state.exogenousScout && Object.keys(state.exogenousScout).length > 0);

      if (hasTrainingConfig || hasPreFlight || hasModelSelection || hasArchitect || hasExogenous) {
        console.log(`🔍 Found latest workflow state from DB in run "${run.id}" (Project: "${run.projectId}")`);
        return {
          ...state,
          projectId: run.projectId || state.projectId,
          useCase: run.useCase || state.useCase,
        };
      }
    }
  } catch (error: any) {
    console.warn("⚠️  Could not fetch latest workflow state from DB:", error?.message || error);
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

  // 1. Fetch latest workflow state from PostgreSQL DB or fallback JSON
  console.log("📡 Querying database for latest workflow run state...");
  const dbState = await fetchLatestWorkflowStateFromDB(db);

  let savedState: any = null;

  if (dbState) {
    fs.writeFileSync(defaultPath, JSON.stringify(dbState, null, 2), "utf8");
    console.log(`💾 Dumped latest workflow DB state to: ${defaultPath}\n`);
    savedState = dbState;
  } else if (fs.existsSync(jsonPath)) {
    console.log(`📂 Reading existing fallback state from: ${jsonPath}`);
    savedState = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } else {
    console.error(`❌ No state found in DB and file not found at: ${jsonPath}`);
    process.exit(1);
  }

  // Ensure baseline project metadata is populated
  savedState.projectName = (savedState as any).projectName || "carrier";
  savedState.workspaceName = (savedState as any).workspaceName || "FileStorage_Testing";
  savedState.runTimestamp = savedState.runTimestamp || "20260918-185832";
  // Reset status to "running" so nodes do not skip execution on previous paused/failed status
  savedState.status = "running";

  // 2. Determine target node to execute
  // Default to modelTrainingNode to start directly at Model Training
  let targetNode: string = "modelTrainingNode";
  if (process.argv[2] && !process.argv[2].endsWith(".json")) {
    targetNode = process.argv[2];
  } else if (process.argv[3] && !process.argv[3].endsWith(".json")) {
    targetNode = process.argv[3];
  }
  targetNode = normalizeGraphNode(targetNode);

  // Verify or initialize trainingConfiguration from available contract YAML if missing
  if (!savedState.trainingConfiguration || Object.keys(savedState.trainingConfiguration).length === 0) {
    console.log("ℹ️  Checking for existing Training Job Contract YAML in workspace/logs...");
    const possibleYamls = [
      path.resolve(
        "C:\\AI Insights Platform\\workspaces\\FileStorage_Testing\\projects\\carrier\\20260918-185832\\schemas\\carrier_training_job_contract_20260918-185832.yaml"
      ),
      path.join(logsDir, "training-job-contract.yml"),
      path.join(logsDir, "TrainingJobContract copy 2.yaml"),
      path.join(logsDir, "TrainingJobContract copy.yaml"),
    ];

    const foundYaml = possibleYamls.find((f) => fs.existsSync(f));
    if (foundYaml) {
      try {
        const parsed = yaml.load(fs.readFileSync(foundYaml, "utf-8"));
        savedState.trainingConfiguration = {
          status: "Completed",
          summary: `Loaded contract from ${path.basename(foundYaml)}`,
          contractPath: foundYaml,
          configuration: parsed,
        };
        console.log(`📄 Initialized trainingConfiguration from contract: ${foundYaml}`);
      } catch (err: any) {
        console.warn("⚠️ Failed to parse contract YAML:", err.message);
      }
    }
  }

  // Ensure preFlight state is marked approved so model training proceeds seamlessly
  if (!savedState.preFlight || Object.keys(savedState.preFlight).length === 0 || savedState.preFlight.status === "paused") {
    savedState.preFlight = {
      decision: "APPROVED",
      status: "Completed",
      summary: "Pre-Flight verification passed or bypassed for resume.",
      checks: [{ check_id: "PF-01", name: "State Check", category: "System", passed: true }],
    };
  }

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
  const projectService = new ProjectService(projectRepo, duckDBService);

  const services: IngestionServices = {
    connectorService,
    connectionTester,
    fileService,
    projectService,
    duckDBService,
    traceHelper: new AgentTraceHelper(),
    projectId: savedState.projectId || "test-project-awesome",
    projectName: savedState.projectName || "carrier",
    workspaceName: savedState.workspaceName || "FileStorage_Testing",
    runTimestamp: savedState.runTimestamp || "20260918-185832",
    pipeline: "Model Training & Validation",
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

  // 7. Stream workflow execution from target node (e.g. preFlightNode)
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

    // If preFlight completed and the workflow paused before modelTrainingNode, continue execution to modelTrainingNode
    const midGraphState = await workflow.getState(config);
    if (midGraphState.next && midGraphState.next.includes("modelTrainingNode")) {
      console.log(`\n=================================================`);
      console.log(` Pre-Flight Complete. Proceeding to Model Training `);
      console.log(`=================================================\n`);

      const mtStream = await workflow.stream(null, config);
      for await (const event of mtStream) {
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
    console.log(`\n💾 Saved updated agent state to: ${outputJsonPath}`);

    // Pre-Flight Results Summary
    if (finalGraphState.values.preFlight) {
      console.log("\n📋 Pre-Flight Assessment Results:");
      const pf = finalGraphState.values.preFlight as any;
      console.log(`   Decision: ${pf.decision || pf.status}`);
      console.log(`   Summary: ${pf.summary}`);
      if (pf.resourceEstimates) {
        console.log(`   Estimated RAM: ${pf.resourceEstimates.ram_gb} GB, Disk: ${pf.resourceEstimates.disk_free_gb || "N/A"} GB`);
      }
      if (Array.isArray(pf.checks)) {
        const passed = pf.checks.filter((c: any) => c.passed).length;
        console.log(`   Checks Passed: ${passed}/${pf.checks.length}`);
      }
      if (Array.isArray(pf.recommendations) && pf.recommendations.length > 0) {
        console.log(`   Recommendations (${pf.recommendations.length}):`);
        pf.recommendations.forEach((r: any, idx: number) => {
          console.log(`     [${idx + 1}] ${r.message || r.action || r}`);
        });
      }
    }

    // Model Training Results Summary
    if (finalGraphState.values.modelTraining) {
      console.log("\n🚀 Model Training Results:");
      const mt = finalGraphState.values.modelTraining as any;
      console.log(`   Status: ${mt.status}`);
      console.log(`   Summary: ${mt.summary}`);
      console.log(`   Champion Model: ${mt.selectedModel || mt.report?.selectedModel}`);
      console.log(`   Champion Artifact: ${mt.selectedModelArtifact || mt.report?.selectedModelArtifact}`);
      console.log(`   Project Directory: ${mt.projectDirectory}`);

      if (mt.validationMetrics) {
        console.log(`   Validation Metrics:`, JSON.stringify(mt.validationMetrics, null, 2));
      }

      const runs = mt.rankedCandidates || mt.candidates || mt.report?.runs || [];
      if (runs.length > 0) {
        console.log(`\n   Candidate Models Summary (${runs.length} models):`);
        runs.forEach((r: any, idx: number) => {
          console.log(
            `     [${idx + 1}] ${r.displayName || r.model_id} (${r.framework || "sklearn"}) - Status: ${r.status}, Score: ${r.score ?? "N/A"}`
          );
        });
      }
    }
  } catch (error) {
    console.error("\n❌ Workflow execution failed:", error);
  }
}

// Execute runner
runFromLastState();
