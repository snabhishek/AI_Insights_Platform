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

    // 1. Structural Validation: status enum
    const validStatuses = ["READY", "NEEDS_CLARIFICATION", "UNSUPPORTED", "INVALID_DATA"];
    if (!validStatuses.includes(decision.status)) {
      errors.push(`Invalid decision status: "${decision.status}". Must be one of: ${validStatuses.join(", ")}`);
    }

    // If status is not READY, detailed candidates might be omitted
    if (decision.status !== "READY") {
      return { isValid: errors.length === 0, errors };
    }

    // 2. Target Entity & Grain validation
    if (!decision.target_entity || typeof decision.target_entity !== "object") {
      errors.push("Missing required field: target_entity");
    }

    if (!decision.prediction_grain || typeof decision.prediction_grain !== "object") {
      errors.push("Missing required field: prediction_grain");
    }

    // 3. Recommended Model Validation
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

    // 4. Candidates List Validation
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

        // Check duplicates
        if (seenIds.has(id)) {
          errors.push(`Duplicate candidate model_id detected: "${id}"`);
        }
        seenIds.add(id);

        // Check registry existence
        if (!registry.isModelSupported(id)) {
          errors.push(`Candidate model_id "${id}" does not exist in Model Capability Registry`);
        }

        // Check score range
        if (
          typeof candidate.suitability_score !== "number" ||
          candidate.suitability_score < 0 ||
          candidate.suitability_score > 1
        ) {
          errors.push(
            `Candidate "${id}" suitability_score must be between 0 and 1, received: ${candidate.suitability_score}`
          );
        }

        // Check rank uniqueness and sequential order starting at 1
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

        // Check recommendation type enum
        if (candidate.recommendation !== "primary" && candidate.recommendation !== "alternative") {
          errors.push(
            `Candidate "${id}" recommendation must be "primary" or "alternative", received: "${candidate.recommendation}"`
          );
        }
      });

      // Exactly one candidate must be primary
      const primaryCandidates = decision.candidates.filter((c) => c.recommendation === "primary");
      if (primaryCandidates.length !== 1) {
        errors.push(`Exactly one candidate must have recommendation "primary", found: ${primaryCandidates.length}`);
      }

      // The primary candidate must match recommended_model.model_id
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

    // 5. Baseline model validation
    const baselineId = decision.training?.baseline_model;
    if (baselineId && typeof baselineId === "string" && baselineId.trim().length > 0) {
      if (!registry.isModelSupported(baselineId)) {
        errors.push(`baseline_model "${baselineId}" does not exist in Model Capability Registry`);
      }
    }

    // 6. Confidence score validation
    if (decision.confidence) {
      if (
        typeof decision.confidence.score !== "number" ||
        decision.confidence.score < 0 ||
        decision.confidence.score > 1
      ) {
        errors.push(`confidence.score must be between 0 and 1, received: ${decision.confidence?.score}`);
      }
    }

    // 7. Models array validation
    if (Array.isArray(decision.models)) {
      decision.models.forEach((m, idx) => {
        if (!m.model_id) {
          errors.push(`models array element at index ${idx} is missing model_id`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
