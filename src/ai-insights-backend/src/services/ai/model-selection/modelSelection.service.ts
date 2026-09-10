import { v4 as uuidv4 } from "uuid";
import { IModelSelectionService } from "./modelSelection.service.interface";
import { IModelSelectionRepository } from "../../../repositories/modelSelection.repository.interface";
import { IModelSelectionLLMService } from "./modelSelectionLLM.service.interface";
import { ProjectService } from "../../project/project.service";
import {
  defaultModelCapabilityRegistry,
  ModelCapabilityRegistry,
} from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionContextNormalizer } from "../../../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { ModelSelectionValidator } from "../../../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import {
  ModelSelectionDecisionRecord,
  UserSelectionHandoff,
} from "../../../models/modelSelection.types";

export class ModelSelectionService implements IModelSelectionService {
  private agentVersion = "1.0.0";
  private modelCatalogVersion = "1.0.0";

  constructor(
    private repository: IModelSelectionRepository,
    private llmService: IModelSelectionLLMService,
    private projectService: ProjectService,
    private registry: ModelCapabilityRegistry = defaultModelCapabilityRegistry
  ) {}

  public getRegistry(): ModelCapabilityRegistry {
    return this.registry;
  }

  /**
   * Hydrates dynamic models previously saved to PostgreSQL into the in-memory registry.
   */
  private async hydrateDynamicModels(): Promise<void> {
    try {
      const dynamicModels = await this.repository.getDynamicModels();
      if (dynamicModels.length > 0) {
        this.registry.registerDynamicModels(dynamicModels);
      }
    } catch (e: any) {
      console.warn("[ModelSelectionService] Could not hydrate dynamic models from DB:", e?.message || e);
    }
  }

  public async analyze(inputContext: any, projectId?: string): Promise<ModelSelectionDecisionRecord> {
    const startTime = Date.now();
    const effectiveProjectId = projectId || inputContext.projectId || "default-project";

    console.info(`[ModelSelectionService] Starting Model Selection analysis for project ${effectiveProjectId}`);

    // 1. Hydrate dynamic models from DB
    await this.hydrateDynamicModels();

    // 2. Normalize input context (leakage context excluded per specification)
    const normalizedContext = ModelSelectionContextNormalizer.normalize({
      ...inputContext,
      projectId: effectiveProjectId,
    });

    // 3. Invoke LLM Service with prompt from prompts/ModelSelection/modelSelection.md and web search tool
    const decision = await this.llmService.generateDecision(normalizedContext, this.registry);

    // 4. Auto-register any dynamically explored models if present in decision
    if (Array.isArray(decision.models)) {
      for (const m of decision.models) {
        if (!this.registry.isModelSupported(m.model_id)) {
          const newDef = {
            modelId: m.model_id,
            displayName: m.model_id,
            algorithm: m.algorithm || "Machine Learning Model",
            framework: (m.framework as any) || "custom",
            supportedTasks: [decision.target_entity?.datatype === "boolean" ? "tabular_classification" : "tabular_regression"] as any,
            supportedSubTasks: [],
            supportedPredictionTypes: ["point", "value"] as any,
            capabilities: ["numerical_features"],
            strengths: ["Explored novel architecture"],
            weaknesses: [],
            isBaseline: false,
            isDynamic: true,
            source: "web_search" as const,
          };
          this.registry.registerModel(newDef);
          try {
            await this.repository.saveDynamicModel(newDef);
          } catch (regErr: any) {
            console.warn(`[ModelSelectionService] Failed to persist dynamic model "${m.model_id}" to DB:`, regErr?.message || regErr);
          }
        }
      }
    }

    // 5. Deterministic Validation
    const validation = ModelSelectionValidator.validate(decision, this.registry);
    if (!validation.isValid) {
      console.error("[ModelSelectionService] Decision validation failed:", validation.errors);
      throw new Error(`Model Selection Decision validation failed: ${validation.errors.join("; ")}`);
    }

    const durationMs = Date.now() - startTime;
    const decisionId = `msd-${uuidv4()}`;

    // 6. Build persistent decision record
    const record: ModelSelectionDecisionRecord = {
      id: decisionId,
      projectId: effectiveProjectId,
      useCase: normalizedContext.businessContext.useCase,
      status: decision.status,
      datasetVersion: inputContext.runTimestamp || new Date().toISOString(),
      featureSetVersion: inputContext.featureSetVersion || "v1",
      modelCatalogVersion: this.modelCatalogVersion,
      promptVersion: this.llmService.getPromptVersion(),
      agentVersion: this.agentVersion,
      llmProvider: process.env.AI_PROVIDER || "openai",
      llmModel: process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || "default",
      executionDurationMs: durationMs,
      candidateCount: decision.candidates?.length || 0,
      primaryModelId: decision.recommended_model?.model_id || "",
      inputContextSnapshot: normalizedContext,
      decision,
      isStale: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 7. Persist decision to database
    await this.repository.saveDecision(record);
    console.info(`[ModelSelectionService] Persisted Model Selection Decision ${decisionId} in ${durationMs}ms`);

    // 8. Update project agent state if projectId provided
    if (effectiveProjectId) {
      try {
        const project = await this.projectService.getById(effectiveProjectId);
        const existingState = (project?.agentState as any) || {};

        const updatedState = {
          ...existingState,
          modelSelection: decision,
          stageOutputs: {
            ...(existingState.stageOutputs || {}),
            modelSelection: decision,
          },
          stageStatuses: {
            ...(existingState.stageStatuses || {}),
            modelSelection: "Completed",
          },
        };

        await this.projectService.updateAgentState(effectiveProjectId, updatedState, normalizedContext.businessContext.useCase);
      } catch (projErr: any) {
        console.warn(`[ModelSelectionService] Could not update project agentState for ${effectiveProjectId}:`, projErr?.message || projErr);
      }
    }

    return record;
  }

  public async getDecision(id: string): Promise<ModelSelectionDecisionRecord | undefined> {
    return this.repository.getById(id);
  }

  public async getLatestProjectDecision(projectId: string): Promise<ModelSelectionDecisionRecord | undefined> {
    return this.repository.getLatestByProjectId(projectId);
  }

  public async recordUserSelection(
    decisionId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord> {
    const record = await this.repository.getById(decisionId);
    if (!record) {
      throw new Error(`Model Selection Decision "${decisionId}" not found`);
    }

    if (!Array.isArray(selectedModelIds) || selectedModelIds.length === 0) {
      throw new Error("Must select at least one candidate model for training");
    }

    // Validate that all user-selected model IDs exist in the agent's candidates list
    const candidateIds = new Set((record.decision.candidates || []).map((c) => c.model_id.toLowerCase().trim()));
    for (const sel of selectedModelIds) {
      if (!candidateIds.has(sel.toLowerCase().trim())) {
        throw new Error(`Selected model "${sel}" is not in the recommended candidates list`);
      }
    }

    const userSelection: UserSelectionHandoff = {
      selectedModelIds,
      confirmedAt: new Date().toISOString(),
    };

    // Update the decision record without mutating original recommendation
    const updatedRecord = await this.repository.updateUserSelection(decisionId, userSelection);

    // Perform handoff to Training Configuration in the project's agentState
    if (record.projectId) {
      try {
        const project = await this.projectService.getById(record.projectId);
        const existingState = (project?.agentState as any) || {};

        const trainingConfigPayload = {
          ...(existingState.trainingConfiguration || {}),
          status: "Pending",
          models: selectedModelIds,
          candidate_models: selectedModelIds,
          selectedByUserAt: userSelection.confirmedAt,
          sourceDecisionId: decisionId,
        };

        const updatedState = {
          ...existingState,
          trainingConfiguration: trainingConfigPayload,
          stageOutputs: {
            ...(existingState.stageOutputs || {}),
            trainingConfiguration: trainingConfigPayload,
          },
          stageStatuses: {
            ...(existingState.stageStatuses || {}),
            trainingConfiguration: "In Progress",
          },
        };

        await this.projectService.updateAgentState(record.projectId, updatedState);
        console.info(`[ModelSelectionService] Successfully handed off ${selectedModelIds.length} user-selected models to Training Configuration for project ${record.projectId}`);
      } catch (e: any) {
        console.warn(`[ModelSelectionService] Training handoff state update failed for project ${record.projectId}:`, e?.message || e);
      }
    }

    return updatedRecord || record;
  }
}
