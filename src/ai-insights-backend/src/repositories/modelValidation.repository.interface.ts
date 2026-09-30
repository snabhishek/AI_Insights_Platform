import { ModelValidationReport, CandidateModelValidationRun } from "../agents/ModelTrainingValidation/ModelValidation/types";

export interface IModelValidationRepository {
  saveValidationRun(
    runId: string,
    projectId: string,
    report: ModelValidationReport,
    validationDirectory: string,
    predictionsArtifactPath?: string
  ): Promise<void>;

  getValidationRun(runId: string): Promise<any | null>;

  getLatestValidationRunByProject(projectId: string): Promise<any | null>;

  listValidationRunsByProject(projectId: string): Promise<any[]>;
}
