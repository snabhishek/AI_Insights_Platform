-- Squashed application baseline. Retired ./drizzle history is preserved, not replayed.
CREATE TABLE IF NOT EXISTS "connectors" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"subtext" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"health" varchar(50) NOT NULL,
	"last_sync_time" varchar(100) NOT NULL,
	"last_sync_date" varchar(100) NOT NULL,
	"created_at" timestamp NOT NULL,
	"connection_config" jsonb NOT NULL,
	"assets" jsonb NOT NULL,
	"workspace_id" varchar(50)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"use_case" text,
	"status" varchar(50) DEFAULT 'idle',
	"agent_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_name" varchar(255),
	"name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'OWNER' NOT NULL,
	"data_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"initials" varchar(10) DEFAULT 'US' NOT NULL,
	"workspace_id" varchar(50) NOT NULL,
	"use_case" text,
	"domain" varchar(255),
	"sub_domain" varchar(255),
	"folder_path" varchar(500),
	"status" varchar(50) DEFAULT 'idle',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_jobs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"project_name" varchar(255),
	"connector_id" text[] NOT NULL,
	"user_prompt" text,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_thinking" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"pipeline" varchar(100) NOT NULL,
	"substep" varchar(100) NOT NULL,
	"thinking" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dynamic_model_registry" (
	"model_id" varchar(100) PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"algorithm" varchar(255) NOT NULL,
	"framework" varchar(50) DEFAULT 'custom' NOT NULL,
	"supported_tasks" text[] DEFAULT '{}'::text[] NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"weaknesses" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"source_type_id" varchar(50) DEFAULT 'external' NOT NULL,
	"source_provider_id" varchar(100),
	"source" varchar(100) DEFAULT 'web_search' NOT NULL,
	"repository_url" text,
	"repository_id" varchar(255),
	"version" varchar(100),
	"license" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_selection_decisions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"use_case" text,
	"status" varchar(50) DEFAULT 'READY' NOT NULL,
	"dataset_version" varchar(100),
	"feature_set_version" varchar(100),
	"model_catalog_version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"prompt_version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"agent_version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"llm_provider" varchar(50),
	"llm_model" varchar(100),
	"execution_duration_ms" integer,
	"candidate_count" integer,
	"primary_model_id" varchar(100),
	"input_context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_selection" jsonb,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_source_providers" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"source_type_id" varchar(50) NOT NULL,
	"base_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_source_types" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_validation_results" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"validation_run_id" varchar(50) NOT NULL,
	"model_id" varchar(100) NOT NULL,
	"display_name" varchar(255),
	"framework" varchar(50),
	"execution_status" varchar(50) DEFAULT 'Completed' NOT NULL,
	"score" double precision,
	"primary_metric_name" varchar(100),
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"totals" jsonb DEFAULT '{}'::jsonb,
	"actual_total" double precision,
	"forecast_total" double precision,
	"difference" double precision,
	"difference_percentage" double precision,
	"evaluation_record_count" integer DEFAULT 0,
	"actual_data_coverage" double precision,
	"chart_series" jsonb DEFAULT '{}'::jsonb,
	"model_artifact_path" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_validation_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"evaluation_mode" varchar(50) NOT NULL,
	"prediction_objective_start_date" varchar(50),
	"prediction_objective_horizon" integer DEFAULT 12 NOT NULL,
	"prediction_objective_frequency" varchar(50) DEFAULT 'Weekly' NOT NULL,
	"dataset_reference" text,
	"dataset_schema_version" varchar(50),
	"actual_data_coverage" double precision,
	"champion_model_id" varchar(100),
	"status" varchar(50) DEFAULT 'Completed' NOT NULL,
	"summary" text,
	"validation_directory" varchar(500),
	"report_artifact_path" text,
	"predictions_artifact_path" text,
	"chart_data" jsonb DEFAULT '{}'::jsonb,
	"warnings" text[] DEFAULT '{}'::text[],
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_suggestions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"suggestion" varchar(500) NOT NULL,
	"category" varchar(100) DEFAULT 'General' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_suggestions_suggestion_unique" UNIQUE("suggestion")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sparrow_intents" (
	"code" varchar(80) PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"allows_inference" boolean DEFAULT false NOT NULL,
	"conversational" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domains" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"sub_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
-- Adopt every application table, including partially initialized installations.
-- Extra legacy columns remain intact; incompatible types or constraints fail.
DO $baseline$
DECLARE
  tables jsonb := '[{"name":"connectors","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"name","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"subtext","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"type","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"health","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"last_sync_time","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"last_sync_date","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true},{"name":"connection_config","type":"jsonb","primaryKey":false,"notNull":true},{"name":"assets","type":"jsonb","primaryKey":false,"notNull":true},{"name":"workspace_id","type":"character varying(50)","primaryKey":false,"notNull":false}],"constraints":[{"name":"connectors_pkey","kind":"p","columns":["id"]},{"name":"connectors_workspace_id_workspaces_id_fk","kind":"f","columns":["workspace_id"],"target":"workspaces","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"connectors_workspace_id_idx","columns":[{"expression":"workspace_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"project_runs","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"use_case","type":"text","primaryKey":false,"notNull":false},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":false,"default":"''idle''"},{"name":"agent_state","type":"jsonb","primaryKey":false,"notNull":true},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"project_runs_pkey","kind":"p","columns":["id"]},{"name":"project_runs_project_id_projects_id_fk","kind":"f","columns":["project_id"],"target":"projects","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"project_runs_project_id_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"project_runs_status_idx","columns":[{"expression":"status","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"projects","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_name","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"name","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"role","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''OWNER''"},{"name":"data_sources","type":"text[]","primaryKey":false,"notNull":true,"default":"''{}''::text[]"},{"name":"initials","type":"character varying(10)","primaryKey":false,"notNull":true,"default":"''US''"},{"name":"workspace_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"use_case","type":"text","primaryKey":false,"notNull":false},{"name":"domain","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"sub_domain","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"folder_path","type":"character varying(500)","primaryKey":false,"notNull":false},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":false,"default":"''idle''"},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"projects_pkey","kind":"p","columns":["id"]},{"name":"projects_workspace_id_workspaces_id_fk","kind":"f","columns":["workspace_id"],"target":"workspaces","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"projects_workspace_id_idx","columns":[{"expression":"workspace_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"workspaces","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"name","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"is_default","type":"boolean","primaryKey":false,"notNull":true,"default":false},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"workspaces_pkey","kind":"p","columns":["id"]},{"name":"workspaces_name_unique","kind":"u","columns":["name"]}],"indexes":[]},{"name":"agent_jobs","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_id","type":"character varying(50)","primaryKey":false,"notNull":false},{"name":"project_name","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"connector_id","type":"text[]","primaryKey":false,"notNull":true},{"name":"user_prompt","type":"text","primaryKey":false,"notNull":false},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''queued''"},{"name":"error","type":"text","primaryKey":false,"notNull":false},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"agent_jobs_pkey","kind":"p","columns":["id"]},{"name":"agent_jobs_project_id_projects_id_fk","kind":"f","columns":["project_id"],"target":"projects","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"agent_jobs_project_id_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"agent_thinking","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"pipeline","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"substep","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"thinking","type":"jsonb","primaryKey":false,"notNull":true},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"agent_thinking_pkey","kind":"p","columns":["id"]},{"name":"agent_thinking_project_id_projects_id_fk","kind":"f","columns":["project_id"],"target":"projects","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"agent_thinking_project_id_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"agent_thinking_proj_pipe_sub_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"},{"expression":"pipeline","isExpression":false,"asc":true,"nulls":"last"},{"expression":"substep","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"dynamic_model_registry","columns":[{"name":"model_id","type":"character varying(100)","primaryKey":true,"notNull":true},{"name":"display_name","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"algorithm","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"framework","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''custom''"},{"name":"supported_tasks","type":"text[]","primaryKey":false,"notNull":true,"default":"''{}''::text[]"},{"name":"capabilities","type":"text[]","primaryKey":false,"notNull":true,"default":"''{}''::text[]"},{"name":"strengths","type":"text[]","primaryKey":false,"notNull":true,"default":"''{}''::text[]"},{"name":"weaknesses","type":"text[]","primaryKey":false,"notNull":true,"default":"''{}''::text[]"},{"name":"is_baseline","type":"boolean","primaryKey":false,"notNull":true,"default":false},{"name":"source_type_id","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''external''"},{"name":"source_provider_id","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"source","type":"character varying(100)","primaryKey":false,"notNull":true,"default":"''web_search''"},{"name":"repository_url","type":"text","primaryKey":false,"notNull":false},{"name":"repository_id","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"version","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"license","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"metadata","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"discovered_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"dynamic_model_registry_pkey","kind":"p","columns":["model_id"]},{"name":"dynamic_model_registry_source_type_id_model_source_types_id_fk","kind":"f","columns":["source_type_id"],"target":"model_source_types","targetColumns":["id"],"onDelete":"no action","onUpdate":"no action"},{"name":"dynamic_model_registry_source_provider_id_model_source_providers_id_fk","kind":"f","columns":["source_provider_id"],"target":"model_source_providers","targetColumns":["id"],"onDelete":"no action","onUpdate":"no action"}],"indexes":[{"name":"dynamic_model_registry_framework_idx","columns":[{"expression":"framework","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"dynamic_model_registry_source_idx","columns":[{"expression":"source","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"dynamic_model_registry_source_type_idx","columns":[{"expression":"source_type_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"dynamic_model_registry_source_provider_idx","columns":[{"expression":"source_provider_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"model_selection_decisions","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"use_case","type":"text","primaryKey":false,"notNull":false},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''READY''"},{"name":"dataset_version","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"feature_set_version","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"model_catalog_version","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''1.0.0''"},{"name":"prompt_version","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''1.0.0''"},{"name":"agent_version","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''1.0.0''"},{"name":"llm_provider","type":"character varying(50)","primaryKey":false,"notNull":false},{"name":"llm_model","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"execution_duration_ms","type":"integer","primaryKey":false,"notNull":false},{"name":"candidate_count","type":"integer","primaryKey":false,"notNull":false},{"name":"primary_model_id","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"input_context_snapshot","type":"jsonb","primaryKey":false,"notNull":true,"default":"''{}''::jsonb"},{"name":"decision","type":"jsonb","primaryKey":false,"notNull":true,"default":"''{}''::jsonb"},{"name":"user_selection","type":"jsonb","primaryKey":false,"notNull":false},{"name":"is_stale","type":"boolean","primaryKey":false,"notNull":true,"default":false},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"model_selection_decisions_pkey","kind":"p","columns":["id"]},{"name":"model_selection_decisions_project_id_projects_id_fk","kind":"f","columns":["project_id"],"target":"projects","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"model_selection_decisions_project_id_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"model_selection_decisions_status_idx","columns":[{"expression":"status","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"model_source_providers","columns":[{"name":"id","type":"character varying(100)","primaryKey":true,"notNull":true},{"name":"name","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"source_type_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"base_url","type":"text","primaryKey":false,"notNull":false},{"name":"metadata","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"model_source_providers_pkey","kind":"p","columns":["id"]},{"name":"model_source_providers_source_type_id_model_source_types_id_fk","kind":"f","columns":["source_type_id"],"target":"model_source_types","targetColumns":["id"],"onDelete":"no action","onUpdate":"no action"}],"indexes":[{"name":"model_source_providers_source_type_id_idx","columns":[{"expression":"source_type_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"model_source_types","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"name","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"description","type":"text","primaryKey":false,"notNull":false},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"model_source_types_pkey","kind":"p","columns":["id"]}],"indexes":[]},{"name":"model_validation_results","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"validation_run_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"model_id","type":"character varying(100)","primaryKey":false,"notNull":true},{"name":"display_name","type":"character varying(255)","primaryKey":false,"notNull":false},{"name":"framework","type":"character varying(50)","primaryKey":false,"notNull":false},{"name":"execution_status","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''Completed''"},{"name":"score","type":"double precision","primaryKey":false,"notNull":false},{"name":"primary_metric_name","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"metrics","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"totals","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"actual_total","type":"double precision","primaryKey":false,"notNull":false},{"name":"forecast_total","type":"double precision","primaryKey":false,"notNull":false},{"name":"difference","type":"double precision","primaryKey":false,"notNull":false},{"name":"difference_percentage","type":"double precision","primaryKey":false,"notNull":false},{"name":"evaluation_record_count","type":"integer","primaryKey":false,"notNull":false,"default":0},{"name":"actual_data_coverage","type":"double precision","primaryKey":false,"notNull":false},{"name":"chart_series","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"model_artifact_path","type":"text","primaryKey":false,"notNull":false},{"name":"error_message","type":"text","primaryKey":false,"notNull":false},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"model_validation_results_pkey","kind":"p","columns":["id"]},{"name":"model_validation_results_validation_run_id_model_validation_runs_id_fk","kind":"f","columns":["validation_run_id"],"target":"model_validation_runs","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"model_validation_results_run_id_idx","columns":[{"expression":"validation_run_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"model_validation_results_model_id_idx","columns":[{"expression":"model_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"model_validation_runs","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"project_id","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"evaluation_mode","type":"character varying(50)","primaryKey":false,"notNull":true},{"name":"prediction_objective_start_date","type":"character varying(50)","primaryKey":false,"notNull":false},{"name":"prediction_objective_horizon","type":"integer","primaryKey":false,"notNull":true,"default":12},{"name":"prediction_objective_frequency","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''Weekly''"},{"name":"dataset_reference","type":"text","primaryKey":false,"notNull":false},{"name":"dataset_schema_version","type":"character varying(50)","primaryKey":false,"notNull":false},{"name":"actual_data_coverage","type":"double precision","primaryKey":false,"notNull":false},{"name":"champion_model_id","type":"character varying(100)","primaryKey":false,"notNull":false},{"name":"status","type":"character varying(50)","primaryKey":false,"notNull":true,"default":"''Completed''"},{"name":"summary","type":"text","primaryKey":false,"notNull":false},{"name":"validation_directory","type":"character varying(500)","primaryKey":false,"notNull":false},{"name":"report_artifact_path","type":"text","primaryKey":false,"notNull":false},{"name":"predictions_artifact_path","type":"text","primaryKey":false,"notNull":false},{"name":"chart_data","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"warnings","type":"text[]","primaryKey":false,"notNull":false,"default":"''{}''::text[]"},{"name":"metadata","type":"jsonb","primaryKey":false,"notNull":false,"default":"''{}''::jsonb"},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"model_validation_runs_pkey","kind":"p","columns":["id"]},{"name":"model_validation_runs_project_id_projects_id_fk","kind":"f","columns":["project_id"],"target":"projects","targetColumns":["id"],"onDelete":"cascade","onUpdate":"no action"}],"indexes":[{"name":"model_validation_runs_project_id_idx","columns":[{"expression":"project_id","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"model_validation_runs_mode_idx","columns":[{"expression":"evaluation_mode","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"chat_suggestions","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"suggestion","type":"character varying(500)","primaryKey":false,"notNull":true},{"name":"category","type":"character varying(100)","primaryKey":false,"notNull":true,"default":"''General''"},{"name":"display_order","type":"integer","primaryKey":false,"notNull":true,"default":0},{"name":"is_active","type":"boolean","primaryKey":false,"notNull":true,"default":true},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"},{"name":"updated_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"chat_suggestions_pkey","kind":"p","columns":["id"]},{"name":"chat_suggestions_suggestion_unique","kind":"u","columns":["suggestion"]}],"indexes":[{"name":"chat_suggestions_display_order_idx","columns":[{"expression":"display_order","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}},{"name":"chat_suggestions_is_active_idx","columns":[{"expression":"is_active","isExpression":false,"asc":true,"nulls":"last"}],"isUnique":false,"concurrently":false,"method":"btree","with":{}}]},{"name":"sparrow_intents","columns":[{"name":"code","type":"character varying(80)","primaryKey":true,"notNull":true},{"name":"description","type":"text","primaryKey":false,"notNull":true},{"name":"allows_inference","type":"boolean","primaryKey":false,"notNull":true,"default":false},{"name":"conversational","type":"boolean","primaryKey":false,"notNull":true,"default":false},{"name":"is_active","type":"boolean","primaryKey":false,"notNull":true,"default":true},{"name":"updated_at","type":"timestamp with time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"sparrow_intents_pkey","kind":"p","columns":["code"]}],"indexes":[]},{"name":"domains","columns":[{"name":"id","type":"character varying(50)","primaryKey":true,"notNull":true},{"name":"domain","type":"character varying(255)","primaryKey":false,"notNull":true},{"name":"sub_domains","type":"jsonb","primaryKey":false,"notNull":true,"default":"''[]''::jsonb"},{"name":"created_at","type":"timestamp without time zone","primaryKey":false,"notNull":true,"default":"now()"}],"constraints":[{"name":"domains_pkey","kind":"p","columns":["id"]},{"name":"domains_domain_unique","kind":"u","columns":["domain"]}],"indexes":[]}]'::jsonb;
  tbl jsonb; col jsonb; constraint_spec jsonb; idx jsonb;
  table_oid oid; target_oid oid; keys smallint[]; target_keys smallint[];
  existing record; actual_type text; definition text; column_list text;
  delete_action text; update_action text;
BEGIN
  FOR tbl IN SELECT value FROM jsonb_array_elements(tables) LOOP
    table_oid := to_regclass(format('%I', tbl->>'name'));
    FOR col IN SELECT value FROM jsonb_array_elements(tbl->'columns') LOOP
      definition := format('%I %s', col->>'name', col->>'type');
      IF col ? 'default' THEN definition := definition || ' DEFAULT ' || (col->>'default'); END IF;
      IF (col->>'notNull')::boolean THEN definition := definition || ' NOT NULL'; END IF;
      SELECT format_type(atttypid, atttypmod) INTO actual_type FROM pg_attribute
        WHERE attrelid = table_oid AND attname = col->>'name' AND NOT attisdropped;
      IF actual_type IS NULL THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %s', tbl->>'name', definition);
      ELSIF actual_type <> col->>'type' THEN
        -- Earlier schemas used shorter varchar limits. Widening preserves data;
        -- incompatible type changes require an explicit reviewed migration.
        IF actual_type ~ '^character varying\([0-9]+\)$' AND col->>'type' ~ '^character varying\([0-9]+\)$'
          AND substring(actual_type FROM '[0-9]+')::integer < substring(col->>'type' FROM '[0-9]+')::integer THEN
          EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s', tbl->>'name', col->>'name', col->>'type');
        ELSE
          RAISE EXCEPTION 'Baseline mismatch: %.% has type %, expected %', tbl->>'name', col->>'name', actual_type, col->>'type';
        END IF;
      END IF;
      IF (col->>'notNull')::boolean THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET NOT NULL', tbl->>'name', col->>'name');
      END IF;
      IF col ? 'default' THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', tbl->>'name', col->>'name', col->>'default');
      ELSE
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', tbl->>'name', col->>'name');
      END IF;
    END LOOP;
  END LOOP;

  FOR tbl IN SELECT value FROM jsonb_array_elements(tables) LOOP
    table_oid := to_regclass(format('%I', tbl->>'name'));
    FOR constraint_spec IN SELECT value FROM jsonb_array_elements(tbl->'constraints') LOOP
      SELECT array_agg(a.attnum ORDER BY c.ordinality), string_agg(format('%I', c.name), ',' ORDER BY c.ordinality)
        INTO keys, column_list FROM jsonb_array_elements_text(constraint_spec->'columns') WITH ORDINALITY c(name, ordinality)
        JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = c.name AND NOT a.attisdropped;
      IF constraint_spec->>'kind' = 'f' THEN
        target_oid := to_regclass(format('%I', constraint_spec->>'target'));
        SELECT array_agg(a.attnum ORDER BY c.ordinality) INTO target_keys
          FROM jsonb_array_elements_text(constraint_spec->'targetColumns') WITH ORDINALITY c(name, ordinality)
          JOIN pg_attribute a ON a.attrelid = target_oid AND a.attname = c.name AND NOT a.attisdropped;
        delete_action := CASE constraint_spec->>'onDelete' WHEN 'cascade' THEN 'c' WHEN 'set null' THEN 'n' WHEN 'restrict' THEN 'r' WHEN 'set default' THEN 'd' ELSE 'a' END;
        update_action := CASE constraint_spec->>'onUpdate' WHEN 'cascade' THEN 'c' WHEN 'set null' THEN 'n' WHEN 'restrict' THEN 'r' WHEN 'set default' THEN 'd' ELSE 'a' END;
        SELECT * INTO existing FROM pg_constraint WHERE conrelid = table_oid AND contype = 'f' AND conkey = keys LIMIT 1;
        IF FOUND THEN
          IF existing.confrelid <> target_oid OR existing.confkey <> target_keys OR existing.confdeltype::text <> delete_action OR existing.confupdtype::text <> update_action OR NOT existing.convalidated THEN
            RAISE EXCEPTION 'Baseline mismatch: foreign key on %.% is incompatible', tbl->>'name', column_list;
          END IF;
        ELSE
          SELECT string_agg(format('%I', value), ',') INTO definition FROM jsonb_array_elements_text(constraint_spec->'targetColumns');
          EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I (%s) ON DELETE %s ON UPDATE %s', tbl->>'name', constraint_spec->>'name', column_list, constraint_spec->>'target', definition, constraint_spec->>'onDelete', constraint_spec->>'onUpdate');
        END IF;
      ELSE
        IF constraint_spec->>'kind' = 'p' AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = table_oid AND contype = 'p' AND conkey <> keys) THEN
          RAISE EXCEPTION 'Baseline mismatch: primary key on % is incompatible', tbl->>'name';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = table_oid AND contype::text = constraint_spec->>'kind' AND conkey = keys) THEN
          EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s (%s)', tbl->>'name', constraint_spec->>'name', CASE constraint_spec->>'kind' WHEN 'p' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END, column_list);
        END IF;
      END IF;
    END LOOP;
    FOR idx IN SELECT value FROM jsonb_array_elements(tbl->'indexes') LOOP
      SELECT array_agg(a.attnum ORDER BY c.ordinality), string_agg(format('%I', c.value->>'expression'), ',' ORDER BY c.ordinality)
        INTO keys, column_list FROM jsonb_array_elements(idx->'columns') WITH ORDINALITY c(value, ordinality)
        JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = c.value->>'expression' AND NOT a.attisdropped;
      SELECT i.*, am.amname INTO existing FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
        WHERE i.indexrelid = to_regclass(format('%I', idx->>'name'));
      IF FOUND THEN
        IF existing.indrelid <> table_oid OR existing.indkey::text <> array_to_string(keys, ' ') OR existing.indisunique <> (idx->>'isUnique')::boolean OR NOT existing.indisvalid OR existing.indexprs IS NOT NULL OR existing.indpred IS NOT NULL OR existing.amname <> idx->>'method' THEN
          RAISE EXCEPTION 'Baseline mismatch: index % is incompatible', idx->>'name';
        END IF;
      ELSE
        EXECUTE format('CREATE %s INDEX %I ON %I USING %I (%s)', CASE WHEN (idx->>'isUnique')::boolean THEN 'UNIQUE' ELSE '' END, idx->>'name', tbl->>'name', idx->>'method', column_list);
      END IF;
    END LOOP;
  END LOOP;
END
$baseline$;
--> statement-breakpoint
INSERT INTO sparrow_intents (code, description, allows_inference, conversational) VALUES
      ('PREDICT', 'Forecast a future metric using an available trained model.', TRUE, FALSE),
      ('ANALYZE', 'Explore project data and calculate relevant business metrics.', FALSE, FALSE),
      ('EXPLAIN', 'Explain observed results using data; distinguish association from causality.', FALSE, FALSE),
      ('DIAGNOSE', 'Investigate changes, anomalies and potential business drivers.', FALSE, FALSE),
      ('COMPARE', 'Compare periods, segments or explicitly requested model performance.', FALSE, FALSE),
      ('RECOMMEND', 'Propose actions grounded in business data and state uncertainty.', FALSE, FALSE),
      ('WHAT_IF', 'Assess a scenario only when available tools support the requested changes.', TRUE, FALSE),
      ('SUMMARIZE', 'Summarize actual project status or business performance.', FALSE, FALSE),
      ('MODEL_INFERENCE', 'Execute explicitly requested trained-model predictions.', TRUE, FALSE),
      ('MODEL_EXPLANATION', 'Explain available model metadata and evaluation results.', FALSE, FALSE),
      ('DATA_QUESTION', 'Answer a factual question about available data.', FALSE, FALSE),
      ('GENERAL_CONVERSATION', 'Greetings and capability questions; answer the whole message.', FALSE, TRUE),
      ('IRRELEVANT', 'Request beyond available capabilities; explain the limitation.', FALSE, TRUE)
      ON CONFLICT (code) DO NOTHING;
