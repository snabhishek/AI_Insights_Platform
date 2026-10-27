import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const serviceDir = path.resolve(repoRoot, "src/ai-insights-service");
const pythonServiceDir = path.resolve(
  desktopRoot,
  "src-tauri/resources/services/python-service",
);
const buildEnvDir = path.join(serviceDir, ".build-venv");
const windows = process.platform === "win32";
const venvPython = path.join(
  buildEnvDir,
  windows ? "Scripts/python.exe" : "bin/python",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: serviceDir,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function findPython() {
  const candidates =
    process.env.PYTHON ?
      [[process.env.PYTHON, []]] :
      windows ?
        [["py", ["-3"]], ["python", []]] :
        [["python3", []], ["python", []]];

  for (const [command, prefixArgs] of candidates) {
    const result = spawnSync(command, [...prefixArgs, "--version"], {
      cwd: serviceDir,
      stdio: "ignore",
    });
    if (!result.error && result.status === 0) {
      return { command, prefixArgs };
    }
  }

  throw new Error(
    "Python 3 is required on the build machine to package the bundled service. Set PYTHON to its executable.",
  );
}

const python = findPython();
if (!fs.existsSync(venvPython)) {
  console.log("[Python Builder] Creating an isolated build environment...");
  run(python.command, [
    ...python.prefixArgs,
    "-m",
    "venv",
    buildEnvDir,
  ]);
}

console.log("[Python Builder] Installing service and packaging dependencies...");
run(venvPython, [
  "-m",
  "pip",
  "install",
  "-r",
  "requirements.txt",
  "-r",
  "build-requirements.txt",
]);

fs.mkdirSync(pythonServiceDir, { recursive: true });

const binaryName = `ai-insights-service${windows ? ".exe" : ""}`;
console.log("[Python Builder] Packaging the FastAPI service as a standalone executable...");
run(venvPython, [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name",
  "ai-insights-service",
  "--distpath",
  pythonServiceDir,
  "--workpath",
  path.join(buildEnvDir, "pyinstaller-work"),
  "--specpath",
  path.join(buildEnvDir, "pyinstaller-spec"),
  "--collect-submodules",
  "app",
  "--collect-all",
  "uvicorn",
  "desktop_entry.py",
]);

if (!fs.existsSync(path.join(pythonServiceDir, binaryName))) {
  throw new Error(`PyInstaller did not produce ${binaryName}.`);
}
console.log(`[Python Builder] Standalone service created at ${path.join(pythonServiceDir, binaryName)}`);
