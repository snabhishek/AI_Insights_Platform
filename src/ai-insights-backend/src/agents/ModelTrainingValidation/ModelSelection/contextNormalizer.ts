import {
  MLPredictionType,
  MLTaskSubtype,
  MLTaskType,
  ModelSelectionContext,
  PredictionGrainSpec,
  TargetEntitySpec,
} from "../../../models/modelSelection.types";

/**
 * Normalizes disparate upstream artifacts into a generic ModelSelectionContext.
 * Gracefully handles missing, partial, or evolving upstream schemas without hard-coding
 * assumptions about exact agent response shapes.
 *
 * NOTE: As specified, leakage findings are excluded from the normalization scope.
 */
export class ModelSelectionContextNormalizer {
  public static normalize(rawInput: any): ModelSelectionContext {
    const raw = rawInput || {};

    // 1. Business Context
    const businessContext = {
      useCase:
        raw.useCase ||
        raw.businessContext?.useCase ||
        raw.project?.useCase ||
        raw.userPrompt ||
        "",
      domain:
        raw.domain ||
        raw.businessContext?.domain ||
        raw.project?.domain ||
        "General",
      subDomain:
        raw.subDomain ||
        raw.businessContext?.subDomain ||
        raw.project?.subDomain ||
        "",
      predictionGoal:
        raw.predictionGoal ||
        raw.businessContext?.predictionGoal ||
        raw.useCase ||
        "",
      businessProblem:
        raw.businessProblem ||
        raw.businessContext?.businessProblem ||
        raw.useCase ||
        "",
      latencyConstraintMs:
        raw.latencyConstraintMs ||
        raw.businessContext?.latencyConstraintMs,
      interpretabilityPriority:
        raw.interpretabilityPriority ||
        raw.businessContext?.interpretabilityPriority ||
        "medium",
    };

    // 2. Data Context (resolve target, shape, columns from upstream state)
    const architect = raw.featureArchitect || raw.stageOutputs?.featureArchitect || {};
    const validator = raw.featureValidator || raw.stageOutputs?.featureValidator || architect.featureValidator || {};
    const inspection = raw.inspection || raw.stageOutputs?.inspection || {};
    const schemaResolution = raw.schemaResolution || raw.stageOutputs?.schemaResolution || {};

    const targetColumn =
      raw.targetColumn ||
      raw.dataContext?.targetColumn ||
      architect.targetColumn ||
      architect.orchestrationDecision?.targetColumn ||
      architect.finalOutput?.orchestrationDecision?.targetColumn ||
      "";

    const candidateTargets = Array.isArray(raw.candidateTargets)
      ? raw.candidateTargets
      : targetColumn
      ? [targetColumn]
      : [];

    const temporalColumn =
      raw.temporalColumn ||
      raw.dataContext?.temporalColumn ||
      architect.timeIndex ||
      architect.temporalColumn ||
      architect.orchestrationDecision?.timeColumn ||
      "";

    const rowCount =
      raw.rowCount ??
      raw.dataContext?.rowCount ??
      architect.rowCount ??
      inspection.rowCount ??
      validator.rowCount ??
      0;

    const columnCount =
      raw.columnCount ??
      raw.dataContext?.columnCount ??
      (Array.isArray(raw.columns) ? raw.columns.length : 0);

    const columns = Array.isArray(raw.columns)
      ? raw.columns
      : Array.isArray(raw.dataContext?.columns)
      ? raw.dataContext.columns
      : [];

    const dataContext = {
      rowCount,
      columnCount,
      targetColumn,
      candidateTargets,
      temporalColumn,
      dateGrain: raw.dateGrain || raw.dataContext?.dateGrain || architect.dateGrain || "daily",
      missingValueRate: raw.missingValueRate ?? raw.dataContext?.missingValueRate ?? 0,
      columns,
    };

    // 3. Feature Context
    const candidateFeatures: string[] =
      raw.featureContext?.candidateFeatures ||
      validator.validatedFeatureSet?.kept ||
      architect.features ||
      architect.selectedFeatures ||
      [];

    const categoricalFeatures: string[] =
      raw.featureContext?.categoricalFeatures ||
      architect.categoricalColumns ||
      architect.categoricalFeatures ||
      [];

    const numericalFeatures: string[] =
      raw.featureContext?.numericalFeatures ||
      architect.numericColumns ||
      architect.numericalFeatures ||
      [];

    const entityKeys: string[] =
      raw.featureContext?.entityKeys ||
      architect.entityKeys ||
      architect.groupKeys ||
      [];

    const featureContext = {
      candidateFeatures,
      categoricalFeatures,
      numericalFeatures,
      timeIndex: temporalColumn,
      entityKeys,
      engineeredFeatureTypes: architect.engineeredFeatureTypes || [],
      datasetPath: raw.datasetPath || raw.featureContext?.datasetPath,
    };

    // 4. Model Context (user preferences / exclusions)
    const modelContext = {
      preferredFrameworks: raw.preferredFrameworks || raw.modelContext?.preferredFrameworks || [],
      excludedModels: raw.excludedModels || raw.modelContext?.excludedModels || [],
      maxModelsToRank: raw.maxModelsToRank || raw.modelContext?.maxModelsToRank || 5,
    };

    // 5. Additional Context (preserve anything unmapped)
    const additionalContext = {
      ...(raw.additionalContext || {}),
      projectId: raw.projectId,
      datasetArtifact: raw.datasetArtifact,
    };

    return {
      businessContext,
      dataContext,
      featureContext,
      modelContext,
      additionalContext,
    };
  }

  /**
   * Deterministically infers ML task classification, target grain, and target entity specs
   * from the normalized context, which will be validated by the LLM and validator.
   */
  public static inferProblemSpecs(context: ModelSelectionContext): {
    targetEntity: TargetEntitySpec;
    predictionGrain: PredictionGrainSpec;
    task: MLTaskType;
    subtype: MLTaskSubtype;
    predictionType: MLPredictionType;
    derivation: string | null;
  } {
    const targetCol = context.dataContext.targetColumn || "";
    const useCaseLower = (context.businessContext.useCase || "").toLowerCase();
    const hasTimeCol = Boolean(context.dataContext.temporalColumn);
    const domainLower = (context.businessContext.domain || "").toLowerCase();

    // 1. Target Entity
    const entityName =
      context.featureContext.entityKeys?.[0] ||
      (targetCol.includes("_") ? targetCol.split("_")[0] : "record");

    const targetEntity: TargetEntitySpec = {
      name: targetCol || null,
      datatype: "numeric",
      description: `Prediction target: ${targetCol || "unspecified"}`,
      source: "upstream_features",
    };

    // 2. Grain
    const predictionGrain: PredictionGrainSpec = {
      entity: entityName,
      keys: context.featureContext.entityKeys || [],
      frequency: hasTimeCol ? context.dataContext.dateGrain || "daily" : null,
    };

    // 3. Task Inference
    let task: MLTaskType = "tabular_regression";
    let subtype: MLTaskSubtype = "standard_regression";
    let predictionType: MLPredictionType = "value";
    let derivation: string | null = null;

    const isClassificationName =
      /churn|attrition|fraud|default|convert|converted|clicked|status|flag|label|is_|has_/i.test(targetCol) ||
      /classification|churn|fraud|propensity/i.test(useCaseLower);

    const isForecasting =
      hasTimeCol &&
      (/forecast|demand|sales_forecast|inventory_demand|traffic|consumption/i.test(useCaseLower) ||
        /forecast/i.test(domainLower));

    if (isForecasting) {
      task = "time_series_forecasting";
      subtype = context.featureContext.entityKeys?.length ? "panel_forecasting" : "univariate_forecasting";
      predictionType = "point";
      derivation = `Aggregate historical observations across ${context.dataContext.dateGrain || "time interval"} horizons`;
    } else if (isClassificationName) {
      task = "tabular_classification";
      subtype = "binary_classification";
      predictionType = "probability";
      targetEntity.datatype = "boolean";
      derivation = `Binary indicator flag derived from entity behavior (${targetCol})`;
    } else {
      task = "tabular_regression";
      subtype = "standard_regression";
      predictionType = "value";
      targetEntity.datatype = "numeric";
      derivation = `Continuous response variable (${targetCol})`;
    }

    return {
      targetEntity,
      predictionGrain,
      task,
      subtype,
      predictionType,
      derivation,
    };
  }
}
