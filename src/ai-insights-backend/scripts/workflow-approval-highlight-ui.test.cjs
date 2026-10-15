const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const scenarios = [
  { name: "ingestion stage approval", completedStage: "dataIngestion", completedModels: 0, nextStep: undefined, reviewTitle: null },
  { name: "feature stage approval", completedStage: "featureEngineering", completedModels: 0, nextStep: undefined, reviewTitle: null },
  { name: "model stage entry", completedStage: "featureEngineering", completedModels: 0, nextStep: "modelSelectionNode", reviewTitle: null },
  { name: "model selection review", completedStage: "modelTrainingValidation", completedModels: 1, nextStep: "trainingConfigurationNode", reviewTitle: "Model Selection", reviewButton: "Review Model Selection" },
  { name: "training configuration review", completedStage: "modelTrainingValidation", completedModels: 2, nextStep: "Pre Flight", reviewTitle: "Training Configuration", reviewButton: "Review Training Configuration" },
  { name: "preflight review", completedStage: "modelTrainingValidation", completedModels: 3, nextStep: "modelTrainingCodeNode", reviewTitle: "Pre Flight", reviewButton: "Review Pre-Flight Verification" },
  { name: "training code review", completedStage: "modelTrainingValidation", completedModels: 4, nextStep: "Model Validation", reviewTitle: "Model Training Code Generation", reviewButton: "Review Model Training Code" },
];

function agentState(scenario) {
  const ingestionApproval = scenario.completedStage === "dataIngestion";
  const featureApproval = scenario.completedStage === "featureEngineering";
  const modelSteps = ["modelSelectionNode", "trainingConfigurationNode", "preFlightNode", "modelTrainingCodeNode"];
  return {
    status: "Awaiting Approval",
    currentNode: ingestionApproval ? "resolveSchema" : featureApproval ? "exogenous" : modelSteps[scenario.completedModels - 1],
    nextStep: scenario.nextStep,
    stageStatuses: {
      dataIngestion: {
        status: ingestionApproval ? "Awaiting Approval" : "Completed",
        inspect: "Completed", profileData: "Completed", resolveSchema: "Completed",
      },
      featureEngineering: {
        status: ingestionApproval ? "Pending" : featureApproval ? "Awaiting Approval" : "Completed",
        hierarchyMapperNode: ingestionApproval ? "Pending" : "Completed",
        featureArchitectNode: ingestionApproval ? "Pending" : "Completed",
        featureValidatorNode: ingestionApproval ? "Pending" : "Completed",
        exogenous: ingestionApproval ? "Pending" : "Completed",
      },
      modelTrainingValidation: {
        status: ingestionApproval || featureApproval ? "Pending" : "Awaiting Approval",
        ...Object.fromEntries(modelSteps.map((step, index) => [step, index < scenario.completedModels ? "Completed" : "Pending"])),
      },
    },
  };
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let scenario = scenarios[0];
    const project = () => ({
      id: "approval-highlight-ui", name: "Approval Highlight", projectName: "Approval Highlight",
      role: "OWNER", workspaceId: "default", dataSources: [], tags: [], initials: "AH",
      createdAt: "2026-10-15T00:00:00Z", agentState: agentState(scenario),
    });
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes("/_next/")) return route.continue();
      const url = new URL(request.url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/projects")) data = [project()];
      if (url.pathname.endsWith("/projects/approval-highlight-ui")) data = project();
      if (url.pathname.endsWith("/ai/active")) data = { success: true, data: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    for (const current of scenarios) {
      scenario = current;
      await page.goto(process.env.WEBAPP_URL || "http://localhost:3000");
      await page.getByText("Approval Highlight", { exact: true }).first().click();
      await page.getByRole("button", { name: "Workflow", exact: true }).click();
      await page.getByText("This process is awaiting your response.", { exact: true }).waitFor();
      const highlighted = await page.locator(".animate-approval-glow").allTextContents();
      const proceed = page.getByRole("button", { name: "Proceed to Next Phase", exact: true });
      if (scenario.reviewTitle === null) {
        assert.equal(highlighted.length, 0, `${scenario.name}: stage transitions must not highlight a subprocess`);
        assert.equal(await page.locator(".bg-status-awaiting-approval").count(), 0, `${scenario.name}: pending nodes must keep their regular icons`);
        assert.equal(await proceed.isVisible(), true);
        assert.equal(await page.getByRole("button", { name: /^Review / }).count(), 0);
      } else {
        assert.equal(highlighted.length, 1, `${scenario.name}: exactly one model subprocess must be highlighted`);
        assert.ok(highlighted[0].includes(scenario.reviewTitle), `${scenario.name}: observed ${highlighted[0]}`);
        assert.equal(await proceed.count(), 0);
        await page.getByRole("button", { name: scenario.reviewButton, exact: true }).click();
        await page.getByRole("heading", { name: scenario.reviewTitle, level: 2, exact: true }).waitFor();
      }
    }
    console.log("Verified three stage-entry approvals have no subprocess highlight and four model HITL reviews highlight and open the correct subprocess.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
