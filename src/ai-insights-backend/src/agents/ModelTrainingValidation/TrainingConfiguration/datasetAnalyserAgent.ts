import { BaseMessage } from "@langchain/core/messages";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentText } from "../../utils/agentUtils";
import {
  createGetTableColumnsAndProfileTool,
  getMcpFilesystemTools,
} from "../../tools";
import { createReadArtifactHeadersTool } from "./tools/readArtifactHeadersTool";

export class DatasetAnalyserAgent {

  public static async execute(
    queryMessage: string,
    services: IngestionServices,
    runTimestamp?: string,
    conversationHistory: BaseMessage[] = [],
    parentState?: any
  ): Promise<string> {
    const model = getModel();

    const getTableColumnsTool = createGetTableColumnsAndProfileTool(
      parentState?.inspection || parentState?.inspector || {},
      parentState?.dataProfile || {}
    );
    const readHeadersTool = createReadArtifactHeadersTool(services, runTimestamp);
    let fsTools: any[] = [];
    try {
      fsTools = await getMcpFilesystemTools(services);
    } catch (err: any) {
      console.warn("[DatasetAnalyserAgent] MCP filesystem tools warning:", err?.message || err);
    }

    const tools = [
      readHeadersTool,
      getTableColumnsTool,
      ...fsTools,
    ];

    const systemPrompt = [
      "You are the senior Dataset Analyser Agent in an automated machine learning platform.",
      "Your role is to collaborate with the Training Configuration Agent by answering its technical questions regarding dataset characteristics, feature representations, temporal properties, and target variable behaviors.",
      "",
      "=== INSTRUCTIONS & CONSTRAINTS ===",
      "1. EXPLANATION FORMAT: Return your analysis as a structured, detailed narrative in markdown explanation format (not raw structured JSON). Use clear headings, bullet points, and analytical justifications.",
      "2. ARTIFACT METADATA: Share critical artifact metadata (e.g. logical artifact names, row counts, feature counts, data types, missingness percentages, cardinality, and class distributions).",
      "3. ZERO FILE PATH EXPOSURE: NEVER output or reveal raw local filesystem paths (e.g. do not show 'C:\\...', '/workspaces/...', or '/tmp/...'). Refer only to logical artifact names (e.g. 'dataset.parquet', 'profiling_report.json', 'relationship_schema.json').",
      "4. TOOL USAGE: Use 'read_artifact_headers' to inspect column names and types of Parquet/CSV/JSON artifacts. Use MCP filesystem tools or profiling tools to inspect summary files.",
      "5. TOKEN LIMIT: Keep your explanations thorough, concise, and within 5,000 tokens.",
    ].join("\n");

    const fallbackExplanation = [
      "### Dataset Characteristics Summary",
      "- Artifact: dataset.parquet",
      "- Target Column: Inferred primary target from feature set",
      "- Problem Type: Supervised learning",
      "- Features: Engineered numerical and categorical features ready for model training",
      "- Note: Deterministic baseline explanation used as fallback.",
    ].join("\n");

    const response = await invokeAgentText(
      "datasetAnalyserAgent",
      model,
      queryMessage,
      fallbackExplanation,
      services,
      {
        systemPrompt,
        tools,
        traceLabel: "agent:datasetAnalyser",
        recursionLimit: 100,
        maxOutputTokens: 5000,
        middlewareOptions: {
          summarization: {
            triggerTokens: 100000,
            keepTokens: 25000,
          },
        },
        messages: conversationHistory,
      }
    );

    return sanitizeOutputText(response);
  }
}

function sanitizeOutputText(text: string): string {
  if (!text) return "";

  let sanitized = text.replace(/[a-zA-Z]:\\[^\s"'`\(\)\]\}]+/g, (match) => {
    const parts = match.split(/[\/\\]/);
    return parts[parts.length - 1] || "artifact";
  });

  sanitized = sanitized.replace(/\/workspace\/[^\s"'`\(\)\]\}]+/g, (match) => {
    const parts = match.split("/");
    return parts[parts.length - 1] || "artifact";
  });
  return sanitized;
}
