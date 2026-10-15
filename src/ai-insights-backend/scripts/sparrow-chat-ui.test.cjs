const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

// Run against the local webapp with isolated HTTP fixtures and browser storage.

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on("pageerror", error => console.log("Browser error:", error.message));
    page.on("console", message => { if (message.type() === "error") console.log("Browser console:", message.text()); });
    const base = Date.now();
    let now = base;
    let requests = [];
    let completed = false;
    const interaction = { id: "clarification-ui-1", requestedAt: new Date(base).toISOString(), expiresAt: new Date(base + 100000).toISOString(), status: "waiting" };
    const prompt = { question: "Which regions would you like me to compare?", missingField: "regions", options: ["North", "South"] };
    const pending = { id: "ui-a1", role: "assistant", content: prompt.question, timestamp: "11:41 PM", status: "awaiting_user_input",
      agentName: "Sparrow", agentBadge: "Insights Agent", clarification: prompt, interaction, serverClockOffset: 0,
      executionState: { projectId: "ui-p1", threadId: "ui-chat" } };
    const session = { id: "ui-chat", title: "Regional comparison", createdAt: new Date(base).toISOString(), updatedAt: new Date(base).toISOString(),
      projectId: "ui-p1", projectName: "Retail Demo", agentPersona: "orchestrator",
      messages: [{ id: "ui-u1", role: "user", content: "Compare revenue for selected regions", timestamp: "11:41 PM" }, pending] };
    await page.addInitScript(session => {
      if (!localStorage.getItem("ai_insights_chat_sessions_v1")) localStorage.setItem("ai_insights_chat_sessions_v1", JSON.stringify([session]));
      localStorage.setItem("ai_insights_active_session_id_v1", session.id);
      localStorage.setItem("activeWorkspaceId", "default");
    }, session);
    await page.route("**/*", async route => {
      if (!["fetch", "xhr"].includes(route.request().resourceType()) || route.request().url().includes("/_next/")) return route.continue();
      const url = new URL(route.request().url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/projects")) data = [{ id: "ui-p1", name: "Retail Demo", projectName: "Retail Demo", role: "OWNER", dataSources: [], initials: "RT", workspaceId: "default", createdAt: new Date(base).toISOString() }];
      if (url.pathname.endsWith("/chat/interaction")) data = { success: true, data: completed
        ? { status: "complete", content: "North and South comparison completed.", executionState: pending.executionState }
        : { status: "awaiting_user_input", clarification: prompt, interaction: { ...interaction, status: now >= base + 100000 ? "timed_out" : "waiting" }, serverNow: new Date(now).toISOString(), executionState: pending.executionState } };
      if (url.pathname.endsWith("/chat/message")) {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) data = { success: true, data: { status: "error", content: "Submission failed", error: "Temporary submission failure", thinking: [] } };
        else {
          completed = true;
          data = { success: true, data: { status: "complete", content: "North and South comparison completed.", thinking: [], executionState: pending.executionState } };
        }
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("http://localhost:3000");
    await page.getByText("Retail Demo", { exact: true }).first().waitFor().catch(async error => {
      console.log((await page.locator("body").innerText()).slice(-2200));
      await page.screenshot({ path: path.resolve(__dirname, "../../ai-insights-webapp/.next/sparrow-clarification-debug.png") });
      throw error;
    });
    await page.getByText("AI Agent Chat", { exact: true }).click();
    const input = page.getByRole("textbox", { name: prompt.question });
    await input.waitFor();
    assert.equal(await input.inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "Continue", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "North", exact: true }).click();
    assert.equal(await input.inputValue(), "North");
    await input.fill("North and South");
    await page.screenshot({ path: path.resolve(__dirname, "../../ai-insights-webapp/.next/sparrow-clarification.png") });
    await page.clock.install({ time: new Date(now) });
    now += 100001;
    await page.clock.fastForward(100001);
    await page.getByRole("button", { name: "Resume with answer" }).waitFor();
    await page.screenshot({ path: path.resolve(__dirname, "../../ai-insights-webapp/.next/sparrow-clarification-timeout.png") });
    await page.reload();
    await page.getByText("AI Agent Chat", { exact: true }).click();
    await page.getByRole("button", { name: "Resume with answer" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: prompt.question }).inputValue(), "North and South");
    await page.getByRole("button", { name: "Resume with answer" }).click();
    await page.getByRole("alert").filter({ hasText: "Temporary submission failure" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: prompt.question }).inputValue(), "North and South");
    await page.getByRole("button", { name: "Resume with answer" }).click();
    await page.getByText("North and South comparison completed.", { exact: true }).waitFor();
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.interactionId, interaction.id);
      assert.equal(request.conversationId, session.id);
      assert.equal(request.userQuery, "North and South");
    }
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai_insights_chat_sessions_v1")));
    assert.equal(stored[0].messages.length, 2);
    assert.equal(stored[0].messages[1].clarificationReplies[0].answer, "North and South");
    console.log("Verified inline choices, free-text editing, timeout, reload, failed submission and successful retry without a new message bubble.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
