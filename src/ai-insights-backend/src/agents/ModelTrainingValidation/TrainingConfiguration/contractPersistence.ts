import {
  saveModularTrainingConfigContract,
} from "../../tools/helpers/schemaHelper";

export class ContractPersistence {

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
