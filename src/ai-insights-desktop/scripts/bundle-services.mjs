import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const targetResourcesDir = path.resolve(desktopRoot, "src-tauri/resources");

console.log("[Bundler] Preparing internal local services for desktop distribution...");

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const element of fs.readdirSync(from)) {
    const srcPath = path.join(from, element);
    const destPath = path.join(to, element);
    const stat = fs.lstatSync(srcPath);
    if (stat.isDirectory()) {
      if (element === "node_modules" || element === ".venv" || element === "__pycache__" || element === ".git" || element === "data") {
        continue;
      }
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFlatMarkdownFiles(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    if (entry.isDirectory()) {
      copyFlatMarkdownFiles(srcPath, dest);
    } else if (entry.name.endsWith(".md")) {
      fs.copyFileSync(srcPath, path.join(dest, entry.name));
    }
  }
}

function copyNonTestCjsScripts(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase();
      if (lower === "test" || lower === "tests" || lower === "__tests__" || lower.includes("test")) {
        continue;
      }
      copyNonTestCjsScripts(srcPath, destPath);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (entry.name.endsWith(".cjs") && !lower.includes("test") && !lower.includes("spec")) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// Ensure clean resources structure
const backendDest = path.join(targetResourcesDir, "services/backend");
const scriptsDest = path.join(targetResourcesDir, "scripts");

fs.mkdirSync(backendDest, { recursive: true });
fs.mkdirSync(scriptsDest, { recursive: true });

// 0. Bundle Portable Node.js binary so host machines don't strictly require pre-installed Node.js
const binDest = path.join(targetResourcesDir, "bin");
fs.mkdirSync(binDest, { recursive: true });
if (process.execPath && fs.existsSync(process.execPath)) {
  const nodeDest = path.join(binDest, "node.exe");
  if (!fs.existsSync(nodeDest) || fs.statSync(nodeDest).size !== fs.statSync(process.execPath).size) {
    console.log(`[Bundler] Bundling standalone Node.js binary from ${process.execPath}...`);
    fs.copyFileSync(process.execPath, nodeDest);
  }
  console.log(`✓ Standalone Node.js binary packaged at resources/bin/node.exe`);
}

// 1. Bundle Backend
const backendSrc = path.resolve(repoRoot, "src/ai-insights-backend");
console.log(`[Bundler] Copying backend dist & migrations from ${backendSrc}...`);
if (fs.existsSync(path.join(backendSrc, "dist"))) {
  copyFolderSync(path.join(backendSrc, "dist"), path.join(backendDest, "dist"));
}
if (fs.existsSync(path.join(backendSrc, "src/db/migrations"))) {
  copyFolderSync(path.join(backendSrc, "src/db/migrations"), path.join(backendDest, "dist/db/migrations"));
}

// Copy all folders present in backend src into distribution
const backendSrcDir = path.join(backendSrc, "src");
if (fs.existsSync(backendSrcDir)) {
  console.log(`[Bundler] Copying all backend src folders into distribution...`);
  copyFolderSync(backendSrcDir, path.join(backendDest, "src"));
  console.log(`✓ All backend src folders bundled into distribution.`);
}
const promptsSrc = path.join(backendSrc, "src/agents/prompts");
if (fs.existsSync(promptsSrc)) {
  console.log(`[Bundler] Packaging agent prompts into backend distribution...`);
  copyFolderSync(promptsSrc, path.join(backendDest, "dist/agents/prompts"));
  copyFolderSync(promptsSrc, path.join(backendDest, "dist/prompts"));
  copyFolderSync(promptsSrc, path.join(backendDest, "prompts"));
  copyFolderSync(promptsSrc, path.join(backendDest, "src/agents/prompts"));

  copyFlatMarkdownFiles(promptsSrc, path.join(backendDest, "dist/agents/prompts"));
  copyFlatMarkdownFiles(promptsSrc, path.join(backendDest, "dist/prompts"));
  copyFlatMarkdownFiles(promptsSrc, path.join(backendDest, "prompts"));
  copyFlatMarkdownFiles(promptsSrc, path.join(backendDest, "src/agents/prompts"));
  console.log(`✓ Agent prompts bundled (hierarchical + flat) into backend distribution.`);
}
for (const file of ["package.json", "package-lock.json", ".env.example"]) {
  const p = path.join(backendSrc, file);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(backendDest, file));
  }
}
// Explicitly DO NOT bundle .env into installer resources
const bundledEnv = path.join(backendDest, ".env");
if (fs.existsSync(bundledEnv)) {
  fs.unlinkSync(bundledEnv);
  console.log(`✓ Purged existing .env from backend distribution (environment will be created on demand at install time).`);
}


const backendScriptsSrc = path.join(backendSrc, "scripts");
if (fs.existsSync(backendScriptsSrc)) {
  const destScripts = path.join(backendDest, "scripts");
  const destDistScripts = path.join(backendDest, "dist/scripts");
  if (fs.existsSync(destScripts)) fs.rmSync(destScripts, { recursive: true, force: true });
  if (fs.existsSync(destDistScripts)) fs.rmSync(destDistScripts, { recursive: true, force: true });

  copyNonTestCjsScripts(backendScriptsSrc, destScripts);
  copyNonTestCjsScripts(backendScriptsSrc, destDistScripts);
  console.log(`✓ Non-test backend scripts and .cjs files bundled into distribution.`);
}

// Clean up any uncompressed node_modules folder in backendDest so it is never bundled loose into NSIS
const bundledLooseModules = path.join(backendDest, "node_modules");
if (fs.existsSync(bundledLooseModules)) {
  console.log(`[Bundler] Removing loose node_modules directory from resources to avoid duplicate bundling...`);
  fs.rmSync(bundledLooseModules, { recursive: true, force: true });
}

const archivePathGz = path.join(backendDest, "node_modules.tar.gz");
const archivePathTar = path.join(backendDest, "node_modules.tar");
if (fs.existsSync(archivePathTar)) {
  try { fs.unlinkSync(archivePathTar); } catch (_) {}
}

const backendSrcNodeModules = path.join(backendSrc, "node_modules");
let isArchiveValid = false;

if (fs.existsSync(archivePathGz) && fs.statSync(archivePathGz).size > 20000000) {
  try {
    execSync(`tar -tzf "${archivePathGz}" node_modules/@langchain/core/dist/callbacks/manager.cjs`, { stdio: "ignore" });
    isArchiveValid = true;
    console.log(`[Bundler] Backend node_modules.tar.gz verified healthy (${(fs.statSync(archivePathGz).size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (_) {
    console.warn(`[Bundler] Detected corrupted or incomplete node_modules.tar.gz. Removing...`);
    try { fs.unlinkSync(archivePathGz); } catch (_) {}
  }
}

if (!isArchiveValid && fs.existsSync(backendSrcNodeModules)) {
  console.log(`[Bundler] Archiving compressed node_modules.tar.gz from ${backendSrc}...`);
  const tempArchive = archivePathGz + ".tmp";
  try {
    if (fs.existsSync(tempArchive)) fs.unlinkSync(tempArchive);
    execSync(`tar -czf "${tempArchive}" -C "${backendSrc}" node_modules`, {
      stdio: "inherit",
      shell: true,
    });
    // Verify before renaming
    execSync(`tar -tzf "${tempArchive}" node_modules/@langchain/core/dist/callbacks/manager.cjs`, { stdio: "ignore" });
    if (fs.existsSync(archivePathGz)) fs.unlinkSync(archivePathGz);
    fs.renameSync(tempArchive, archivePathGz);
    console.log(`✓ Archived and verified backend node_modules.tar.gz successfully (${(fs.statSync(archivePathGz).size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (err) {
    console.warn(`[Bundler] Warning: Direct tar.gz archiving failed:`, err.message);
    if (fs.existsSync(tempArchive)) try { fs.unlinkSync(tempArchive); } catch (_) {}
  }
}

// 2. Bundle Python Service
const pythonSrc = path.resolve(repoRoot, "src/ai-insights-service");
console.log(`[Bundler] Building standalone Python service from ${pythonSrc}...`);
execSync("node scripts/build-python-service.mjs", {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: true,
});

// 3. Bundle Setup & Diagnostic Scripts
console.log(`[Bundler] Copying setup scripts...`);
for (const scriptFile of ["setup-deps.ps1", "setup-search-tools.cjs"]) {
  const src = path.resolve(desktopRoot, "scripts", scriptFile);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(scriptsDest, scriptFile));
    console.log(`✓ Bundled setup script: ${scriptFile}`);
  }
}

// 4. Bundle Docker Compose services & initialization scripts
console.log(`[Bundler] Copying Docker Compose resources...`);
const dockerSrc = path.resolve(desktopRoot, "docker");
const dockerDest = path.join(targetResourcesDir, "docker");
if (fs.existsSync(dockerSrc)) {
  copyFolderSync(dockerSrc, dockerDest);
  console.log(`✓ Unified Docker Compose and init scripts bundled into resources/docker.`);
}

console.log("[Bundler] Internal local services bundled successfully!");
