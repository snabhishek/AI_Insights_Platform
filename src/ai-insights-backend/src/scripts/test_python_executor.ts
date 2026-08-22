import { executePythonScript } from "../agents/tools/helpers/pythonExecutor";
import { IngestionServices } from "../agents/state";

async function runTest() {
  const projectId = "test-project";
  const runTimestamp = `${Date.now()}`;

  // Simple python program that requires --db-path and imports yaml (PyYAML)
  const pythonCode = `import argparse\nimport yaml\n\nparser = argparse.ArgumentParser()\nparser.add_argument('--db-path', required=True)\nargs = parser.parse_args()\nprint('DB_PATH=' + args.db_path)\nprint('YAML_OK' if hasattr(yaml, 'safe_load') else 'YAML_FAIL')\n`;

  // Minimal mock services object; provide a connectorService.getById that returns a CSV connector
  const services = ({
    connectorService: {
      getById: async (id: string) => {
        return {
          id,
          type: "csv",
          connectionConfig: {
            fileName: "sample_data",
          },
        };
      },
    },
    connectionTester: {},
    fileService: {},
    projectService: {},
    traceHelper: {},
    projectId: projectId,
  } as unknown) as IngestionServices;
  console.log("Running python executor test...");

  const result = await executePythonScript(
    "test_exec.py",
    pythonCode,
    projectId,
    runTimestamp,
    services,
    ["test-connector"]
  );

  console.log("Execution success:", result.success);
  console.log("Stdout:\n", result.stdout);
  console.log("Stderr:\n", result.stderr);

  if (!result.success) {
    console.error("Test failed: script did not complete successfully.");
    process.exit(2);
  }

  if (!result.stdout.includes("DB_PATH=") || !result.stdout.includes("YAML_OK")) {
    console.error("Test failed: unexpected stdout.");
    process.exit(3);
  }

  console.log("Test passed: Python executed and PyYAML available.");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
