import { ModelCapabilityRegistry } from "./modelCapabilityRegistry";
import { ModelSelectionDecision } from "../../../models/modelSelection.types";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class ModelSelectionValidator {
  public static validate(
    decision: ModelSelectionDecision,
    registry: ModelCapabilityRegistry
  ): ValidationResult {
    const errors: string[] = [];

    if (!decision) {
      return { isValid: false, errors: ["Decision object is missing or null"] };
    }

    const validStatuses = ["READY", "NEEDS_CLARIFICATION", "UNSUPPORTED", "INVALID_DATA"];
    if (!validStatuses.includes(decision.status)) {
      errors.push(`Invalid decision status: "${decision.status}". Must be one of: ${validStatuses.join(", ")}`);
    }

    if (decision.status !== "READY") {
      return { isValid: errors.length === 0, errors };
    }

    if (!decision.problem_type || typeof decision.problem_type !== "string" || !decision.problem_type.trim()) {
      errors.push("Missing required field: problem_type");
    }
    if (!decision.task_type || typeof decision.task_type !== "string" || !decision.task_type.trim()) {
      errors.push("Missing required field: task_type");
    }
    if (!decision.task_subtype || typeof decision.task_subtype !== "string" || !decision.task_subtype.trim()) {
      errors.push("Missing required field: task_subtype");
    }
    if (!decision.prediction_type || typeof decision.prediction_type !== "string" || !decision.prediction_type.trim()) {
      errors.push("Missing required field: prediction_type");
    }
    if (!decision.primary_metric || typeof decision.primary_metric !== "string" || !decision.primary_metric.trim()) {
      errors.push("Missing required field: primary_metric");
    }
    if (!decision.direction || !["maximize", "minimize"].includes(decision.direction.toLowerCase())) {
      errors.push(`Invalid or missing direction: "${decision.direction}". Must be "maximize" or "minimize"`);
    }
    if (!Array.isArray(decision.secondary_metrics) || decision.secondary_metrics.length === 0) {
      errors.push("Missing required field: secondary_metrics (must contain at least one metric)");
    }

    if (!decision.target_entity || typeof decision.target_entity !== "object") {
      errors.push("Missing required field: target_entity");
    } else {
      if (!decision.target_entity.name) errors.push("target_entity.name is required");
      if (!decision.target_entity.datatype) errors.push("target_entity.datatype is required");
      if (!decision.target_entity.description) errors.push("target_entity.description is required");
    }

    if (!decision.prediction_grain || typeof decision.prediction_grain !== "object") {
      errors.push("Missing required field: prediction_grain");
    } else {
      if (!decision.prediction_grain.entity) errors.push("prediction_grain.entity is required");
    }

    if (!decision.recommended_model || !decision.recommended_model.model_id) {
      errors.push("Missing required field: recommended_model with valid model_id when status is READY");
    } else {
      const rec = decision.recommended_model;
      if (typeof rec.suitability_score !== "number" || rec.suitability_score < 0 || rec.suitability_score > 1) {
        errors.push(`recommended_model suitability_score must be between 0 and 1, received: ${rec.suitability_score}`);
      }
      if (rec.recommendation !== "primary") {
        errors.push(`recommended_model recommendation field must be "primary", received: "${rec.recommendation}"`);
      }
      if (!registry.isModelSupported(rec.model_id)) {
        errors.push(`recommended_model "${rec.model_id}" does not exist in the Model Capability Registry`);
      }
    }

    if (!Array.isArray(decision.candidates) || decision.candidates.length === 0) {
      errors.push("Candidates list must contain at least one candidate when status is READY");
    } else {
      const seenIds = new Set<string>();
      const seenRanks = new Set<number>();
      let previousRank = 0;

      decision.candidates.forEach((candidate, index) => {
        const id = candidate.model_id?.toLowerCase().trim();
        if (!id) {
          errors.push(`Candidate at index ${index} is missing model_id`);
          return;
        }

        if (seenIds.has(id)) {
          errors.push(`Duplicate candidate model_id detected: "${id}"`);
        }
        seenIds.add(id);

        if (!candidate.framework) {
          errors.push(`Candidate "${id}" is missing required field: framework`);
        }
        if (!candidate.algorithm) {
          errors.push(`Candidate "${id}" is missing required field: algorithm`);
        }
        if (!candidate.reasoning || !candidate.reasoning.strengths || !candidate.reasoning.weaknesses || !candidate.reasoning.suitability) {
          errors.push(`Candidate "${id}" is missing required reasoning fields (strengths, weaknesses, suitability)`);
        }

        if (!registry.isModelSupported(id)) {
          errors.push(`Candidate model_id "${id}" does not exist in Model Capability Registry`);
        }

        if (
          typeof candidate.suitability_score !== "number" ||
          candidate.suitability_score < 0 ||
          candidate.suitability_score > 1
        ) {
          errors.push(
            `Candidate "${id}" suitability_score must be between 0 and 1, received: ${candidate.suitability_score}`
          );
        }

        if (typeof candidate.rank !== "number") {
          errors.push(`Candidate "${id}" rank must be a number`);
        } else {
          if (seenRanks.has(candidate.rank)) {
            errors.push(`Duplicate rank detected: ${candidate.rank}`);
          }
          seenRanks.add(candidate.rank);

          if (candidate.rank !== previousRank + 1) {
            errors.push(
              `Candidate ranks must be sequential starting at 1. Expected ${previousRank + 1}, found ${candidate.rank}`
            );
          }
          previousRank = candidate.rank;
        }

        if (candidate.recommendation !== "primary" && candidate.recommendation !== "alternative") {
          if (candidate.recommendation === "baseline") {
            candidate.recommendation = "alternative";
          } else {
            errors.push(
              `Candidate "${id}" recommendation must be "primary" or "alternative", received: "${candidate.recommendation}"`
            );
          }
        }

        if (candidate.source_type && candidate.source_type !== "external" && candidate.source_type !== "builtin") {
          errors.push(`Candidate "${id}" source_type must be "external" or "builtin", received: "${candidate.source_type}"`);
        }
      });

      const primaryCandidates = decision.candidates.filter((c) => c.recommendation === "primary");
      if (primaryCandidates.length !== 1) {
        errors.push(`Exactly one candidate must have recommendation "primary", found: ${primaryCandidates.length}`);
      }

      if (decision.recommended_model?.model_id && primaryCandidates.length === 1) {
        if (
          primaryCandidates[0].model_id.toLowerCase().trim() !==
          decision.recommended_model.model_id.toLowerCase().trim()
        ) {
          errors.push(
            `recommended_model.model_id ("${decision.recommended_model.model_id}") does not match the candidate marked as primary ("${primaryCandidates[0].model_id}")`
          );
        }
      }
    }

    if (!decision.training || typeof decision.training !== "object") {
      errors.push("Missing required field: training");
    } else {
      if (!decision.training.mode) errors.push("training.mode is required");
      const baselineId = decision.training.baseline_model;
      if (!baselineId) {
        errors.push("training.baseline_model is required");
      } else if (!registry.isModelSupported(baselineId)) {
        errors.push(`baseline_model "${baselineId}" does not exist in Model Capability Registry`);
      }
    }

    if (!Array.isArray(decision.featureRequirements) || decision.featureRequirements.length === 0) {
      errors.push("Missing required field: featureRequirements (must contain at least one requirement)");
    } else {
      decision.featureRequirements.forEach((fr, idx) => {
        if (!fr.feature || !fr.requirement || !fr.reason || !fr.priority) {
          errors.push(`featureRequirements[${idx}] missing required fields (feature, requirement, reason, priority)`);
        }
      });
    }

    if (!decision.hyperparameterOptimization || typeof decision.hyperparameterOptimization !== "object") {
      errors.push("Missing required field: hyperparameterOptimization");
    } else {
      if (!decision.hyperparameterOptimization.approach) {
        errors.push("hyperparameterOptimization.approach is required");
      }
      if (!decision.hyperparameterOptimization.rationale) {
        errors.push("hyperparameterOptimization.rationale is required");
      }
    }

    if (!decision.confidence || typeof decision.confidence !== "object") {
      errors.push("Missing required field: confidence");
    } else {
      if (
        typeof decision.confidence.score !== "number" ||
        decision.confidence.score < 0 ||
        decision.confidence.score > 1
      ) {
        errors.push(`confidence.score must be a number between 0 and 1, received: ${decision.confidence?.score}`);
      }
      if (!decision.confidence.rationale) {
        errors.push("confidence.rationale is required");
      }
    }

    if (Array.isArray(decision.models)) {
      decision.models.forEach((m, idx) => {
        if (!m.model_id) {
          errors.push(`models array element at index ${idx} is missing model_id`);
        }
        if (!m.framework) {
          errors.push(`models array element at index ${idx} is missing framework`);
        }
        if (!m.algorithm) {
          errors.push(`models array element at index ${idx} is missing algorithm`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
