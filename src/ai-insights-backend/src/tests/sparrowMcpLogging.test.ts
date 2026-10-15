import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMcpFilesystemTools, closeMcpClientForDirectory } from "../agents/tools/filesystem/mcpFilesystemClient";

test("MCP wrapper timestamps diagnostic lines while preserving protocol bytes", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparrow-mcp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, "fixture.cjs");
  fs.writeFileSync(fixture, "process.stdin.on('data', chunk => process.stdout.write(chunk)); process.stderr.write('first\\nsecond');");
  const child = spawn(process.execPath, [path.resolve("scripts/mcp-filesystem-runner.cjs"), fixture], { windowsHide: true });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("close", () => resolve()); });
  const protocol = '{"jsonrpc":"2.0","id":1,"result":{"text":"unchanged"}}\n';
  child.stdin.end(protocol); await closed;
  assert.equal(stdout, protocol);
  const lines = stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 2); assert.ok(lines.every(line => /^\[\d{4}-\d{2}-\d{2}T.*Z\] \[MCP Filesystem\]/.test(line)));
});

test("real MCP filesystem tool still reads project artifacts through timestamp wrapper", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparrow-mcp-protocol-"));
  t.after(async () => { await closeMcpClientForDirectory(root); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, "contract.txt"); fs.writeFileSync(source, "MODEL_CONTRACT_VERIFIED");
  const tools = await getMcpFilesystemTools({ folderPath: root, allowedDirectories: [root] });
  const read = tools.find(tool => tool.name.endsWith("read_text_file")) || tools.find(tool => tool.name.endsWith("read_file"));
  assert.ok(read); assert.match(JSON.stringify(await read.invoke({ path: source })), /MODEL_CONTRACT_VERIFIED/);
});
