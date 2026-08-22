import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { MemorySaver } from "@langchain/langgraph";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAgentGraph } from "../agents/graph";
import { IngestionServices } from "../agents/state";
import { AgentTraceHelper } from "../agents/utils/agentUtils";
import { LocalFileService } from "../services/file/file.service";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { ConnectorService } from "../services/connector/connector.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";
import { PostgresConnectorRepository } from "../repositories/connector.repository";
import { pool } from "../db";
import * as connectorsSchema from "../db/connectors";
import * as agentThinkingSchema from "../db/agentThinking";
import * as agentJobsSchema from "../db/agentJobs";
const schema = { ...connectorsSchema, ...agentThinkingSchema, ...agentJobsSchema };

// Load environment variables from .env if present
dotenv.config();

/**
 * Graph node name mapping.
 * When resuming at a target node, LangGraph needs the state set as if the
 * **preceding** node produced it.  This map resolves target → predecessor.
 */
const NODE_ORDER = [
  "inspect",
  "profileData",
  "resolveSchema",
  "hierarchyMapperNode",
  "exogenous",
  "featureArchitectNode",
] as const;

function getPredecessorNode(targetNode: string): string | null {
  const idx = NODE_ORDER.indexOf(targetNode as any);
  return idx > 0 ? NODE_ORDER[idx - 1] : null;
}

async function runFromLastState() {
  console.log("=================================================");
  console.log(" LangGraph Workflow Resumption Test Runner ");
  console.log("=================================================\n");

  // 1. Resolve path to agent_state_last_run.json
  const defaultPath = path.resolve(__dirname, "../../logs/agent_state_last_run.json");
  const jsonPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Agent state JSON file not found at: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`📂 Reading saved agent state from: ${jsonPath}`);
  const rawData = fs.readFileSync(jsonPath, "utf8");
  const savedState = JSON.parse(rawData);

  const targetNode = savedState.currentNode || "featureArchitectNode";
  console.log(`✅ Loaded state. Target node to execute: "${targetNode}"`);
  console.log(`   Steps completed in saved state: ${Array.isArray(savedState.steps) ? savedState.steps.map((s: any) => s.name).join(", ") : "None"}`);

  // 2. Determine the predecessor node so LangGraph positions state correctly
  const predecessorNode = getPredecessorNode(targetNode);
  if (!predecessorNode) {
    console.error(`❌ Cannot determine predecessor for target node "${targetNode}". Is it the first node?`);
    process.exit(1);
  }
  console.log(`   Predecessor node (asNode): "${predecessorNode}"\n`);

  // 3. Setup real services for node execution
  const db = drizzle(pool, { schema });
  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectorRepo = new PostgresConnectorRepository(db);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);
  const connectorService = new ConnectorService(connectorRepo, fileService, connectionTester, duckDBService);

  const services: IngestionServices = {
    projectId: savedState.projectId || "test-project-awesome",
    pipeline: "Data Ingestion",
    connectorService,
    connectionTester,
    fileService,
    duckDBService,
    agentThinkingService: {
      getThinking: async () => null,
      saveThinking: async (_pId: string, _pipe: string, substep: string, logs: any[]) => {
        const latest = logs[logs.length - 1];
        if (typeof latest?.text === "string") {
          latest.text.includes("Tool output")? latest.text = 'Tool output': latest.text.includes("Invoking tool")? latest.text = 'Tool input': latest.text;
        }
        if (latest) {
          console.log(`   🧠 [Thinking - ${substep}]: ${latest.text}`);
        }
      },
      clearProjectPipelineThinking: async () => {},
      deleteThinking: async () => {},
    },
    projectService: {
      updateAgentState: async () => {},
    } as any,
    traceHelper: new AgentTraceHelper(),
  };

  // 4. Initialize LangGraph workflow with MemorySaver checkpointer
  const checkpointer = new MemorySaver();
  const workflow = createAgentGraph(checkpointer);

  const threadId = `resume-test-${Date.now()}`;
  const config = {
    configurable: {
      thread_id: threadId,
      services,
    },
  };

  // 5. Assign state to LangGraph checkpoint using the predecessor node
  console.log(`⚙️  Assigning saved state to LangGraph checkpointer as node "${predecessorNode}"...`);
  await workflow.updateState(config, savedState, predecessorNode);

  const initialStateCheck = await workflow.getState(config);
  console.log(`📍 Current graph state position (next node to execute): [${initialStateCheck.next.join(", ")}]`);

  if (initialStateCheck.next.length === 0) {
    console.error(`❌ LangGraph reports no next node. State may already be past "${targetNode}".`);
    process.exit(1);
  }

  // 6. Stream workflow execution from the target node
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

    // 7. Output final state after execution & save back to JSON file
    const finalGraphState = await workflow.getState(config);
    console.log("\n=================================================");
    console.log(" Workflow Execution Completed Successfully ");
    console.log("=================================================");
    // console.log(`Final Graph Status: ${finalGraphState.values.status}`);
    console.log(`Next Nodes: [${finalGraphState.next.join(", ")}]`);

    // Prepare updated state payload combining original saved state with new state values
    const updatedState = {
      ...savedState,
      ...finalGraphState.values,
      currentNode: finalGraphState.next.length === 0 ? targetNode : (finalGraphState.next[0] || targetNode),
    };

    // Save updated state to a new JSON file in the logs directory
    const outputJsonPath = path.resolve(path.dirname(jsonPath), `agent_state_${targetNode}_run.json`);
    fs.writeFileSync(outputJsonPath, JSON.stringify(updatedState, null, 2), "utf8");
    console.log(`\n💾 Saved updated agent state to new file: ${outputJsonPath}`);

    if (finalGraphState.values.featureArchitect) {
      console.log("\n📊 Feature Architect Output Results:");
      // console.log(JSON.stringify(finalGraphState.values.featureArchitect, null, 2));
    }

    if (finalGraphState.values.exogenousScout) {
      console.log("\n📊 Exogenous Scout Agent Output Results:");
      // console.log(JSON.stringify(finalGraphState.values.exogenousScout, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Workflow execution failed:", error);
  }
}

// Execute runner
runFromLastState();

