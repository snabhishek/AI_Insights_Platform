import { RunnableConfig } from "@langchain/core/runnables";
import * as fs from "fs";
import * as path from "path";
import { AgentState, IngestionServices } from "../state";
import { cleanupRunContainer, executePythonScript } from "../tools/helpers/pythonExecutor";
import { getSandboxDirectory } from "../tools/filesystem";

type State = typeof AgentState.State;

function servicesFrom(config?: RunnableConfig): IngestionServices {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) throw new Error("Services dependency is not provided in config");
  return services;
}

function featureMetadata(state: State) {
  const architect = (state.featureArchitect || {}) as any;
  const decision = architect.orchestrationDecision || architect.finalOutput?.orchestrationDecision || {};
  const validator = (state.featureValidator || architect.featureValidator || {}) as any;
  return {
    targetColumn: decision.targetColumn || architect.targetColumn || "",
    problemType: decision.problemType || architect.problemType || "regression",
    features: validator.validatedFeatureSet?.kept || [],
  };
}

function runDirectory(state: State, services: IngestionServices) {
  return getSandboxDirectory(services.projectId || state.projectId, state.runTimestamp);
}

function findDataset(dir: string): string | null {
  const names = ["validated_features.parquet", "feature_matrix.parquet", "modeling_dataset.parquet", "dataset.parquet", "validated_features.csv", "feature_matrix.csv", "modeling_dataset.csv", "dataset.csv"];
  return names.find((name) => fs.existsSync(path.join(dir, name))) || null;
}

function readReport(state: State, services: IngestionServices): any {
  const reportPath = path.join(runDirectory(state, services), "model_training_report.json");
  if (!fs.existsSync(reportPath)) throw new Error("Model training report was not produced");
  return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
}

export async function modelSelectionNode(_state: State, _config?: RunnableConfig) {
  // Phase 1: 3.1 Model Selection - Initial candidate model recommendation
  const metadata = featureMetadata(_state);
  const candidateModels = metadata.problemType === "classification"
    ? ["Logistic Regression", "Random Forest Classifier", "Gradient Boosting Classifier"]
    : ["Linear Regression", "Random Forest Regressor", "Gradient Boosting Regressor"];

  const output = {
    status: "Completed",
    summary: `Selected candidate models for ${metadata.problemType} problem: ${candidateModels.join(", ")}`,
    phase: "Model Selection",
    problemType: metadata.problemType,
    targetColumn: metadata.targetColumn,
    candidateModels,
  };

  return {
    modelSelection: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { modelSelection: output },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "In Progress",
      modelTraining: "Pending",
      modelValidation: "Pending",
    },
  };
}

export async function trainingConfigurationNode(state: State, config?: RunnableConfig) {
  // Phase 2: 3.2 Training Configuration - Prepare training environment, split ratios & hyperparameters
  const services = servicesFrom(config);
  const metadata = featureMetadata(state);
  const dataset = findDataset(runDirectory(state, services));
  if (!dataset) throw new Error("Feature Engineering did not produce a supported model-ready dataset artifact");
  if (!metadata.targetColumn) throw new Error("Feature Engineering did not provide a target column");

  const output = {
    status: "Completed",
    summary: "Training configuration and dataset split strategy prepared successfully",
    phase: "Training Configuration",
    dataset,
    targetColumn: metadata.targetColumn,
    problemType: metadata.problemType,
    features: metadata.features,
    configuration: {
      models: metadata.problemType === "classification" ? ["Logistic Regression", "Random Forest"] : ["Linear Regression", "Random Forest"],
      testSplitRatio: 0.3,
      validationSplitRatio: 0.5,
      cvFolds: 5,
    },
  };

  return {
    trainingConfiguration: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { trainingConfiguration: output },
    stageStatuses: {
      trainingConfiguration: "Completed",
      modelTraining: "In Progress",
      modelValidation: "Pending",
    },
  };
}

export async function modelTrainingNode(state: State, config?: RunnableConfig) {
  // Phase 3: 3.3 Model Training - Train candidate models and record evaluation metrics
  const services = servicesFrom(config);
  const metadata = featureMetadata(state);
  const dataset = findDataset(runDirectory(state, services));
  if (!dataset) throw new Error("Feature Engineering did not produce a supported model-ready dataset artifact");
  if (!metadata.targetColumn) throw new Error("Feature Engineering did not provide a target column");
  const python = `
import json, os, pickle
import pandas as pd
import duckdb
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, accuracy_score, precision_recall_fscore_support

dataset = ${JSON.stringify(dataset)}
target = ${JSON.stringify(metadata.targetColumn)}
problem = ${JSON.stringify(String(metadata.problemType || "regression").toLowerCase())}
path = os.path.join('/workspace', dataset)
df = duckdb.read_parquet(path).df() if path.endswith('.parquet') else pd.read_csv(path)
if target not in df.columns: raise ValueError(f"Target column '{target}' is missing")
df = df.dropna(subset=[target])
X, y = df.drop(columns=[target]), df[target]
numeric = X.select_dtypes(include='number').columns.tolist()
categorical = [c for c in X.columns if c not in numeric]
transform = ColumnTransformer([('num', SimpleImputer(strategy='median'), numeric), ('cat', Pipeline([('impute', SimpleImputer(strategy='most_frequent')), ('onehot', OneHotEncoder(handle_unknown='ignore'))]), categorical)])
classification = problem == 'classification' or (problem != 'forecasting' and (str(y.dtype) in ('object','bool','category') or y.nunique() <= 20))
stratify = y if classification and y.value_counts().min() >= 2 else None
X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=.30, random_state=42, stratify=stratify)
temp_stratify = y_temp if classification and y_temp.value_counts().min() >= 2 else None
X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=.50, random_state=42, stratify=temp_stratify)
models = {'Logistic Regression': LogisticRegression(max_iter=1000), 'Random Forest': RandomForestClassifier(n_estimators=100, random_state=42)} if classification else {'Linear Regression': LinearRegression(), 'Random Forest': RandomForestRegressor(n_estimators=100, random_state=42)}
runs=[]
best=None
for name, estimator in models.items():
    pipe=Pipeline([('prepare', transform), ('model', estimator)])
    try:
        pipe.fit(X_train, y_train); val=pipe.predict(X_val); test=pipe.predict(X_test)
        if classification:
            p,r,f,_=precision_recall_fscore_support(y_val,val,average='weighted',zero_division=0); metrics={'accuracy':accuracy_score(y_val,val),'precision':p,'recall':r,'f1':f}; test_metrics={'accuracy':accuracy_score(y_test,test)}; score=metrics['f1']
        else:
            metrics={'mae':mean_absolute_error(y_val,val),'rmse':mean_squared_error(y_val,val)**.5,'r2':r2_score(y_val,val)}; test_metrics={'mae':mean_absolute_error(y_test,test),'rmse':mean_squared_error(y_test,test)**.5,'r2':r2_score(y_test,test)}; score=-metrics['rmse']
        item={'name':name,'status':'Completed','metrics':metrics,'testMetrics':test_metrics,'score':score}; runs.append(item)
        if best is None or score > best[0]: best=(score,name,pipe,item)
    except Exception as exc: runs.append({'name':name,'status':'Failed','error':str(exc)})
if best is None: raise RuntimeError('No candidate model trained successfully')
artifact='selected_model.pkl'
with open(os.path.join('/workspace', artifact),'wb') as handle: pickle.dump(best[2],handle)
report={'problemType':'classification' if classification else problem,'targetColumn':target,'rowCount':len(df),'featureCount':len(X.columns),'splits':{'train':len(X_train),'validation':len(X_val),'test':len(X_test)},'runs':runs,'selectedModel':best[1],'validationMetrics':best[3]['testMetrics'],'artifact':artifact}
with open('/workspace/model_training_report.json','w') as handle: json.dump(report,handle,indent=2)
print(json.dumps(report))
`;
  const execution = await executePythonScript("train_and_validate_models.py", python, services.projectId || state.projectId, state.runTimestamp, services, state.connectorId);
  await cleanupRunContainer(services.projectId || state.projectId, state.runTimestamp);
  if (!execution.success) throw new Error(execution.stderr || "Model training failed");
  const report = readReport(state, services);
  const rankedCandidates = report.runs.filter((run: any) => run.status === "Completed").sort((a: any, b: any) => b.score - a.score);
  const output = {
    status: "Completed",
    summary: `${rankedCandidates.length} candidate model(s) trained and evaluated successfully`,
    dataset,
    targetColumn: metadata.targetColumn,
    problemType: metadata.problemType,
    features: metadata.features,
    candidates: report.runs,
    rankedCandidates,
    splits: report.splits,
    phase: "Model Training",
  };
  return {
    modelTraining: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { modelTraining: output },
    stageStatuses: {
      modelTraining: "Completed",
      modelValidation: "In Progress",
    },
  };
}

export async function modelValidationNode(state: State, config?: RunnableConfig) {
  // Phase 4: 3.4 Model Validation - Validate leading model on holdout test set, persist artifact, complete workflow
  const services = servicesFrom(config);
  const report = readReport(state, services);
  const metrics = report.validationMetrics || {};
  const finite = Object.values(metrics).length > 0 && Object.values(metrics).every((value) => typeof value === "number" && Number.isFinite(value));
  if (!finite) throw new Error("Selected model did not produce valid holdout metrics");

  const artifactPath = path.join(runDirectory(state, services), report.artifact || "selected_model.pkl");
  if (!fs.existsSync(artifactPath)) throw new Error("Selected model artifact is missing");

  const output = {
    status: "Passed",
    summary: `Model ${report.selectedModel} validated on held-out test data and persisted successfully`,
    model: report.selectedModel,
    modelVersion: state.runTimestamp,
    targetColumn: report.targetColumn,
    problemType: report.problemType,
    testMetrics: metrics,
    artifact: report.artifact,
    checks: { finiteMetrics: true, heldOutTestSet: true },
    phase: "Model Validation",
  };

  return {
    modelValidation: output,
    modelSelection: {
      ...output,
      status: "Completed",
    },
    status: "completed",
    summary: "Model Training & Validation completed successfully",
    stageOutputs: {
      modelValidation: output,
      modelSelection: output,
    },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "Completed",
      modelTraining: "Completed",
      modelValidation: "Completed",
    },
    steps: [
      {
        name: "Model Training & Validation",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}
