import { cp, mkdir } from "fs/promises";
import { resolve } from "path";

// Executed after tsc; ship Sparrow's single prompt sources in dist-only builds.
async function main() {
  const root = resolve(__dirname, "../..");
  for (const folder of ["query-resolver", "analysis-planner", "insights-responder", "orchestrator"]) {
    const destination = resolve(root, "dist/agents/prompts", folder);
    await mkdir(destination, { recursive: true });
    await cp(resolve(root, "src/agents/prompts", folder), destination, { recursive: true });
  }
}
main().catch((error) => { console.error("Sparrow prompt packaging failed:", error); process.exitCode = 1; });
