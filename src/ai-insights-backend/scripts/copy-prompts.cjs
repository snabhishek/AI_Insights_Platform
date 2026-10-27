const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(__dirname, "../src/agents/prompts");
const destDistAgents = path.resolve(__dirname, "../dist/agents/prompts");
const destDistPrompts = path.resolve(__dirname, "../dist/prompts");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
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

if (fs.existsSync(source)) {
  console.log(`[Build] Copying agent prompts from ${source}...`);

  // 1. Copy nested directory structure to dist/agents/prompts and dist/prompts
  copyRecursive(source, destDistAgents);
  copyRecursive(source, destDistPrompts);

  // 2. Also copy all markdown files flat into dist/agents/prompts and dist/prompts
  //    so lookups for either "queryResolver.md" or "query-resolver/queryResolver.md" both resolve instantly.
  copyFlatMarkdownFiles(source, destDistAgents);
  copyFlatMarkdownFiles(source, destDistPrompts);

  console.log(`✓ Agent prompts copied (hierarchical + flat) to dist/agents/prompts and dist/prompts successfully.`);
} else {
  console.warn(`[Build] Warning: Source prompts directory not found at ${source}`);
}

// 3. Ensure all non-test folders and non-test .cjs files from scripts/ are copied into dist/scripts
const scriptsRoot = path.resolve(__dirname, ".");
const scriptsDist = path.resolve(__dirname, "../dist/scripts");

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

copyNonTestCjsScripts(scriptsRoot, scriptsDist);
console.log(`✓ Non-test .cjs scripts from scripts/ copied to dist/scripts.`);

// 4. Ensure all non-TS assets from all src/ folders are copied to dist/
const fullSrc = path.resolve(__dirname, "../src");
const fullDist = path.resolve(__dirname, "../dist");

function copyNonTsAssets(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyNonTsAssets(srcPath, destPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".ts" && ext !== ".tsx") {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

copyNonTsAssets(fullSrc, fullDist);
console.log(`✓ All non-TS assets from src folders mirrored into dist.`);
