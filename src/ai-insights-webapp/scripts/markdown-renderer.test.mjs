import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual TSX renderer without adding a separate test framework.
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, ".next"), { recursive: true });
const temporaryDirectory = await mkdtemp(path.join(root, ".next", "markdown-test-"));
let MarkdownRenderer;
try {
  const source = await readFile(path.join(root, "app/components/shared/MarkdownRenderer.tsx"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const compiledPath = path.join(temporaryDirectory, "MarkdownRenderer.mjs");
  await writeFile(compiledPath, outputText);
  MarkdownRenderer = (await import(pathToFileURL(compiledPath).href)).default;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function render(content) {
  return renderToStaticMarkup(React.createElement(MarkdownRenderer, { content }));
}

test("renders Sparrow inventory formulas and their inline variable definitions", () => {
  const content = String.raw`#### A. Mathematical Translation to Inventory Targets

- **Safety Stock (SS) Formula:** $$SS = Z \cdot \sqrt{L \cdot \sigma_d^2 + d^2 \cdot \sigma_L^2}$$ *Where:*
  - $Z$: Service level factor (e.g., $Z = 1.65$ for $95\%$ fill rate target).
  - $L$: Average lead time (supplier production + transit).
  - $\sigma_d$: Standard deviation of forecast error.
  - $d$: Mean daily demand forecast over the lead time.
  - $\sigma_L$: Standard deviation of supplier lead time variability.
- **Reorder Point (ROP):** $$ROP = (d \cdot L) + SS$$`;
  const html = render(content);
  assert.equal((html.match(/class="katex"/g) || []).length, 9);
  assert.match(html, /<msqrt>/);
  assert.match(html, /<msubsup>/);
  assert.match(html, /<h4/);
  assert.match(html, /<strong[^>]*>Reorder Point/);
  assert.match(html, /Standard deviation of forecast error/);
  assert.doesNotMatch(html, /katex-error|Copy code/);
});

test("renders standalone display math and accessible MathML", () => {
  const html = render(String.raw`$$
ROP = (d \cdot L) + SS
$$`);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /<math[^>]*display="block"/);
  assert.match(html, /encoding="application\/x-tex"/);
  assert.doesNotMatch(html, /Copy code/);
});

test("renders fenced math rather than routing it to the code renderer", () => {
  const html = render("```math\nSS = Z \\cdot \\sigma_d\n```");
  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /Copy code/);
});

test("preserves literal formulas inside inline and fenced code", () => {
  const html = render('`$Z$`\n\n```text\n$$SS = \\sqrt{L}$$\n```');
  assert.match(html, /\$Z\$/);
  assert.match(html, /\$\$SS = \\sqrt\{L\}\$\$/);
  assert.match(html, /Copy code/);
  assert.doesNotMatch(html, /class="katex"/);
});

test("keeps invalid LaTeX and surrounding text visible", () => {
  const html = render(String.raw`Before $\frac{1}{$ after.`);
  assert.match(html, /katex-error/);
  assert.match(html, /\\frac\{1\}\{/);
  assert.match(html, /Before/);
  assert.match(html, /after\./);
});

test("keeps incomplete streamed equations readable until their delimiter arrives", () => {
  const unfinished = render(String.raw`Safety stock: $SS = \sqrt{L}`);
  assert.match(unfinished, /Safety stock:/);
  assert.doesNotMatch(unfinished, /class="katex"/);
  const finished = render(String.raw`Safety stock: $SS = \sqrt{L}$`);
  assert.match(finished, /class="katex"/);
  assert.match(finished, /<msqrt>/);
});

test("retains Markdown tables, links, and escaped currency", () => {
  const html = render(String.raw`| Metric | Formula |
| --- | --- |
| ROP | $d \cdot L + SS$ |

[Reference](https://example.com)

Prices: \$10 and \$20.`);
  assert.match(html, /<table/);
  assert.match(html, /class="katex"/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /Prices: \$10 and \$20/);
});

test("does not enable trusted HTML commands in agent math", () => {
  const html = render(String.raw`$\href{javascript:alert(1)}{click}$`);
  assert.doesNotMatch(html, /href="javascript:/);
});
