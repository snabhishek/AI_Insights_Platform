const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let project = {
      id: "project-edit-ui", name: "Edit Lifecycle", projectName: "Edit Lifecycle", useCase: "Forecast regional demand.",
      role: "OWNER", workspaceId: "default", dataSources: ["edit-source"], tags: [], initials: "EL",
      domain: "Manufacturing", subDomain: "HVAC", createdAt: "2026-10-15T00:00:00Z",
      agentState: { status: "Completed" },
    };
    let updates = [];
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes("/_next/")) return route.continue();
      const url = new URL(request.url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/domains")) data = [{ id: "manufacturing", domain: "Manufacturing", subDomains: ["HVAC"] }];
      if (url.pathname.endsWith("/connectors")) data = [{ id: "edit-source", name: "Demand Source", type: "postgres", subtext: "Regional demand", status: "Connected" }];
      if (url.pathname.endsWith("/projects")) data = [project];
      if (url.pathname.endsWith("/projects/project-edit-ui")) {
        if (request.method() === "PUT") {
          updates.push(request.postDataJSON());
          project = { ...project, ...request.postDataJSON() };
        }
        data = project;
      }
      if (url.pathname.endsWith("/ai/active")) data = { success: true, data: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const nextProjectPoll = () => page.waitForResponse(response => response.url().endsWith("/projects/project-edit-ui") && response.request().method() === "GET");
    const nameInput = page.getByPlaceholder("e.g., Q4 Retail Analysis, Customer Risk Model...");
    const titleInput = page.getByPlaceholder("e.g., Demand Forecasting, Predictive Maintenance, Customer Churn Analytics...");

    await page.goto(process.env.WEBAPP_URL || "http://localhost:3000");
    await page.getByText("Edit Lifecycle", { exact: true }).first().click();
    await page.getByRole("button", { name: "Project Detail", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await nameInput.fill("Unsaved project draft");
    await titleInput.fill("Unsaved use case title");
    project = { ...project, name: "Updated server title" };
    for (let poll = 0; poll < 2; poll++) {
      await nextProjectPoll();
      await page.waitForTimeout(100);
      assert.equal(await nameInput.isEnabled(), true, "Background hydration must not exit edit mode");
      assert.equal(await nameInput.inputValue(), "Unsaved project draft", "Background hydration must preserve the draft");
      assert.equal(await titleInput.inputValue(), "Unsaved use case title");
      assert.equal(await page.getByRole("button", { name: "Save Changes", exact: true }).isVisible(), true);
    }

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    assert.equal(await nameInput.isDisabled(), true);
    assert.equal(await nameInput.inputValue(), "Edit Lifecycle");
    assert.equal(await titleInput.inputValue(), "Updated server title", "Cancel must restore the latest persisted values");

    project = { ...project, name: "Read-only refresh" };
    await nextProjectPoll();
    await page.waitForFunction(() => document.querySelector('input[placeholder="e.g., Demand Forecasting, Predictive Maintenance, Customer Churn Analytics..."]').value === "Read-only refresh");
    assert.equal(await titleInput.isDisabled(), true);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await nameInput.fill("Saved project draft");
    await titleInput.fill("Saved use case title");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].projectName, "Saved project draft");
    assert.equal(updates[0].name, "Saved use case title");
    assert.equal(await nameInput.isDisabled(), true);
    assert.equal(await nameInput.inputValue(), "Saved project draft");
    assert.equal(await titleInput.inputValue(), "Saved use case title");
    console.log("Verified editing survives repeated background refreshes, Cancel restores current server values, read-only fields refresh, and Save submits the draft.");
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
