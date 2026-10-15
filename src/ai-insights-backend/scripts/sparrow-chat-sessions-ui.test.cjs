const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// Exercise the real chat page with isolated storage and project-scoped API fixtures.
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const warnings = [];
    page.on("console", message => {
      if (/same key|unique.*key/i.test(message.text())) warnings.push(message.text());
    });
    const id = "session-6837fe15-51b6-4611-9bc3-452727e0bb42";
    const now = new Date().toISOString();
    const alpha = { id, projectId: "ui-p1", projectName: "Alpha Project", title: "Alpha conversation",
      createdAt: now, updatedAt: now, agentPersona: "orchestrator",
      messages: [{ id: "ui-u1", role: "user", content: "Alpha question", timestamp: "12:00 PM" },
        { id: "ui-a1", role: "assistant", content: "Alpha transcript", timestamp: "12:00 PM", status: "complete" }] };
    const beta = { ...alpha, projectId: "ui-p2", projectName: "Beta Project", title: "Beta conversation",
      messages: [{ ...alpha.messages[0], content: "Beta question" }, { ...alpha.messages[1], content: "Beta transcript" }] };
    let database = [alpha, beta];
    let historyLoads = 0;
    const messageRequests = [];
    await page.addInitScript(({ alpha, beta }) => {
      if (!localStorage.getItem("ai_insights_chat_sessions_v1")) {
        localStorage.setItem("ai_insights_chat_sessions_v1", JSON.stringify([alpha, beta, alpha]));
        localStorage.setItem("ai_insights_active_session_id_v1", alpha.id);
      }
      localStorage.setItem("activeWorkspaceId", "default");
    }, { alpha, beta });
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes("/_next/")) return route.continue();
      const url = new URL(request.url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/projects")) data = [alpha, beta].map(session => ({ id: session.projectId,
        name: session.projectName, projectName: session.projectName, role: "OWNER", dataSources: [],
        initials: "QA", workspaceId: "default", createdAt: now }));
      if (url.pathname.endsWith("/chat/sessions/import")) data = { success: true };
      if (url.pathname.endsWith("/chat/sessions")) {
        historyLoads++;
        data = { success: true, data: database };
      }
      if (/\/chat\/sessions\/[^/]+$/.test(url.pathname)) {
        const sessionId = decodeURIComponent(url.pathname.split("/").pop());
        if (request.method() === "PATCH") {
          const { projectId, metadata } = request.postDataJSON();
          const existing = database.find(session => session.projectId === projectId && session.id === sessionId);
          if (existing) Object.assign(existing, metadata);
          else database.push({ ...alpha, ...metadata, projectId, id: sessionId, messages: [] });
        }
        if (request.method() === "DELETE") database = database.filter(session =>
          session.id !== sessionId || session.projectId !== url.searchParams.get("projectId"));
        data = { success: true };
      }
      if (url.pathname.endsWith("/chat/message")) {
        const body = request.postDataJSON();
        messageRequests.push(body);
        const response = { id: body.messageId, role: "assistant", content: body.chatMode === "expert" ? "Expert Beta answer" : body.chatMode === "fast" ? "Fast Beta answer" : "Beta-only answer",
          status: "complete", thinking: [], chatMode: body.chatMode };
        const target = database.find(session => session.projectId === body.projectId && session.id === body.conversationId);
        target.messages.push({ id: body.userMessageId, role: "user", content: body.userQuery, timestamp: "12:00 PM" }, response);
        data = { success: true, data: response };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(process.env.WEBAPP_URL || "http://localhost:3000");
    await page.getByText("Alpha Project", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "AI Agent Chat", exact: true }).click();
    await page.getByText("Beta conversation", { exact: true }).waitFor();
    await page.getByText("Beta conversation", { exact: true }).click();
    await page.getByText("Beta transcript", { exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
      console.error("Duplicate-key warnings:", warnings);
      console.error("Chat body:", (await page.locator("body").innerText()).slice(-2500));
      console.error("Active fixture selection:", await page.evaluate(() => localStorage.getItem("ai_insights_active_session_key_v2")));
      throw error;
    });
    assert.deepEqual(warnings, [], "Entering chat must not render duplicate keys");
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.getByText("Alpha Project", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "AI Agent Chat", exact: true }).click();
      await page.getByText("Beta transcript", { exact: true }).waitFor();
      assert.equal(await page.getByText("Alpha conversation", { exact: true }).count(), 1);
      assert.equal(await page.getByText("Beta conversation", { exact: true }).count(), 1);
    }
    await page.reload();
    await page.getByRole("button", { name: "AI Agent Chat", exact: true }).click();
    await page.getByText("Beta transcript", { exact: true }).waitFor();
    assert.ok(historyLoads >= 5, "Each entry must load the scoped database history");
    const betaRow = page.locator("div.group.relative").filter({ has: page.getByText("Beta conversation", { exact: true }) });
    await betaRow.getByRole("button", { name: "Conversation options" }).click();
    await betaRow.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("div.group.relative input").fill("Renamed Beta conversation");
    await page.locator("div.group.relative input").press("Enter");
    await page.getByText("Renamed Beta conversation", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alpha conversation", { exact: true }).count(), 1);
    await page.getByPlaceholder("Ask anything, @ to mention, / for actions").fill("Continue Beta only");
    await page.getByPlaceholder("Ask anything, @ to mention, / for actions").press("Enter");
    await page.getByText("Beta-only answer", { exact: true }).waitFor();
    assert.equal(messageRequests[0].projectId, "ui-p2");
    assert.equal(messageRequests[0].conversationId, id, "Send the raw conversation ID to the backend, not its UI key");
    assert.equal(messageRequests[0].chatMode, undefined, "A mode is optional and must not be inferred");
    const modeButton = page.getByRole("button", { name: "Response mode", exact: true });
    assert.equal(await modeButton.innerText(), "Response mode");
    for (const [label, mode, answer] of [["Expert", "expert", "Expert Beta answer"], ["Fast", "fast", "Fast Beta answer"]]) {
      await modeButton.click();
      await page.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
      await page.getByPlaceholder("Ask anything, @ to mention, / for actions").fill(`Use ${label} for Beta`);
      await page.getByPlaceholder("Ask anything, @ to mention, / for actions").press("Enter");
      await page.getByText(answer, { exact: true }).waitFor();
      assert.equal(messageRequests.at(-1).chatMode, mode);
      await page.reload();
      await page.getByRole("button", { name: "AI Agent Chat", exact: true }).click();
      await page.getByText(answer, { exact: true }).waitFor();
      assert.equal(await modeButton.innerText(), label, "Reload must restore the conversation's selected mode");
    }
    await page.getByText("Alpha conversation", { exact: true }).click();
    await page.getByText("Alpha transcript", { exact: true }).waitFor();
    assert.equal(await modeButton.innerText(), "Response mode", "Switching conversations must not leak response modes");
    assert.equal(await page.getByText("Beta-only answer", { exact: true }).count(), 0);
    await page.getByText("Renamed Beta conversation", { exact: true }).click();
    assert.equal(await modeButton.innerText(), "Fast");
    const renamedRow = page.locator("div.group.relative").filter({ has: page.getByText("Renamed Beta conversation", { exact: true }) });
    await renamedRow.getByRole("button", { name: "Conversation options" }).click();
    await renamedRow.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByText("Alpha transcript", { exact: true }).waitFor();
    assert.equal(database.filter(session => session.id === id).length, 1, "Delete must leave the other project's conversation intact");

    await page.getByRole("button", { name: "New AI Conversation", exact: true }).click();
    await page.getByText("New AI Inquiry", { exact: true }).waitFor();
    const readCache = () => page.evaluate(() => JSON.parse(localStorage.getItem("ai_insights_chat_sessions_v1")));
    const beforeSwitch = await readCache();
    const emptyAlpha = beforeSwitch.find(session => session.projectId === "ui-p1" && session.messages.length === 0);
    assert.ok(emptyAlpha);
    await page.getByRole("button", { name: "Alpha Project", exact: true }).click();
    await page.getByRole("button", { name: "Beta Project", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai_insights_active_session_key_v2"))[0] === "ui-p2");
    const afterSwitch = await readCache();
    const emptyBeta = afterSwitch.find(session => session.projectId === "ui-p2" && session.messages.length === 0);
    assert.ok(emptyBeta);
    assert.notEqual(emptyAlpha.id, emptyBeta.id, "Switching projects must create a new conversation even if the previous one is empty");
    assert.ok(afterSwitch.some(session => session.projectId === "ui-p1" && session.id === emptyAlpha.id));
    assert.deepEqual(warnings, [], "Repeated navigation and reload must not produce duplicate keys");
    console.log("Verified project-scoped selection, repeated navigation, reload, rename, response updates, deletion, and empty-conversation project switching without duplicate keys.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
