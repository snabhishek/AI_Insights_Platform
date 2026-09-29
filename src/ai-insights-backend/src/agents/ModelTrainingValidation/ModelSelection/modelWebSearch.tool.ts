import { ModelCapabilityRegistry } from "./modelCapabilityRegistry";
import { ModelDefinition } from "../../../models/modelSelection.types";

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
    sourceTypeId?: string;
    sourceProviderId?: string | null;
    source?: string;
    repositoryUrl?: string | null;
    repositoryId?: string | null;
    version?: string | null;
    license?: string | null;
    discoveredAt?: string;
    metadata?: Record<string, unknown>;
  }
): ModelDefinition {
  const sourceTypeId = discovered.sourceTypeId || (discovered.source === "builtin" ? "builtin" : "external");
  const source = discovered.source || "web_search";

  const definition: ModelDefinition = {
    modelId: discovered.modelId.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_"),
    displayName: discovered.displayName,
    algorithm: discovered.algorithm,
    framework: (discovered.framework || "custom").toLowerCase(),
    supportedTasks: (discovered.supportedTasks as any) || ["tabular_classification"],
    supportedSubTasks: [],
    supportedPredictionTypes: ["point", "value"],
    capabilities: discovered.capabilities || ["numerical_features"],
    strengths: discovered.strengths || ["Specialized architecture discovered via web model exploration"],
    weaknesses: discovered.weaknesses || [],
    isBaseline: Boolean(discovered.isBaseline),
    isDynamic: true,
    sourceTypeId,
    sourceType: sourceTypeId === "builtin" ? "builtin" : "external",
    sourceProviderId: discovered.sourceProviderId || null,
    source,
    repositoryUrl: discovered.repositoryUrl || null,
    repositoryId: discovered.repositoryId || null,
    version: discovered.version || null,
    license: discovered.license || null,
    discoveredAt: discovered.discoveredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: discovered.metadata || {},
  };

  registry.registerModel(definition);
  console.info(`[ModelCapabilityRegistry] Dynamically registered explored model: "${definition.displayName}" (${definition.modelId}) [source: ${definition.source}]`);
  return definition;
}
