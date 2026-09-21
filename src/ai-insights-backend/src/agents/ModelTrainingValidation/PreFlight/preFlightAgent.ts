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
   * Executes the 10-stage pre-flight pipeline sequentially.
   */
  async execute(trainingConfig: any, context: PreFlightContext = {}): Promise<PreFlightReport> {
    console.info("[PreFlightAgent] Starting 10-stage Pre-Flight Assessment...");

    // Stage 1: Understand Training Job
    const config = trainingConfig || {};
    const models = config.models || config.candidate_models || [];
    const modelCount = Array.isArray(models) ? models.length : 1;
    const framework = (config.framework || config.model_framework || "scikit-learn").toLowerCase();
    const frameworks = Array.from(
      new Set(
        Array.isArray(models) && models.length > 0
          ? models.map((m: any) => (m.framework || m.library || framework).toLowerCase())
          : [framework]
      )
    );

    console.info(`[PreFlightAgent] Stage 1: Job understood. ${modelCount} model(s), frameworks: [${frameworks.join(", ")}].`);

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

    return {
      decision,
      status,
      summary,
      verifiedAt: new Date().toISOString(),
      modelCount,
      frameworks,
      system,
      estimates,
      checks: allChecks,
      recommendations: allRecommendations,
      pythonServiceStatus: pyPipeline.status,
      rawPipelineResult: pyPipeline.raw,
    };
  }
}
