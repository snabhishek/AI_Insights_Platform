import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, DataValidationOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";

export async function dataValidationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: DataValidationOutput = {
    status: "Failed",
    summary: "Data Validation fallback triggered",
  };

  if (!model) {
    return { dataValidation: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "dataValidation.md",
    "You are an expert AI Data Quality and Validation Agent."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating data validation code to audit the baseline dataset..."
    );
  }

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Generate data validation script to audit the baseline dataset.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Assembled Dataset Script: ${state.buildDataset.pythonCode || ""}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: DATA_VALIDATION`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your data validation code into the DATA_VALIDATION region in '${scriptPath}'.`,
    "3. Return the final JSON summary.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<DataValidationOutput>(
      "dataValidation",
      async () =>
        await invokeAgentJson<DataValidationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:dataValidation",
            tools: [...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
    );

    return {
      dataValidation: result,
      history: [
        {
          worker: "dataValidation",
          summary: result.summary || "Data Validation script generated successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[dataValidationNode] Execution failed, using fallback", error);
    return {
      dataValidation: fallback,
      history: [
        {
          worker: "dataValidation",
          summary: "Data Validation code generation failed/fallback triggered",
        },
      ],
    };
  }
}
