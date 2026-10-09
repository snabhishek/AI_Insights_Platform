import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../state";
import { logMilestoneThinking } from "../../utils/agentUtils";
import { relationshipBuilderNode } from "./RelationshipBuilder/relationshipBuilderNode";
import { formBuilderNode } from "./FormBuilder/formBuilderNode";
import { PipelineStepStatus } from "../../pipelineNames";

export async function hierarchyMapperNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (services?.isCancelled?.() || services?.abortSignal?.aborted) {
    console.info(`[Workflow] hierarchyMapperNode skipping execution because workflow is stopped/paused.`);
    return { status: "Stopped" };
  }

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Executing Hierarchy Mapper process (Relationship Builder -> Form Builder)..."
  );

  const relResult = await relationshipBuilderNode(state, config);

  const updatedState: typeof AgentState.State = {
    ...state,
    relationshipBuilder: relResult.relationshipBuilder as unknown as Record<string, unknown>,
    summary: relResult.summary,
    status: relResult.status as PipelineStepStatus,
  };

  const formResult = await formBuilderNode(updatedState, config);

  const combinedOutput = {
    relationshipBuilder: relResult.relationshipBuilder,
    formBuilder: formResult.formBuilder,
  };

  const activeRunTimestamp = state.runTimestamp || (services as any)?.runTimestamp || "";

  return {
    runTimestamp: activeRunTimestamp,
    hierarchyMapperNode: combinedOutput as Record<string, unknown>,
    status: "In-Progress" as const,
    summary: `Hierarchy Mapper completed: ${relResult.summary} ${formResult.summary}`,
    steps: [
      { name: "Hierarchy Mapper", status: "Completed" as const, summary: "Relationship Builder & Form Builder execution completed" },
    ],
    stageOutputs: {
      hierarchyMapperNode: {
        ...combinedOutput,
        relationshipBuilder: relResult.relationshipBuilder,
        formBuilder: formResult.formBuilder,
      },
    },
    stageStatuses: {
      hierarchyMapperNode: "Completed",
    },
  };
}
