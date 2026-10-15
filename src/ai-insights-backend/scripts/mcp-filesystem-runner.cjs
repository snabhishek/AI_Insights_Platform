// Preserve MCP stdin/stdout byte-for-byte; only diagnostic stderr is timestamped.
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const [serverScript, ...directories] = process.argv.slice(2);
const child = spawn(process.execPath, [serverScript, ...directories], {
  stdio: ["inherit", "inherit", "pipe"], windowsHide: true,
});
const log = line => console.error(`[${new Date().toISOString()}] [MCP Filesystem] ${line}`);
createInterface({ input: child.stderr }).on("line", log);
child.on("error", error => { log(error.message); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
