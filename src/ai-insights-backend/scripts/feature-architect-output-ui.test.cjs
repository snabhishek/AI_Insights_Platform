const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright");

const featureArchitect = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : {
  orchestrationDecision: { problemType: "Forecasting", predictionEntity: "product_region" },
  featureCreation: { recommendations: [] },
  featureTransformation: { recommendations: [] },
  featureExtraction: {
    status: "Success", summary: "Extracted independent components from correlated predictors.",
    recommendations: [{ method: "pca", extractedFeaturesCount: 3, description: "Compress correlated weather and economic predictors." }],
  },
  featureSelection: {
    status: "Success", summary: "Removed redundant predictors while preserving the target.",
    recommendations: [{
      method: "correlation_filter", selectedFeatures: ["temperature_lag", "pca_comp_1"],
      droppedFeatures: ["redundant_temperature"], description: "Retain the more predictive signal from each correlated pair.",
    }],
  },
};

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const project = {
      id: "feature-output-ui", name: "Feature Output", projectName: "Feature Output", role: "OWNER",
      workspaceId: "default", dataSources: [], tags: [], initials: "FO", createdAt: "2026-10-15T00:00:00Z",
      agentState: {
        status: "Awaiting Approval", nextStep: "Model Training & Validation",
        stageStatuses: {
          dataIngestion: { status: "Completed", inspect: "Completed", profileData: "Completed", resolveSchema: "Completed" },
          featureEngineering: { status: "Awaiting Approval", hierarchyMapperNode: "Completed", featureArchitectNode: "Completed", featureValidatorNode: "Completed", exogenous: "Completed" },
          modelTrainingValidation: { status: "Pending", modelSelectionNode: "Pending", trainingConfigurationNode: "Pending", preFlightNode: "Pending", modelTrainingCodeNode: "Pending" },
        },
        stageOutputs: { featureArchitectNode: featureArchitect },
      },
    };
    await page.route("**/*", async route => {
      const request = route.request();
      if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes("/_next/")) return route.continue();
      const url = new URL(request.url());
      let data = [];
      if (url.pathname.endsWith("/workspaces")) data = [{ id: "default", name: "Default Workspace", isDefault: true }];
      if (url.pathname.endsWith("/projects")) data = [project];
      if (url.pathname.endsWith("/projects/feature-output-ui")) data = project;
      if (url.pathname.endsWith("/ai/active")) data = { success: true, data: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(process.env.WEBAPP_URL || "http://localhost:3000");
    await page.getByText("Feature Output", { exact: true }).first().click();
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await page.getByRole("heading", { name: "Feature Architect", exact: true }).click();
    await page.getByRole("heading", { name: "Feature Architect", level: 2, exact: true }).waitFor();

    await page.getByRole("button", { name: "Extractions", exact: true }).click();
    assert.equal(await page.getByText(featureArchitect.featureExtraction.summary, { exact: true }).count(), 1);
    const extraction = featureArchitect.featureExtraction.recommendations[0];
    assert.equal(await page.getByText(extraction.method, { exact: true }).count(), 1, "Extraction method must render from the saved report");
    assert.equal(await page.getByText(`${extraction.extractedFeaturesCount} components`, { exact: true }).count(), 1);
    assert.equal(await page.getByText(extraction.description, { exact: true }).count(), 1);

    await page.getByRole("button", { name: "Feature Selection", exact: true }).click();
    assert.equal(await page.getByText(featureArchitect.featureSelection.summary, { exact: true }).count(), 1);
    for (const selection of featureArchitect.featureSelection.recommendations) {
      const card = page.getByText(`Method: ${selection.method}`, { exact: true }).locator("..").locator("..");
      assert.equal(await card.count(), 1, "Each selection method must have a visible report");
      assert.equal(await card.getByText(`Selected: ${selection.selectedFeatures.length}`, { exact: true }).count(), 1);
      assert.equal(await card.getByText(`Discarded: ${selection.droppedFeatures.length}`, { exact: true }).count(), 1);
      assert.equal(await card.getByText(selection.description, { exact: true }).count(), 1);
      if (selection.selectedFeatures.length > 0) {
        assert.equal(await card.getByText(selection.selectedFeatures.join(", "), { exact: true }).count(), 1);
      }
      if (selection.droppedFeatures.length > 0) {
        assert.equal(await card.getByText(selection.droppedFeatures.join(", "), { exact: true }).count(), 1);
      }
    }
    console.log("Verified extraction method, component count, description, and each selection method and feature count render from the Feature Architect report.");
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
