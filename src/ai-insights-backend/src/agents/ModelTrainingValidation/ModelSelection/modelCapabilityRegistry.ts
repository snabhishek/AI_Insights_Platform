import {
  MLPredictionType,
  MLTaskSubtype,
  MLTaskType,
  ModelDefinition,
} from "../../../models/modelSelection.types";

/**
 * Empty baseline array: all hardcoded models removed per requirements.
 * Data store starts from scratch and is dynamically populated via web exploration
 * and hydrated from PostgreSQL dynamic_model_registry.
 */
export const DEFAULT_BASE_MODELS: ModelDefinition[] = [];

export class ModelCapabilityRegistry {
  private models: Map<string, ModelDefinition> = new Map();

  constructor(initialModels: ModelDefinition[] = DEFAULT_BASE_MODELS) {
    for (const model of initialModels) {
      this.registerModel(model);
    }
  }

  /**
   * Registers a new model or updates an existing model's metadata in the registry.
   * Prevents duplicate registrations by checking modelId, updating existing entries
   * with newer or more accurate information discovered from the web.
   */
  public registerModel(model: ModelDefinition): void {
    if (!model || !model.modelId) return;
    const id = model.modelId.toLowerCase().trim();
    const existing = this.models.get(id);

    const sourceTypeId = model.sourceTypeId || (model.source === "builtin" ? "builtin" : "external");
    const source = model.source || (sourceTypeId === "builtin" ? "builtin" : "web_search");
    const discoveredAt = model.discoveredAt || existing?.discoveredAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();

    if (existing) {
      // Merge and enrich existing model metadata
      const mergedCapabilities = Array.from(
        new Set([...(existing.capabilities || []), ...(model.capabilities || [])])
      );
      const mergedStrengths = Array.from(
        new Set([...(existing.strengths || []), ...(model.strengths || [])])
      );
      const mergedWeaknesses = Array.from(
        new Set([...(existing.weaknesses || []), ...(model.weaknesses || [])])
      );

      this.models.set(id, {
        ...existing,
        ...model,
        modelId: id,
        displayName: model.displayName || existing.displayName,
        algorithm: model.algorithm || existing.algorithm,
        framework: model.framework || existing.framework || "custom",
        supportedTasks: (model.supportedTasks && model.supportedTasks.length > 0)
          ? model.supportedTasks
          : existing.supportedTasks,
        capabilities: mergedCapabilities,
        strengths: mergedStrengths,
        weaknesses: mergedWeaknesses,
        sourceTypeId,
        sourceType: sourceTypeId === "builtin" ? "builtin" : "external",
        sourceProviderId: model.sourceProviderId || existing.sourceProviderId || null,
        source,
        repositoryUrl: model.repositoryUrl || existing.repositoryUrl || null,
        repositoryId: model.repositoryId || existing.repositoryId || null,
        version: model.version || existing.version || null,
        license: model.license || existing.license || null,
        discoveredAt,
        updatedAt,
        metadata: {
          ...(existing.metadata || {}),
          ...(model.metadata || {}),
        },
      });
      return;
    }

    // New model registration
    this.models.set(id, {
      ...model,
      modelId: id,
      framework: model.framework || "custom",
      supportedTasks: model.supportedTasks || [],
      supportedSubTasks: model.supportedSubTasks || [],
      supportedPredictionTypes: model.supportedPredictionTypes || [],
      capabilities: model.capabilities || [],
      strengths: model.strengths || [],
      weaknesses: model.weaknesses || [],
      isBaseline: Boolean(model.isBaseline),
      isDynamic: model.isDynamic ?? (sourceTypeId !== "builtin"),
      sourceTypeId,
      sourceType: sourceTypeId === "builtin" ? "builtin" : "external",
      sourceProviderId: model.sourceProviderId || null,
      source,
      repositoryUrl: model.repositoryUrl || null,
      repositoryId: model.repositoryId || null,
      version: model.version || null,
      license: model.license || null,
      discoveredAt,
      updatedAt,
      metadata: model.metadata || {},
    });
  }

  /**
   * Updates specific metadata fields for an existing model in the registry.
   */
  public updateModelMetadata(modelId: string, updates: Partial<ModelDefinition>): boolean {
    if (!modelId) return false;
    const id = modelId.toLowerCase().trim();
    const existing = this.models.get(id);
    if (!existing) return false;

    this.models.set(id, {
      ...existing,
      ...updates,
      modelId: id,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * Bulk registers dynamic models (e.g. loaded from PostgreSQL dynamic_model_registry).
   */
  public registerDynamicModels(models: ModelDefinition[]): void {
    for (const model of models) {
      this.registerModel({ ...model, isDynamic: true });
    }
  }

  public getModel(modelId: string): ModelDefinition | undefined {
    if (!modelId) return undefined;
    return this.models.get(modelId.toLowerCase().trim());
  }

  public isModelSupported(modelId: string): boolean {
    if (!modelId) return false;
    return this.models.has(modelId.toLowerCase().trim());
  }

  public getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Returns all models originating from external sources.
   */
  public getExternalModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.sourceTypeId === "external" || m.sourceType === "external" || m.isDynamic
    );
  }

  /**
   * Returns built-in baseline or platform native models.
   */
  public getBuiltinModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.sourceTypeId === "builtin" || m.source === "builtin"
    );
  }

  /**
   * Returns models originating from a specific provider, domain, or platform.
   */
  public getModelsBySource(source: string): ModelDefinition[] {
    if (!source) return [];
    const target = source.toLowerCase().trim();
    return Array.from(this.models.values()).filter(
      (m) => (m.source || "").toLowerCase().trim() === target ||
             (m.sourceProviderId || "").toLowerCase().trim() === target
    );
  }

  /**
   * Clears all models from the in-memory registry.
   */
  public clearModels(): void {
    this.models.clear();
  }

  /**
   * Deterministically filter candidate models by task, subtype, and prediction type.
   */
  public filterCandidates(criteria: {
    task?: MLTaskType | string;
    subtype?: MLTaskSubtype | string;
    predictionType?: MLPredictionType | string;
    excludedModelIds?: string[];
    preferredFrameworks?: string[];
  }): ModelDefinition[] {
    const excluded = new Set((criteria.excludedModelIds || []).map((id) => id.toLowerCase().trim()));
    const preferred = criteria.preferredFrameworks?.map((f) => f.toLowerCase().trim()) || [];

    return Array.from(this.models.values()).filter((model) => {
      // 1. Check exclusions
      if (excluded.has(model.modelId.toLowerCase().trim())) {
        return false;
      }

      // 2. Check task match
      if (criteria.task && model.supportedTasks && model.supportedTasks.length > 0) {
        const matchesTask = model.supportedTasks.some(
          (t) => String(t).toLowerCase() === String(criteria.task).toLowerCase()
        );
        if (!matchesTask) {
          return false;
        }
      }

      // 3. Check subtype match if provided
      if (criteria.subtype && model.supportedSubTasks && model.supportedSubTasks.length > 0) {
        const matchesSubtype = model.supportedSubTasks.some(
          (st) => String(st).toLowerCase() === String(criteria.subtype).toLowerCase()
        );
        if (!matchesSubtype) {
          return false;
        }
      }

      // 4. Check prediction type if provided
      if (criteria.predictionType && model.supportedPredictionTypes && model.supportedPredictionTypes.length > 0) {
        const matchesPredType = model.supportedPredictionTypes.some(
          (pt) => String(pt).toLowerCase() === String(criteria.predictionType).toLowerCase()
        );
        if (!matchesPredType) {
          return false;
        }
      }

      // 5. Check preferred frameworks if provided
      if (preferred.length > 0 && model.framework && !preferred.includes(model.framework.toLowerCase())) {
        // We keep it as alternative unless strictly excluded
      }

      return true;
    });
  }

  /**
   * Find baseline models compatible with the given task.
   */
  public getBaselinesForTask(task: MLTaskType | string): ModelDefinition[] {
    const targetTask = String(task).toLowerCase();
    return Array.from(this.models.values()).filter(
      (m) => m.isBaseline && (m.supportedTasks || []).some((t) => String(t).toLowerCase() === targetTask)
    );
  }
}

// Export singleton instance initialized with empty catalog
export const defaultModelCapabilityRegistry = new ModelCapabilityRegistry();
