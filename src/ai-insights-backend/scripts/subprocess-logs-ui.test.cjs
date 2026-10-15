const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const inspection = [{ time: "07:38 PM", text: 'Querying schema tables list for connector "Carrier"...', done: true }];
    inspection.push(...Array.from({ length: 80 }, (_, index) => ({ time: "07:38 PM", text: `Inspection progress ${index}`, done: true })));
    const hierarchy = [{ time: "07:40 PM", text: "Hierarchy mapper discovered dimensional relationships", done: true }];
    let phase = "running";
    const requests = [];
    const state = () => ({ status: phase === "running" ? "In-Progress" : phase === "stopped" ? "Stopped" : "Completed",
      currentNode: "inspect", currentStage: "inspect",
      stageStatuses: {
        dataIngestion: { status: "In-Progress", inspect: phase === "running" || phase === "stopped" ? "In-Progress" : "Completed", profileData: "Pending", resolveSchema: "Pending" },
        featureEngineering: { status: "Pending", hierarchyMapperNode: phase === "running" || phase === "stopped" ? "Pending" : "Completed", featureArchitectNode: "Pending", featureValidatorNode: "Pending", exogenous: "Pending" },
        modelTrainingValidation: { status: "Pending", modelSelectionNode: "Pending", trainingConfigurationNode: "Pending", preFlightNode: "Pending", modelTrainingCodeNode: "Pending" },
      },
      // A stale client snapshot must never supply another subprocess's log window.
      agentThinking: { inspect: inspection, hierarchyMapperNode: inspection },
    });
    const project = () => ({ id: "logs-ui-p1", name: "Log Isolation", projectName: "Log Isolation", role: "OWNER",
      dataSources: [], tags: [], initials: "LI", workspaceId: "default", createdAt: new Date().toISOString(), agentState: state() });
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes("/_next/")) return route.continue();
      const url = new URL(request.url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/projects")) data = [project()];
      if (url.pathname.endsWith("/projects/logs-ui-p1")) data = project();
      if (url.pathname.endsWith("/ai/active")) data = { success: true, data: null };
      if (url.pathname.endsWith("/ai/thinking")) {
        const identity = Object.fromEntries(url.searchParams);
        requests.push(identity);
        data = { success: true, data: { thinking: identity.substep === "Data Inspection" ? inspection : phase === "with-logs" ? hierarchy : [] } };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const openWorkflow = async () => {
      await page.getByText("Log Isolation", { exact: true }).first().click();
      await page.getByRole("button", { name: "Workflow", exact: true }).click();
      await page.getByRole("button", { name: "View execution logs for Data Inspection", exact: true }).waitFor();
    };
    await page.goto(process.env.WEBAPP_URL || "http://localhost:3000");
    await openWorkflow();
    const inspectionButton = page.getByRole("button", { name: "View execution logs for Data Inspection", exact: true });
    const hierarchyButton = page.getByRole("button", { name: "View execution logs for Hierarchy Mapper", exact: true });
    await page.waitForFunction(() => !document.querySelector('button[aria-label="View execution logs for Data Inspection"]').disabled);
    assert.equal(await hierarchyButton.isDisabled(), true);
    await inspectionButton.click();
    await page.getByText(inspection[0].text, { exact: true }).waitFor();
    const logStream = page.locator(".subprocess-log-scroll");
    await page.waitForFunction(() => {
      const stream = document.querySelector(".subprocess-log-scroll");
      return stream.scrollHeight > stream.clientHeight && stream.scrollHeight - stream.scrollTop - stream.clientHeight < 2;
    });
    assert.equal(await logStream.evaluate(stream => getComputedStyle(stream).scrollbarWidth), "thin");
    await logStream.evaluate(stream => { stream.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector(".subprocess-log-scroll").scrollTop === 0);
    const nextPoll = page.waitForResponse(response => response.url().includes("substep=Data%20Inspection"));
    inspection.push({ time: "07:39 PM", text: "New inspection line while reading earlier logs", done: true });
    await nextPoll;
    await page.getByText("New inspection line while reading earlier logs", { exact: true }).waitFor();
    assert.equal(await logStream.evaluate(stream => stream.scrollTop), 0, "New logs must preserve the position when reading earlier lines");
    await logStream.evaluate(stream => { stream.scrollTop = stream.scrollHeight; });
    const followingPoll = page.waitForResponse(response => response.url().includes("substep=Data%20Inspection"));
    inspection.push({ time: "07:39 PM", text: "Latest inspection line at bottom", done: true });
    await followingPoll;
    await page.getByText("Latest inspection line at bottom", { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const stream = document.querySelector(".subprocess-log-scroll");
      return stream.scrollHeight - stream.scrollTop - stream.clientHeight < 2;
    });
    assert.equal(await page.getByText("Sub-processes:", { exact: true }).count(), 0);
    assert.ok(requests.every(request => request.projectId === "logs-ui-p1" && request.pipeline === "Data Ingestion" && request.substep === "Data Inspection"));
    await page.getByTitle("Close (Esc)", { exact: true }).click();

    phase = "completed-empty";
    await page.reload();
    await openWorkflow();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="View execution logs for Hierarchy Mapper"]').disabled);
    await inspectionButton.click();
    await page.getByText(inspection[0].text, { exact: true }).waitFor();
    await page.getByTitle("Close (Esc)", { exact: true }).click();
    const emptyResponse = page.waitForResponse(response => response.url().includes("substep=Hierarchy%20Mapper"));
    await hierarchyButton.click();
    await emptyResponse;
    await page.getByText("No execution logs recorded yet.", { exact: true }).waitFor();
    assert.equal(await page.getByText(inspection[0].text, { exact: true }).count(), 0);
    assert.deepEqual(requests.at(-1), { projectId: "logs-ui-p1", pipeline: "Feature Engineering", substep: "Hierarchy Mapper" });
    await page.getByTitle("Close (Esc)", { exact: true }).click();

    phase = "with-logs";
    await hierarchyButton.click();
    await page.getByText(hierarchy[0].text, { exact: true }).waitFor();
    assert.equal(await page.getByText(inspection[0].text, { exact: true }).count(), 0);
    await page.getByTitle("Close (Esc)", { exact: true }).click();
    phase = "stopped";
    await page.reload();
    await openWorkflow();
    assert.equal(await inspectionButton.isDisabled(), true);
    assert.equal(await hierarchyButton.isDisabled(), true);
    console.log("Verified running/completed button access, disabled pending/stopped processes, isolated logs, empty results, and removal of subprocess filters.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
