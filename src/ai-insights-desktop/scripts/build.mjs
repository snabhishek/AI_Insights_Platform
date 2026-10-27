import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const distDesktop = path.resolve(repoRoot, "dist-desktop");

console.log("\n============================================================");
console.log("            Compass - Reusable Desktop Builder              ");
console.log("============================================================\n");

function runCommand(cmd, cwd, env = {}) {
  console.log(`\n[Builder] Running: ${cmd} (in ${cwd})`);
  execSync(cmd, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true,
  });
}

try {
  // Step 1: Pre-build validation
  console.log("[Step 1/5] Validating environment...");
  const tauriCheck = spawnSync("cargo", ["--version"]);
  if (tauriCheck.status !== 0) {
    throw new Error("Rust/Cargo is required to build the Tauri desktop application.");
  }
  console.log("✓ Rust toolchain ready.");

  // Step 2: Build frontend static export
  console.log("\n[Step 2/5] Building Next.js Webapp (Static Export)...");
  const webappDir = path.resolve(repoRoot, "src/ai-insights-webapp");
  runCommand("npm run build", webappDir, { TAURI_BUILD: "true" });

  const webappOut = path.resolve(webappDir, "out");
  if (!fs.existsSync(path.join(webappOut, "index.html"))) {
    throw new Error(`Frontend static export failed; ${webappOut}/index.html not found.`);
  }
  console.log("✓ Frontend statically exported to out/.");

  // Step 3: Build backend TypeScript
  console.log("\n[Step 3/5] Building Backend Service (TypeScript)...");
  const backendDir = path.resolve(repoRoot, "src/ai-insights-backend");
  runCommand("npm run build", backendDir);
  console.log("✓ Backend built to dist/.");

  // Step 4: Bundle internal local services
  console.log("\n[Step 4/5] Bundling internal local services into resources...");
  runCommand("node scripts/bundle-services.mjs", desktopRoot);

  // Clean old installer bundles before building
  const nsisDir = path.resolve(desktopRoot, "src-tauri/target/release/bundle/nsis");
  if (fs.existsSync(nsisDir)) {
    for (const file of fs.readdirSync(nsisDir)) {
      if (file.endsWith(".exe")) {
        try { fs.unlinkSync(path.join(nsisDir, file)); } catch (_) {}
      }
    }
  }

  // Step 5: Run Tauri Build to create Desktop Application and Installer
  console.log("\n[Step 5/5] Building Tauri Desktop Binary & NSIS Installer...");
  runCommand("npx -y @tauri-apps/cli build --bundles nsis", desktopRoot);

  // Discover and copy generated installer to dist-desktop
  fs.mkdirSync(distDesktop, { recursive: true });

  let installerFound = null;
  if (fs.existsSync(nsisDir)) {
    const files = fs.readdirSync(nsisDir).filter(f => f.endsWith(".exe"));
    // Sort newest first
    files.sort((a, b) => {
      const aStat = fs.statSync(path.join(nsisDir, a));
      const bStat = fs.statSync(path.join(nsisDir, b));
      return bStat.mtimeMs - aStat.mtimeMs;
    });
    if (files.length > 0) {
      const srcExe = path.join(nsisDir, files[0]);
      const destExe = path.join(distDesktop, files[0]);
      fs.copyFileSync(srcExe, destExe);
      installerFound = destExe;
    }
  }

  console.log("\n============================================================");
  console.log("   🎉 DESKTOP BUILD & INSTALLER PACKAGING SUCCEEDED!        ");
  console.log("============================================================");
  if (installerFound) {
    const stat = fs.statSync(installerFound);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    console.log(`\nInstaller generated at:`);
    console.log(`-> ${installerFound} (${sizeMb} MB)`);
  } else {
    console.log(`\nBuild completed! Check src-tauri/target/release/ for binaries.`);
  }
  console.log("============================================================\n");
} catch (error) {
  console.error("\n❌ Desktop Build Failed:", error.message || error);
  process.exit(1);
}
