import { AgentState } from "../state";
import { extractSchema } from "./schemaExtractors";
import { inferRelationshipsWithLLM } from "./llmInferencer";

export async function inspectorNode(state: AgentState): Promise<Partial<AgentState>> {
  const { connectors } = state;
  if (!connectors || connectors.length === 0) {
    return { errors: ["No connectors provided in state"] };
  }

  const sourceStructureFiles: string[] = [];
  const llmInferredRelationshipsFiles: string[] = [];
  const errors: string[] = [];

  for (const connector of connectors) {
    try {
      // 1. Deterministic Extraction
      const schemaFilePath = await extractSchema(connector);
      sourceStructureFiles.push(schemaFilePath);

      // 2. LLM Inference for Relationships
      const llmFilePath = await inferRelationshipsWithLLM(schemaFilePath);
      llmInferredRelationshipsFiles.push(llmFilePath);
    } catch (err: any) {
      errors.push(`Failed inspector on connector ${connector.id}: ${err.message}`);
    }
  }

  return {
    sourceStructureFiles: [...(state.sourceStructureFiles || []), ...sourceStructureFiles],
    llmInferredRelationshipsFiles: [...(state.llmInferredRelationshipsFiles || []), ...llmInferredRelationshipsFiles],
    errors: [...(state.errors || []), ...errors],
  };
}
