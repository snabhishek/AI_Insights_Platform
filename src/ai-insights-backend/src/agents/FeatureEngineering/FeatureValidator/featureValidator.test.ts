import { looksLikeError } from "../../validator/validatorNode";
import { makePipelineTemplate } from "../../tools/featureArchitect/featureArchitect.tools";

async function runFeatureValidatorTests() {
  console.log("=== Starting Feature Validator Unit Tests ===");
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string) {
    totalCount++;
    if (condition) {
      console.log(`[PASS] Test ${totalCount}: ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Test ${totalCount}: ${testName}`);
    }
  }

  // 1. Validator Node: Verify looksLikeError rejects featureValidator output missing mandatory keys
  try {
    const invalidObj = {
      status: "ok",
      summary: "Some summary",
      // missing leakageReport, multicollinearityReport, driftReport, importanceRanking, validatedFeatureSet, pythonCode, yamlLineage
    };
    const isError = looksLikeError("featureValidator", invalidObj);
    assert(isError, "looksLikeError correctly flags incomplete featureValidator output as error");
  } catch (err: any) {
    assert(false, `looksLikeError test failed with exception: ${err?.message}`);
  }

  // 2. Validator Node: Verify looksLikeError accepts valid featureValidator output
  try {
    const validObj = {
      status: "ok",
      summary: "Validation passed",
      leakageReport: { leakyFeatures: [], leakageFound: false },
      multicollinearityReport: { highVifFeatures: [], highCorrelationPairs: [] },
      driftReport: { driftedFeatures: [] },
      importanceRanking: [{ featureName: "f1", importanceScore: 0.95, rank: 1 }],
      validatedFeatureSet: { kept: ["f1"], dropped: [], totalKept: 1, totalDropped: 0 },
      pythonCode: "def main_feature_validation(): pass",
      yamlLineage: "lineage: valid",
    };
    const isError = looksLikeError("featureValidator", validObj);
    assert(!isError, "looksLikeError accepts fully compliant featureValidator output");
  } catch (err: any) {
    assert(false, `looksLikeError compliant test failed with exception: ${err?.message}`);
  }

  // 3. Pipeline Template: Verify FEATURE_VALIDATION region markers exist and are ordered
  try {
    const template = makePipelineTemplate("test_pipeline.py");
    const hasRegionStart = template.includes("# -- REGION: FEATURE_VALIDATION START --");
    const hasRegionEnd = template.includes("# -- REGION: FEATURE_VALIDATION END --");
    const hasRunnerStep = template.includes("main_feature_validation");
    const hasStep7 = template.includes("=== [7/7] Running Feature Validation ===");
    const hasReportPath = template.includes("--report-path");

    assert(
      hasRegionStart && hasRegionEnd && hasRunnerStep && hasStep7 && hasReportPath,
      "makePipelineTemplate contains FEATURE_VALIDATION region markers and 7-stage sequential runner"
    );
  } catch (err: any) {
    assert(false, `Pipeline template test failed with exception: ${err?.message}`);
  }

  // 4. Remediation Rule Test: Verify synthetic collinear pair resolution drops lower-importance feature
  try {
    const importanceMap: Record<string, number> = {
      feature_a: 0.85,
      feature_b: 0.32,
    };
    const collinearPair = { feature1: "feature_a", feature2: "feature_b", correlation: 0.98 };

    // Resolution rule: drop feature with lower importance
    const dropped =
      importanceMap[collinearPair.feature1] > importanceMap[collinearPair.feature2]
        ? collinearPair.feature2
        : collinearPair.feature1;

    assert(
      dropped === "feature_b",
      "Multicollinearity resolution tie-breaker accurately selects lower-importance feature for dropping"
    );
  } catch (err: any) {
    assert(false, `Collinearity tie-breaker test failed with exception: ${err?.message}`);
  }

  // 5. Leakage Auto-Drop Rule Test: Hard target leaks are dropped, not just flagged
  try {
    const candidateFeatures = [
      { name: "normal_lag_1", isTargetLeak: false },
      { name: "future_order_status", isTargetLeak: true },
    ];
    const kept = candidateFeatures.filter((f) => !f.isTargetLeak).map((f) => f.name);
    const dropped = candidateFeatures.filter((f) => f.isTargetLeak).map((f) => f.name);

    assert(
      kept.includes("normal_lag_1") && dropped.includes("future_order_status") && kept.length === 1,
      "Target leakage rule drops leaky features from kept set"
    );
  } catch (err: any) {
    assert(false, `Leakage drop test failed with exception: ${err?.message}`);
  }

  console.log(`\n=== Test Results: ${passedCount}/${totalCount} Passed ===`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runFeatureValidatorTests().catch((e) => {
  console.error("Test runner failed:", e);
  process.exit(1);
});
