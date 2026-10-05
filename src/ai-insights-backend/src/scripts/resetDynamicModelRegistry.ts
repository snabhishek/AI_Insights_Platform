import { query } from "../db";

async function resetDynamicModelRegistry() {
  console.log("[ResetScript] Starting one-time dynamic model registry database reset...");
  try {
    const result = await query(`DELETE FROM dynamic_model_registry;`);
    console.log(`[ResetScript] Successfully cleared legacy models from dynamic_model_registry (${result.rowCount || 0} rows removed).`);
    console.log("[ResetScript] Dynamic Model Registry is now empty and ready for dynamic web exploration.");
  } catch (err: any) {
    console.error("[ResetScript] Error resetting dynamic_model_registry:", err?.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

resetDynamicModelRegistry();
