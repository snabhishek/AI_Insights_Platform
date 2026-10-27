import type { SupportedChatModel } from "../../utils/agentUtils";
import { createStatelessSubagentTool } from "../../ModelLifecycle/memory/statelessSubagent";
import { webSearchTool, extractUrlContentTool } from "../search";

export function createLifecycleSubagentTool(model: SupportedChatModel) {
  return createStatelessSubagentTool(model, [webSearchTool, extractUrlContentTool]);
}
