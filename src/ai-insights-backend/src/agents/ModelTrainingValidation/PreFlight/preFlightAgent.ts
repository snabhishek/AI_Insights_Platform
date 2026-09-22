import * as fs from "fs";
import * as yaml from "js-yaml";
import { PythonCapabilityAdapter } from "./pythonCapabilityAdapter";
import { PreFlightValidator } from "./preFlightValidator";
import { PreFlightDecisionEngine } from "./preFlightDecisionEngine";
import { PreFlightReport, PreFlightCheck, OptimizationRecommendation } from "./types";

export interface PreFlightContext {
  projectId?: string;
  workspaceName?: string;
  runDir?: string;
  datasetPath?: string;
  metadata?: any;
}

export class PreFlightAgent {
  private pythonAdapter: PythonCapabilityAdapter;
  private validator: PreFlightValidator;
  private decisionEngine: PreFlightDecisionEngine;

  constructor(pythonAdapter?: PythonCapabilityAdapter) {
    this.pythonAdapter = pythonAdapter || new PythonCapabilityAdapter();
    this.validator = new PreFlightValidator();
    this.decisionEngine = new PreFlightDecisionEngine();
  }

  /**
   * Normalizes incoming training configuration by unwrapping envelopes,
   * discovering candidate models from all contract sections or disk YAML,
   * and hoisting canonical configuration fields to the root.
   */
  public normalizeTrainingConfig(trainingConfig: any, context: PreFlightContext = {}): any {
    const raw = trainingConfig || {};
    let configObj: Record<string, any> = {};

    // 1. Unwrap envelope if configuration is nested
    if (raw.configuration && typeof raw.configuration === "object" && Object.keys(raw.configuration).length > 0) {
      configObj = { ...raw.configuration };
    } else {
      configObj = { ...raw };
    }

    // 2. If contractPath exists on disk, read and merge from YAML contract file if candidates are missing
    const contractPath = raw.contractPath || configObj.contractPath;
    if (contractPath && typeof contractPath === "string" && fs.existsSync(contractPath)) {
      try {
        const fileContent = fs.readFileSync(contractPath, "utf-8");
        const parsedYaml = (yaml.load(fileContent) as Record<string, any>) || {};
        configObj = { ...parsedYaml, ...configObj };
      } catch (err) {
        console.warn("[PreFlightAgent] Could not read YAML contract from disk:", err);
      }
    }

    // 3. Extract candidate models from all possible locations
    const modelSel = configObj.model_selection || raw.model_selection || {};
    const rawCandidates: any[] =
      (Array.isArray(configObj.models) && configObj.models.length > 0 ? configObj.models : null) ||
      (Array.isArray(configObj.candidate_models) && configObj.candidate_models.length > 0 ? configObj.candidate_models : null) ||
      (Array.isArray(modelSel.models) && modelSel.models.length > 0 ? modelSel.models : null) ||
      (Array.isArray(modelSel.candidates) && modelSel.candidates.length > 0 ? modelSel.candidates : null) ||
      (Array.isArray(modelSel.userSelection?.selectedModels) && modelSel.userSelection.selectedModels.length > 0 ? modelSel.userSelection.selectedModels : null) ||
      (Array.isArray(context.metadata?.modelSelection?.candidates) && context.metadata.modelSelection.candidates.length > 0 ? context.metadata.modelSelection.candidates : null) ||
      (Array.isArray(context.metadata?.modelSelection?.models) && context.metadata.modelSelection.models.length > 0 ? context.metadata.modelSelection.models : null) ||
      [];

    const normalizedModels = rawCandidates.map((m: any) => {
      if (typeof m === "string") {
        return { model_id: m, algorithm: m, framework: "scikit-learn" };
      }
      return {
        ...m,
        model_id: m.model_id || m.id || m.name || m.algorithm || "model",
        algorithm: m.algorithm || m.displayName || m.model_id || m.name || "algorithm",
        framework: m.framework || m.library || "scikit-learn",
      };
    });

    configObj.models = normalizedModels;
    configObj.candidate_models = normalizedModels;

    // 4. Resolve framework
    if (!configObj.framework && !configObj.model_framework) {
      if (normalizedModels.length > 0) {
        configObj.framework = normalizedModels[0].framework || "scikit-learn";
      } else {
        configObj.framework = "scikit-learn";
      }
    }

    // 5. Ensure splits, task_type, primary_metric, target_column are top-level accessible
    if (!configObj.splits && !configObj.data_splits) {
      if (configObj.split) {
        configObj.splits = configObj.split;
      }
    }
    if (!configObj.task_type && !configObj.problem_type) {
      if (configObj.task?.task_type) {
        configObj.task_type = configObj.task.task_type;
      } else if (context.metadata?.problemType) {
        configObj.task_type = context.metadata.problemType;
      }
    }
    if (!configObj.primary_metric && !configObj.metric) {
      if (modelSel.primary_metric) {
        configObj.primary_metric = modelSel.primary_metric;
      }
    }
    if (!configObj.target_column && !configObj.targetColumn) {
      if (modelSel.target_entity?.name) {
        configObj.target_column = modelSel.target_entity.name;
      } else if (context.metadata?.targetColumn) {
        configObj.target_column = context.metadata.targetColumn;
      }
    }

    return configObj;
  }

  /**
   * Executes the 10-stage pre-flight pipeline sequentially.
   */
  async execute(trainingConfig: any, context: PreFlightContext = {}): Promise<PreFlightReport> {
    console.info("[PreFlightAgent] Starting 10-stage Pre-Flight Assessment...");

    // Stage 1: Understand Training Job
    const config = this.normalizeTrainingConfig(trainingConfig, context);
    const models = config.models || config.candidate_models || [];
    const modelCount = Array.isArray(models) && models.length > 0 ? models.length : 1;
    const framework = (config.framework || config.model_framework || "scikit-learn").toLowerCase();
    const frameworks = Array.from(
      new Set(
        Array.isArray(models) && models.length > 0
          ? models.map((m: any) => (m.framework || m.library || framework).toLowerCase())
          : [framework]
      )
    );

    console.info(`[PreFlightAgent] Stage 1: Job understood. ${models.length} model(s), frameworks: [${frameworks.join(", ")}].`);

    // Fetch system snapshot and Python capabilities
    const pyPipeline = await this.pythonAdapter.runPreflightPipeline(config);
    const system = pyPipeline.system;
    console.info(
      `[PreFlightAgent] Python adapter status: '${pyPipeline.status}'. Host RAM: ${system.ram_total_gb.toFixed(1)} GB, Free Disk: ${system.disk_free_gb.toFixed(1)} GB, GPUs: ${system.gpus.length}.`
    );

    const allChecks: PreFlightCheck[] = [];

    // Stage 2: Configuration Validation
    const stage2Checks = this.validator.validateConfiguration(config);
    allChecks.push(...stage2Checks);
    console.info(`[PreFlightAgent] Stage 2: Configuration validated (${stage2Checks.length} checks).`);

    // Stage 3: Model & Framework Compatibility
    const stage3Checks = this.validator.validateModelAndFramework(config, system);
    allChecks.push(...stage3Checks);
    console.info(`[PreFlightAgent] Stage 3: Framework compatibility verified (${stage3Checks.length} checks).`);

    // Stage 4: Data & Feature Readiness
    const stage4Checks = this.validator.validateDataAndFeatures(config, context);
    allChecks.push(...stage4Checks);
    console.info(`[PreFlightAgent] Stage 4: Data & feature readiness verified (${stage4Checks.length} checks).`);

    // Stage 5: Optimization Strategy Evaluation
    const pyProposals = pyPipeline.decision?.optimizations || [];
    const { checks: stage5Checks, recommendations: optRecs } = this.decisionEngine.evaluateOptimizations(
      config,
      system,
      pyProposals
    );
    allChecks.push(...stage5Checks);
    console.info(`[PreFlightAgent] Stage 5: Optimization evaluation complete (${stage5Checks.length} checks, ${optRecs.length} recommendations).`);

    // Stage 6: Resource & Training Estimation
    const { estimates, checks: stage6Checks } = this.decisionEngine.estimateResources(
      config,
      system,
      pyPipeline.decision
    );
    allChecks.push(...stage6Checks);
    console.info(`[PreFlightAgent] Stage 6: Resource estimations computed (RAM: ${estimates.ram_gb} GB, confidence: ${estimates.confidence}).`);

    // Stage 7: Resource Safety Assessment
    const { checks: stage7Checks, bottleneck, criticalFailure } = this.decisionEngine.assessResourceSafety(
      system,
      estimates
    );
    allChecks.push(...stage7Checks);
    estimates.bottleneck = bottleneck;
    console.info(`[PreFlightAgent] Stage 7: Safety assessment complete. Bottleneck: '${bottleneck}'.`);

    // Stage 8: Configuration Change Analysis (consolidate recommendations)
    const allRecommendations: OptimizationRecommendation[] = [...optRecs];
    console.info(`[PreFlightAgent] Stage 8: Configuration change analysis produced ${allRecommendations.length} action items.`);

    // Stage 9: Safe Pre-Execution Check
    const stage9Checks = this.validator.validatePreExecution({
      runDir: context.runDir,
      outputDir: config.output_dir || config.artifacts_dir,
    });
    allChecks.push(...stage9Checks);
    console.info(`[PreFlightAgent] Stage 9: Safe pre-execution filesystem check verified.`);

    // Stage 10: Final Decision
    const { decision, status, summary } = this.decisionEngine.makeFinalDecision(
      allChecks,
      allRecommendations,
      criticalFailure,
      bottleneck
    );
    console.info(`[PreFlightAgent] Stage 10: Final Pre-Flight Decision: [${decision}] - ${summary}`);

    // Structured Hardware Evaluation & Strategy Resolution
    const hardwareDecision = this.decisionEngine.evaluateHardwareAndStrategy(
      config,
      system,
      estimates,
      pyPipeline.decision
    );

    return {
      decision,
      status,
      summary,
      verifiedAt: new Date().toISOString(),
      modelCount: models.length > 0 ? models.length : modelCount,
      frameworks,
      system,
      estimates,
      checks: allChecks,
      recommendations: allRecommendations,
      pythonServiceStatus: pyPipeline.status,
      rawPipelineResult: pyPipeline.raw,
      gpu_available: hardwareDecision.gpu_available,
      gpu_evaluation: hardwareDecision.gpu_evaluation,
      cpu_evaluation: hardwareDecision.cpu_evaluation,
      selected_resource: hardwareDecision.selected_resource,
      direct_execution_feasible: hardwareDecision.direct_execution_feasible,
      optimization_feasible: hardwareDecision.optimization_feasible,
      selected_strategy: hardwareDecision.selected_strategy,
      decision_reason: hardwareDecision.decision_reason,
      constraints_or_missing_requirements: hardwareDecision.constraints_or_missing_requirements,
    };
  }
}
