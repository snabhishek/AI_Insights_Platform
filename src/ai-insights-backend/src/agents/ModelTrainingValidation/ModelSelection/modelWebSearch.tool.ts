import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { webSearchTool } from "../../tools/search/websearch";
import { ModelCapabilityRegistry } from "./modelCapabilityRegistry";
import { ModelDefinition, ModelFramework } from "../../../models/modelSelection.types";

/**
 * Creates a web search tool specifically tuned for Model Selection exploration.
 * Allows the Model Selection Agent to explore state-of-the-art models, newly published
 * architectures (e.g., TimeGPT, Nixtla, Hugging Face transformers, TabNet), and domain-specific
 * benchmarks before making a final recommendation.
 */
export function createModelWebSearchTool(registry?: ModelCapabilityRegistry) {
  return tool(
    async (arg: { query: string; purpose?: string }) => {
      try {
        const query = typeof arg === "string" ? arg : arg?.query;
        if (!query || query.trim().length === 0) {
          return "Please provide a specific search query for machine learning models or algorithms.";
        }

        console.info(`[ModelWebSearch] Searching for ML models: "${query}"`);
        const searchResult = await webSearchTool.invoke({ query });
        const resultString = typeof searchResult === "string" ? searchResult : JSON.stringify(searchResult);

        return resultString;
      } catch (error: any) {
        console.warn(`[ModelWebSearch] Search failed:`, error?.message || error);
        return `Web search failed: ${error?.message || "Unknown error"}`;
      }
    },
    {
      name: "model_web_search",
      description:
        "Search the web for state-of-the-art machine learning models, newly released architectures (such as TimeGPT, Nixtla, specialized Hugging Face models, foundation tabular models), and academic or Kaggle benchmark strategies for the specific use case and data structure.",
      schema: z.object({
        query: z.string().describe("The search query looking for state-of-the-art ML models or architectures for this task"),
        purpose: z.string().optional().describe("Optional brief description of the modeling requirement or use case"),
      }),
    }
  );
}

/**
 * Helper to dynamically register a model discovered during web exploration.
 */
export function dynamicallyRegisterExploredModel(
  registry: ModelCapabilityRegistry,
  discovered: {
    modelId: string;
    displayName: string;
    algorithm: string;
    framework: string;
    supportedTasks: string[];
    capabilities?: string[];
    strengths?: string[];
    weaknesses?: string[];
    isBaseline?: boolean;
    metadata?: Record<string, unknown>;
  }
): ModelDefinition {
  const definition: ModelDefinition = {
    modelId: discovered.modelId.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_"),
    displayName: discovered.displayName,
    algorithm: discovered.algorithm,
    framework: (discovered.framework.toLowerCase() as ModelFramework) || "custom",
    supportedTasks: (discovered.supportedTasks as any) || ["tabular_classification"],
    supportedSubTasks: [],
    supportedPredictionTypes: ["point", "value"],
    capabilities: discovered.capabilities || ["numerical_features"],
    strengths: discovered.strengths || ["Specialized architecture discovered via model exploration"],
    weaknesses: discovered.weaknesses || ["May require custom runtime environment or API key"],
    isBaseline: Boolean(discovered.isBaseline),
    isDynamic: true,
    source: "web_search",
    metadata: discovered.metadata || {},
  };

  registry.registerModel(definition);
  console.info(`[ModelCapabilityRegistry] Dynamically registered explored model: "${definition.displayName}" (${definition.modelId})`);
  return definition;
}
