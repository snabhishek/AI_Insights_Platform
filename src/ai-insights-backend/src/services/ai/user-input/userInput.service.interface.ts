import { UserInputSubmission, GenericUserInputResult } from "../../../schemas/userInput.schema";

export interface IUserInputService {
  submitInput(
    projectId: string,
    submission: UserInputSubmission
  ): Promise<GenericUserInputResult>;

  getInputs(projectId: string): Promise<Record<string, unknown>>;
}
