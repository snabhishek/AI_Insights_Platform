import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { desc } from "drizzle-orm";
import { pool } from "../db";
import * as connectorsSchema from "../db/connectors";
import * as modelSelectionSchema from "../db/modelSelection";
import { ModelSelectionLLMService } from "../services/ai/model-selection/modelSelectionLLM.service";
import { ModelSelectionContextNormalizer } from "../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { defaultModelCapabilityRegistry } from "../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionValidator } from "../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import { TrainingConfigurationAgent } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigurationAgent";
import { AgentTraceHelper } from "../agents/utils/agentUtils";

dotenv.config();

async function runTest() {
  console.log("=========================================================================");
  console.log(" TEST: Model Selection Agent Problem Specs & Evaluation Contract (No Fallbacks)");
  console.log("=========================================================================\n");

  let allPassed = true;
  const assert = (condition: boolean, msg: string, detail?: any) => {
    if (condition) {
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
      if (detail) console.error("       Details:", detail);
      allPassed = false;
    }
  };

  // 1. Fetch last run state from database or fallback JSON
  console.log("[Step 1] Fetching latest workflow state...");
  let state: any = null;
  const db = drizzle(pool, { schema: { ...connectorsSchema, ...modelSelectionSchema } });

  try {
    const runs = await db
      .select()
      .from(connectorsSchema.projectRuns)
      .orderBy(desc(connectorsSchema.projectRuns.createdAt))
      .limit(20);

    for (const run of runs) {
      const runState = run.agentState as any;
      if (runState && (runState.featureArchitect || runState.modelSelection || runState.userPrompt)) {
        console.log(`✓ Found latest run state in database (Run ID: ${run.id}, Project ID: ${run.projectId})`);
        state = {
          ...runState,
          projectId: run.projectId || runState.projectId,
          useCase: run.useCase || runState.useCase,
        };
        break;
      }
    }
  } catch (dbErr: any) {
    console.warn("⚠️  Could not query DB for run state:", dbErr?.message || dbErr);
  }

  if (!state) {
    const localStatePath = path.resolve(__dirname, "../../logs/agent_state_last_run.json");
    if (fs.existsSync(localStatePath)) {
      console.log(`✓ Loaded fallback state from ${localStatePath}`);
      state = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
    }
  }

  assert(Boolean(state), "Workflow state retrieved successfully");
  if (!state) {
    console.error("No state found. Exiting test.");
    process.exit(1);
  }

  // 2. Prepare upstream context for Model Selection
  console.log("\n[Step 2] Assembling upstream context from state...");
  const architect = state.featureArchitect || {};
  const architectDecision = architect.orchestrationDecision || architect.decision || {};
  const targetCol = architectDecision.targetColumn || state.targetColumn || "Order_Quantity";
  const problemType = architectDecision.problemType || state.problemType || "forecasting";
  const userPrompt = state.userPrompt || state.useCase || "HVAC demand forecasting pipeline";

  console.log(`   Target Column: "${targetCol}"`);
  console.log(`   Problem Type Context: "${problemType}"`);
  console.log(`   Use Case: "${userPrompt.slice(0, 100)}..."`);

  const mockServices: any = {
    projectId: state.projectId || "default-project",
    traceHelper: new AgentTraceHelper(),
    logMilestoneThinking: async () => {},
  };

  const inputContext = {
    projectId: state.projectId || "default-project",
    userPrompt,
    useCase: userPrompt,
    runTimestamp: state.runTimestamp || "test-timestamp",
    featureArchitect: state.featureArchitect,
    featureValidator: state.featureValidator,
    exogenousScout: state.exogenousScout,
    targetColumn: targetCol,
    problemType,
    services: mockServices,
  };

  const normalizedContext = ModelSelectionContextNormalizer.normalize(inputContext);

  // 3. Execute Model Selection Agent
  console.log("\n[Step 3] Executing Model Selection LLM Service (Pure Agentic Flow)...");
  const llmService = new ModelSelectionLLMService();
  const registry = defaultModelCapabilityRegistry;

  const decision = await llmService.generateDecision(normalizedContext, registry, {
    services: mockServices,
  });

  console.log("\n[Step 4] Validating Model Selection Output Schema & Fields (Strict, No Fallbacks)...");
  console.log("   problem_type:     ", decision.problem_type);
  console.log("   task_type:        ", decision.task_type);
  console.log("   task_subtype:     ", decision.task_subtype);
  console.log("   prediction_type:  ", decision.prediction_type);
  console.log("   primary_metric:   ", decision.primary_metric);
  console.log("   direction:        ", decision.direction);
  console.log("   secondary_metrics:", JSON.stringify(decision.secondary_metrics));
  console.log("   recommended_model:", decision.recommended_model?.model_id);
  console.log("   candidate count:  ", decision.candidates?.length);

  assert(
    typeof decision.problem_type === "string" && decision.problem_type.trim().length > 0,
    `problem_type is strictly present from agent ("${decision.problem_type}")`
  );
  assert(
    typeof decision.task_type === "string" && decision.task_type.trim().length > 0,
    `task_type is strictly present from agent ("${decision.task_type}")`
  );
  assert(
    typeof decision.task_subtype === "string" && decision.task_subtype.trim().length > 0,
    `task_subtype is strictly present from agent ("${decision.task_subtype}")`
  );
  assert(
    typeof decision.prediction_type === "string" && decision.prediction_type.trim().length > 0,
    `prediction_type is strictly present from agent ("${decision.prediction_type}")`
  );
  assert(
    typeof decision.primary_metric === "string" && decision.primary_metric.trim().length > 0,
    `primary_metric is strictly present from agent ("${decision.primary_metric}")`
  );
  assert(
    decision.direction === "maximize" || decision.direction === "minimize",
    `direction is strictly valid ("${decision.direction}")`
  );
  assert(
    Array.isArray(decision.secondary_metrics) && decision.secondary_metrics.length > 0,
    `secondary_metrics is populated with >= 1 items (${decision.secondary_metrics?.join(", ")})`
  );
  assert(
    Array.isArray(decision.candidates) && decision.candidates.length >= 1,
    `candidates list is populated (${decision.candidates?.length} models)`
  );
  assert(
    Boolean(decision.recommended_model?.model_id),
    `recommended_model is established ("${decision.recommended_model?.model_id}")`
  );

  // Register discovered dynamic candidate models in registry before validator check (same as ModelSelectionService.analyze)
  if (Array.isArray(decision.candidates)) {
    for (const c of decision.candidates) {
      if (!registry.isModelSupported(c.model_id)) {
        registry.registerModel({
          modelId: c.model_id,
          displayName: c.displayName || c.model_id,
          algorithm: c.algorithm || c.displayName || c.model_id,
          framework: c.framework || "custom",
          supportedTasks: [decision.task_type || "time_series_forecasting"],
          supportedSubTasks: [decision.task_subtype || "panel_time_series_forecasting"],
          supportedPredictionTypes: [decision.prediction_type || "value"],
          capabilities: ["numerical_features"],
          strengths: c.reasoning?.strengths || ["Discovered candidate model"],
          weaknesses: c.reasoning?.weaknesses || [],
          isBaseline: false,
          isDynamic: true,
          sourceTypeId: c.source_type_id || "external",
          sourceType: c.source_type || "external",
          source: c.source || "web_search",
          repositoryUrl: c.repository_url || null,
        });
      }
    }
  }
  const baselineId = decision.training?.baseline_model;
  if (baselineId && !registry.isModelSupported(baselineId)) {
    registry.registerModel({
      modelId: baselineId,
      displayName: baselineId,
      algorithm: baselineId,
      framework: "sklearn",
      supportedTasks: [decision.task_type || "time_series_forecasting"],
      supportedSubTasks: [],
      supportedPredictionTypes: [decision.prediction_type || "value"],
      capabilities: [],
      strengths: ["Baseline model"],
      weaknesses: [],
      isBaseline: true,
    });
  }

  // Deterministic Validator Check
  const validation = ModelSelectionValidator.validate(decision, registry);
  assert(validation.isValid, "ModelSelectionValidator confirms decision is structurally valid", validation.errors);

  // 4. Test Downstream Flow: Verify Training Configuration receives and binds these fields without fallbacks
  console.log("\n[Step 5] Testing Downstream Training Configuration Contract Binding...");
  const downstreamState: any = {
    ...state,
    modelSelection: decision,
    problemType: decision.problem_type,
    primaryMetric: decision.primary_metric,
    direction: decision.direction,
    targetColumn: decision.target_entity?.name || targetCol,
    status: "running",
  };

  const trainingConfigResult = await TrainingConfigurationAgent.execute(
    downstreamState,
    mockServices
  );

  const contractConfig = trainingConfigResult.configuration;
  console.log("\nSynthesized Contract Verification:");
  console.log("   x-primary-metric-name:              ", contractConfig["x-primary-metric-name"]);
  console.log("   objective.optimization_metric:      ", contractConfig.objective?.optimization_metric);
  console.log("   objective.direction:                ", contractConfig.objective?.direction);
  console.log("   evaluation.primary_metric:          ", contractConfig.evaluation?.primary_metric);
  console.log("   evaluation.secondary_metrics:       ", JSON.stringify(contractConfig.evaluation?.secondary_metrics));
  console.log("   task.task_type:                     ", contractConfig.task?.task_type);

  assert(
    contractConfig["x-primary-metric-name"] === decision.primary_metric,
    `Training contract x-primary-metric-name matches modelSelection.primary_metric ("${decision.primary_metric}")`
  );
  assert(
    contractConfig.objective?.optimization_metric === decision.primary_metric,
    `Training contract objective.optimization_metric matches modelSelection.primary_metric ("${decision.primary_metric}")`
  );
  assert(
    contractConfig.objective?.direction === decision.direction,
    `Training contract objective.direction matches modelSelection.direction ("${decision.direction}")`
  );
  assert(
    contractConfig.evaluation?.primary_metric === decision.primary_metric,
    `Training contract evaluation.primary_metric matches modelSelection.primary_metric ("${decision.primary_metric}")`
  );
  assert(
    contractConfig.task?.task_type === decision.task_type || contractConfig.task?.task_type === decision.problem_type,
    `Training contract task.task_type matches modelSelection ("${contractConfig.task?.task_type}")`
  );

  console.log("\n=================================================");
  if (allPassed) {
    console.log(" ALL TESTS PASSED: Model Selection and Training Configuration operate with NO FALLBACKS.");
  } else {
    console.error(" TESTS FAILED: One or more assertions did not pass.");
  }
  console.log("=================================================\n");

  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  pool.end();
  process.exit(1);
});
