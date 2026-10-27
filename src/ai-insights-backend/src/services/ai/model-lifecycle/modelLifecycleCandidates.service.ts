import { ProjectService } from "../../project/project.service";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export interface ModelLifecycleCandidatesService {
  getValidationCandidates(projectId: string): Promise<{
    projectId: string;
    candidates: Array<Record<string, unknown>>;
    trainingReportSummary: string | null;
    championModelId: string | null;
  }>;
}

export class ModelLifecycleCandidateService implements ModelLifecycleCandidatesService {
  constructor(private readonly projectService: ProjectService) {}

  async getValidationCandidates(projectId: string) {
    if (!projectId.trim()) {
      throw new Error("A project ID is required to list trained model candidates.");
    }
    const project = await this.projectService.getById(projectId.trim());
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    const state = asRecord(project.agentState);
    const training = asRecord(asRecord(state.modelLifecycle).training);
    const candidates = Array.isArray(training.candidates)
      ? training.candidates
          .map((candidate) => asRecord(candidate))
          .filter((candidate) => candidate.status === "Completed")
          .map((candidate) => ({
            model_id: candidate.modelId,
            displayName: candidate.modelId,
            status: candidate.status,
            score: asRecord(candidate.metrics).score,
            metrics: candidate.metrics,
            qualityAssessment: candidate.qualityAssessment,
          }))
      : [];
    const requestedChampionModelId = typeof training.championCandidateId === "string"
      ? training.championCandidateId
      : null;
    const championModelId = candidates.some(
      (candidate) => candidate.model_id === requestedChampionModelId
    )
      ? requestedChampionModelId
      : null;

    return {
      projectId: project.id,
      candidates,
      trainingReportSummary: typeof training.summary === "string" ? training.summary : null,
      championModelId,
    };
  }
}
