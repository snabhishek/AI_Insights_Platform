import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureCreationOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { createGetTableColumnsAndProfileTool, getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";


export async function featureCreationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureCreationOutput = {
    status: "Failed",
    summary: "Feature Creation fallback triggered",
    recommendations: [],
  };

  if (!model) {
    return {
      featureCreation: fallback,
      history: [
        {
          worker: "featureCreation",
          summary: "No model available for Feature Creation",
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    "featureCreation.md",
    "You are an expert AI Feature Engineering Agent specialized in feature creation."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating feature creation recommendations based on orchestration decisions..."
    );
  }

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Design and generate feature creation recommendations for the tables and targets determined by the Orchestrator.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    // `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: FEATURE_CREATION`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature creation code into the FEATURE_CREATION region in '${scriptPath}'.`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<FeatureCreationOutput>(
      "featureCreation",
      async () =>
        await invokeAgentJson<FeatureCreationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:featureCreation",
            tools: [getTableColumnsAndProfileTool, ...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
    );

    return {
      featureCreation: result,
      history: [
        {
          worker: "featureCreation",
          summary: result.summary || "Feature Creation completed successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[featureCreationNode] Execution failed, using fallback", error);
    return {
      featureCreation: fallback,
      history: [
        {
          worker: "featureCreation",
          summary: "Feature Creation execution failed/fallback triggered",
        },
      ],
    };
  }
}
