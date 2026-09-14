import { createWebSearchTool, createExtractUrlContentTool } from "../../tools/search";
import { ModelCapabilityRegistry } from "./modelCapabilityRegistry";
import { ModelDefinition, ModelFramework } from "../../../models/modelSelection.types";

/**
 * Re-export existing web search tools from tools/search as used across agents (e.g., Exogenous Scout).
 * Avoids creating duplicate customized search tools.
 */
export { createWebSearchTool, createExtractUrlContentTool };
export const createModelWebSearchTool = createWebSearchTool;

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
