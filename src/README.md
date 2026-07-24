# 1.1: Inspector, 1.2: Data Profiler, & 1.3: Schema Resolver (LangGraph Agents) - Development Summary

## Overview

This document summarizes the development and implementation details for the **1.1: Inspector**, **1.2: Data Profiler**, and **1.3: Schema Resolver** components within the AI Insights Platform. These nodes form the complete onboarding stages of a LangGraph-powered data analysis workflow.
- **1.1 Inspector**: Responsible for extracting database schemas from connected sources and using LLMs to heuristically infer relationships (like primary and foreign keys) when they are not explicitly defined in the database.
- **1.2 Data Profiler**: Responsible for safely querying the connected sources to retrieve data samples and numerical statistics (e.g. distinct counts). It then uses an LLM to classify columns (e.g., identifying PII, categorical values, date strings).
- **1.3 Schema Resolver**: The final node that unifies the outputs of 1.1 and 1.2. It generates a human-readable Semantic Schema (Data Dictionary) and breaks down context into isolated, table-specific System Instruction Prompts designed for downstream Text-to-SQL agents.

## Key Decisions

1. **State Management**: Instead of storing the massive resulting schemas directly inside the LangGraph state (which could bloat the context memory and lead to performance degradation), the agent writes the schema definitions, profiling data, and LLM inferred outputs to temporary files. The LangGraph state only holds references (file paths) to these JSON structures.
2. **Safe Profiling Strategy**: To protect production databases from expensive analytical queries, the Profiler enforces a strict timeout (`statement_timeout = 30000`), utilizes a maximum row limit (`LIMIT 10000`), and executes simple grouped stats on subqueries rather than full table scans. Three profiling modes (`safe`, `balanced`, `deep`) are natively supported.
3. **Table-Specific Prompt Strategy (1.3)**: Instead of generating one massive, monolithic system prompt containing the entire database schema (which easily exceeds LLM token limits), the Resolver isolates each table and its direct relationships, generating precise and isolated system prompts per table.
4. **Persistent Storage (1.3)**: Unlike previous intermediate states that store files in `os.tmpdir()`, the final resolved Semantic Schema and the generated table-specific Prompts are stored persistently in the workspace (`persistent_data/agents/`) so they can be readily queried without re-running the entire LangGraph.
5. **Dual LLM Integration**: `@langchain/openai` handles multiple specialized tasks across the pipeline:
   - *Relationship Inference (1.1)*: Deduces hidden relationships using schema JSON only.
   - *Data Classification (1.2)*: Classifies column content (PII, categorical) based on small, limited row samples and numerical statistics.
   - *Prompt Generation (1.3)*: Synthesizes final System Prompts strictly focused on safe SQL generation.

## Implementation Details

The implementation consists of the following components under the backend's `src/agents/` directory:

- **`src/agents/state.ts`**: Defines the `AgentState` schema holding references like `sourceStructureFiles`, `profilingDataFiles`, `resolvedSchemaFiles`, and `systemPromptFiles`.
- **`src/agents/inspector/*`**: 
  - `schemaExtractors.ts`: Deterministic schema catalog queries.
  - `llmInferencer.ts`: OpenAI-based relation inference.
  - `inspectorNode.ts`: LangGraph node for extraction.
- **`src/agents/profiler/*`**:
  - `dataProfilers.ts`: Executes DB profiling queries ensuring timeouts, connection limits, and sampling.
  - `profilingLLM.ts`: OpenAI-based data classification (PII, formats) based on the sampled subset.
  - `profilerNode.ts`: LangGraph node for profiling.
- **`src/agents/resolver/*`**:
  - `promptGenerator.ts`: Generates persistent semantic markdown dictionaries and table-specific system prompts.
  - `schemaResolverNode.ts`: LangGraph node for unifying dependencies and persisting outputs.
- **`src/agents/graph.ts`**: Compiles the nodes sequentially: `START -> inspector -> profiler -> resolver -> END`.

An API endpoint (`POST /api/agents/inspect`) in **`AgentController`** serves as the invocation trigger for this pipeline.

## Dependencies Added
- `@langchain/openai`
- `@langchain/langgraph`
- `@langchain/core`
