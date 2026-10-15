import { MemorySaver } from "@langchain/langgraph";

let isPatched = false;

/**
 * Patch MemorySaver to ensure checkpoint_ns always defaults to "" (the default root checkpoint namespace).
 *
 * In @langchain/langgraph-checkpoint (e.g. v1.1.5), `MemorySaver.prototype.putWrites` checks:
 * `assertSafeStorageKey("checkpoint_ns", checkpointNamespace, { allowEmpty: true })`
 * without defaulting `checkpointNamespace` to `""` (unlike `put`, `getTuple`, and `getDeltaChannelHistory`).
 *
 * When `workflow.updateState()` or resume/retry/approve operations run, LangGraph internally
 * passes intermediate configs to `putWrites`. If `checkpoint_ns` is omitted or undefined,
 * MemorySaver throws:
 * "Invalid configurable value for key \"checkpoint_ns\": expected a string identifier (got undefined). This guard protects MemorySaver from prototype pollution."
 */
export function applyMemorySaverCheckpointPatch(): void {
  if (isPatched) return;
  isPatched = true;

  const origPutWrites = MemorySaver.prototype.putWrites;
  if (typeof origPutWrites === "function") {
    MemorySaver.prototype.putWrites = async function (config: any, writes: any, taskId: any) {
      let safeConfig = config;
      if (!safeConfig) {
        safeConfig = { configurable: { checkpoint_ns: "" } };
      } else if (!safeConfig.configurable) {
        safeConfig = { ...safeConfig, configurable: { checkpoint_ns: "" } };
      } else if (safeConfig.configurable.checkpoint_ns === undefined || safeConfig.configurable.checkpoint_ns === null) {
        safeConfig = {
          ...safeConfig,
          configurable: {
            ...safeConfig.configurable,
            checkpoint_ns: "",
          },
        };
      }
      return origPutWrites.call(this, safeConfig, writes, taskId);
    };
  }

  const origGetTuple = MemorySaver.prototype.getTuple;
  if (typeof origGetTuple === "function") {
    MemorySaver.prototype.getTuple = async function (config: any) {
      let safeConfig = config;
      if (!safeConfig) {
        safeConfig = { configurable: { checkpoint_ns: "" } };
      } else if (!safeConfig.configurable) {
        safeConfig = { ...safeConfig, configurable: { checkpoint_ns: "" } };
      } else if (safeConfig.configurable.checkpoint_ns === undefined || safeConfig.configurable.checkpoint_ns === null) {
        safeConfig = {
          ...safeConfig,
          configurable: {
            ...safeConfig.configurable,
            checkpoint_ns: "",
          },
        };
      }

      const tuple = await origGetTuple.call(this, safeConfig);
      if (tuple?.config?.configurable && (tuple.config.configurable.checkpoint_ns === undefined || tuple.config.configurable.checkpoint_ns === null)) {
        tuple.config.configurable.checkpoint_ns = "";
      }
      return tuple;
    };
  }
}

// Auto-apply when imported
applyMemorySaverCheckpointPatch();
