import {
  saveModularTrainingConfigContract,
} from "../../tools/helpers/schemaHelper";

export class ContractPersistence {
  /**
   * Reads existing training job contract, merges the newly synthesized configuration,
   * preserves the model_selection section, and writes to the run schemas folder using the
   * standard modular schema persistence function from schemaHelper.
   */
  public static async saveModularTrainingConfigContract(
    workspaceName: string,
    projectName: string,
    synthesizedConfig: Record<string, any>,
    runTimestamp?: string
  ): Promise<{ contractPath: string }> {
    return saveModularTrainingConfigContract(
      workspaceName,
      projectName,
      synthesizedConfig,
      runTimestamp
    );
  }
}
