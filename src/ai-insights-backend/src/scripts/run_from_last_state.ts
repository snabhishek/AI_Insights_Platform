import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { MemorySaver } from "@langchain/langgraph";
import { createAgentGraph } from "../agents/graph";
import { IngestionServices } from "../agents/state";
import { AgentTraceHelper } from "../agents/utils/agentUtils";

// Load environment variables from .env if present
dotenv.config();

/**
 * Script to test loading the last recorded agent state from JSON,
 * updating the LangGraph checkpointer state, and resuming execution
 * from the last stop point (resolveSchema -> exogenous scout agent).
 */
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

  console.log(`✅ Loaded state. Last Node recorded in state: "${savedState.currentNode || "Unknown"}"`);
  console.log(`   Steps completed in saved state: ${Array.isArray(savedState.steps) ? savedState.steps.map((s: any) => s.name).join(", ") : "None"}`);

  // 2. Setup mock/minimal services for node execution
  const mockServices: Partial<IngestionServices> = {
    projectId: savedState.projectId || "test-project-id",
    pipeline: "Data Ingestion",
    agentThinkingService: {
      getThinking: async () => null,
      saveThinking: async (_pId: string, _pipe: string, substep: string, logs: any[]) => {
        const latest = logs[logs.length - 1];
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

  // 3. Initialize LangGraph workflow with MemorySaver checkpointer
  const checkpointer = new MemorySaver();
  const workflow = createAgentGraph(checkpointer);

  const threadId = `resume-test-${Date.now()}`;
  const config = {
    configurable: {
      thread_id: threadId,
      services: mockServices as IngestionServices,
    },
  };

  // 4. Assign state to LangGraph checkpoint
  // The saved state was generated after "resolveSchema" completed.
  // We update state with asNode = "resolveSchema" so LangGraph positions the state machine
  // at the exit of "resolveSchema" and triggers the next edge ("exogenous").
  const lastNode = savedState.currentNode || "resolveSchema";
  console.log(`\n⚙️  Assigning saved state to LangGraph checkpointer as node "${lastNode}"...`);
  await workflow.updateState(config, savedState, lastNode);

  const initialStateCheck = await workflow.getState(config);
  console.log(`📍 Current graph state position (next node to execute): [${initialStateCheck.next.join(", ")}]`);

  // 5. Stream workflow execution from the last stop point
  console.log("\n🚀 Resuming workflow from last stop point...\n");

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

    // 6. Output final state after execution & save back to JSON file
    const finalGraphState = await workflow.getState(config);
    console.log("\n=================================================");
    console.log(" Workflow Execution Completed Successfully ");
    console.log("=================================================");
    console.log(`Final Graph Status: ${finalGraphState.values.status}`);
    console.log(`Next Nodes: [${finalGraphState.next.join(", ")}]`);

    // Prepare updated state payload combining original saved state with new state values
    const updatedState = {
      ...savedState,
      ...finalGraphState.values,
      currentNode: finalGraphState.next.length === 0 ? "exogenous" : (finalGraphState.next[0] || "exogenous"),
    };

    // Save updated state to a new JSON file in the logs directory
    const outputJsonPath = path.resolve(path.dirname(jsonPath), "agent_state_exogenous_run.json");
    fs.writeFileSync(outputJsonPath, JSON.stringify(updatedState, null, 2), "utf8");
    console.log(`\n💾 Saved updated agent state to new file: ${outputJsonPath}`);

    if (finalGraphState.values.exogenousScout) {
      console.log("\n📊 Exogenous Scout Agent Output Results:");
      console.log(JSON.stringify(finalGraphState.values.exogenousScout, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Workflow execution failed:", error);
  }
}

// Execute runner
runFromLastState();
