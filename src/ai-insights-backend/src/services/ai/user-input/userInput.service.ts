import { IUserInputService } from "./userInput.service.interface";
import { UserInputSubmission, GenericUserInputResult } from "../../../schemas/userInput.schema";
import { ProjectService } from "../../project/project.service";
import {
  determineActiveStepForInteraction,
  normalizeFlatStageStatuses,
} from "../../../agents/pipelineNames";
import { IModelSelectionService } from "../model-selection/modelSelection.service.interface";
import { ITrainingConfigService } from "../training-config/trainingConfig.service.interface";

export class UserInputService implements IUserInputService {
  constructor(
    private projectService: ProjectService,
    private modelSelectionService?: IModelSelectionService,
    private trainingConfigService?: ITrainingConfigService
  ) {}

  public async submitInput(
    projectId: string,
    submission: UserInputSubmission
  ): Promise<GenericUserInputResult> {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      const err: any = new Error(`Project "${projectId}" not found`);
      err.statusCode = 404;
      throw err;
    }

    const agentState = (project.agentState as Record<string, any>) || {};
    const flatStatuses = normalizeFlatStageStatuses(agentState.stageStatuses);

    const activeStep = determineActiveStepForInteraction(flatStatuses, "input");

    if (!activeStep) {
      const isCompleted = Object.values(flatStatuses).includes("Completed");
      const err: any = new Error(
        isCompleted
          ? "Cannot submit user input for a completed step."
          : "No workflow step is currently awaiting user input."
      );
      err.statusCode = isCompleted ? 409 : 400;
      throw err;
    }

    // Initialize userInputs container
    agentState.userInputs = agentState.userInputs || {};
    agentState.userInputs[activeStep] = agentState.userInputs[activeStep] || {};

    // Store generic input under the active step
    agentState.userInputs[activeStep][submission.inputType] = {
      payload: submission.payload,
      metadata: submission.metadata || {},
      updatedAt: new Date().toISOString(),
    };

    // Generic side-effect dispatches without changing step status
    if (
      Array.isArray(submission.payload.selectedModelIds) &&
      submission.payload.selectedModelIds.length > 0
    ) {
      agentState.selectedModels = submission.payload.selectedModelIds;
      if (this.modelSelectionService) {
        try {
          await this.modelSelectionService.recordUserSelectionByProject(
            projectId,
            submission.payload.selectedModelIds as string[]
          );
        } catch (err: any) {
          console.warn(
            `[UserInputService] Warning syncing model selection for project ${projectId}:`,
            err?.message || err
          );
        }
      }
    }

    const splitCandidate =
      submission.payload.splitEndDate || submission.payload.splitDate;
    if (typeof splitCandidate === "string" && splitCandidate.trim().length > 0) {
      const splitStr = splitCandidate.trim();
      agentState.splitDate = splitStr;
      agentState.splitEndDate = splitStr;
      if (this.trainingConfigService) {
        try {
          await this.trainingConfigService.syncSplitDate(
            projectId,
            splitStr,
            agentState.runTimestamp
          );
        } catch (err: any) {
          console.warn(
            `[UserInputService] Warning syncing split date for project ${projectId}:`,
            err?.message || err
          );
        }
      }
    }

    // Persist updated agentState to DB without changing stage statuses
    await this.projectService.updateAgentState(projectId, agentState);

    return {
      success: true,
      step: activeStep,
      data: agentState.userInputs[activeStep],
    };
  }

  public async getInputs(projectId: string): Promise<Record<string, unknown>> {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      const err: any = new Error(`Project "${projectId}" not found`);
      err.statusCode = 404;
      throw err;
    }
    const agentState = (project.agentState as Record<string, any>) || {};
    return agentState.userInputs || {};
  }
}
