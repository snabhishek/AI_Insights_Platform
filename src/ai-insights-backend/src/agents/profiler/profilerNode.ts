import { AgentState } from "../state";
import { profileData } from "./dataProfilers";
import { classifyColumnsWithLLM } from "./profilingLLM";

export async function profilerNode(state: AgentState): Promise<Partial<AgentState>> {
  const { connectors, sourceStructureFiles } = state;
  if (!connectors || connectors.length === 0) {
    return { errors: ["No connectors provided in state for profiling"] };
  }
  if (!sourceStructureFiles || sourceStructureFiles.length !== connectors.length) {
    return { errors: ["Mismatch between connectors and sourceStructureFiles"] };
  }

  const profilingDataFiles: string[] = [];
  const errors: string[] = [];

  // Assuming connectors and sourceStructureFiles are aligned by index
  for (let i = 0; i < connectors.length; i++) {
    const connector = connectors[i];
    const schemaFile = sourceStructureFiles[i];

    try {
      // 1. Database Sampling and Profiling (using safe mode by default)
      const profilingFilePath = await profileData(connector, schemaFile, "safe");
      
      // 2. LLM Classification based on Profiling Sample
      const classificationFilePath = await classifyColumnsWithLLM(profilingFilePath);
      
      profilingDataFiles.push(classificationFilePath); // Storing the final classified JSON path
    } catch (err: any) {
      errors.push(`Failed profiler on connector ${connector.id}: ${err.message}`);
    }
  }

  return {
    profilingDataFiles: [...(state.profilingDataFiles || []), ...profilingDataFiles],
    errors: [...(state.errors || []), ...errors],
  };
}
