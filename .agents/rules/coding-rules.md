---
trigger: always_on
---

## Project overview
This repository is the backend for the AI Insights Platform. It is a TypeScript/Express service that connects to data sources through connector-based workflows, persists metadata in PostgreSQL via Drizzle ORM, and exposes HTTP endpoints for connector management and health checks.

## Working conventions
- Prefer the existing layered architecture: route -> controller -> service -> repository.
- Keep business logic in services, not in controllers or routes.
- Keep database access in repositories and schema-specific logic in the Drizzle schema layer.
- Follow constructor-based dependency injection. New services or repositories should be wired in [src/index.ts](src/index.ts) rather than instantiated inline inside controllers or services.
- Prefer interfaces for dependencies (for example, repository and service interfaces in [src/repositories](src/repositories) and [src/services](src/services)).

## Repository and factory patterns
- Treat repositories as the abstraction for persistence and query behavior.
- When adding a new domain, create a repository interface plus an implementation, then inject it through the service layer.
- Keep connector-specific behavior isolated behind service abstractions so new data-source types can be added without rewriting controllers.
- If a component needs to create different implementations based on runtime input, keep the selection logic centralized and explicit rather than scattering conditionals across the app.

## Dependency injection and composition
- The composition root is [src/index.ts](src/index.ts). Add new dependencies there.
- Avoid importing concrete implementations from multiple layers; depend on interfaces where possible.
- If you add a new service, pass it in through the constructor and keep the constructor signature small and explicit.
- For connector or pipeline orchestration, keep the orchestration flow in a service and let controllers remain thin request/response adapters.

## Connector and AI insights pipeline guidance
- Connector flows should remain pluggable and source-agnostic. The current design uses connector type checks in [src/services/connector.service.ts](src/services/connector.service.ts) and [src/services/connectionTester.service.ts](src/services/connectionTester.service.ts); preserve that separation for new connector types.
- When adding support for a new connector or pipeline source, add or extend the relevant service and repository abstractions rather than embedding logic in routes.
- Keep validation, schema discovery, preview generation, and health checks in the connection/testing service layer so controllers stay simple.
- For AI insights pipelines, favor small composable services that perform one responsibility each (ingestion, validation, metadata extraction, orchestration) and wire them together from the top level.

## LangGraph and agent-first development
- Keep agentic workflows in the existing LangGraph graphs, nodes, tools, and state annotations. Let the graph route work and let agents interpret context, choose among valid actions, and produce domain recommendations; do not replace this flow with hard-coded keyword, object-name, or response-shape branching when the decision belongs to the agent.
- Define structured agent and tool inputs/outputs with the schema approach already used in the backend (Zod with LangChain/LangGraph). Prefer the supported structured-output interface for the model or agent, and pass the schema through shared agent helpers when practical; do not rely on prompt-only JSON instructions or raw JSON parsing and type casts as the output contract.
- Make the runtime schema the source of truth for the output shape and infer the TypeScript type from it (for example, `z.infer<typeof OutputSchema>`). Avoid maintaining a parallel interface/type and handwritten checks for each property when the schema can express the same contract.
- Model field presence deliberately: use required fields for invariants, `.optional()` for omitted fields, `.nullable()` only when `null` is a meaningful value, and defaults only when omission has a defined interpretation. Use schema/type composition such as `.pick()`, `.omit()`, `.partial()`, and TypeScript `Pick`, `Omit`, and `Partial` for derived contracts instead of duplicating object shapes. Keep LangGraph state defaults and reducers consistent with these presence semantics.
- Validate model output once at the agent boundary with the declared schema. On invalid output, use the established retry, repair, or fallback path and return a typed result; do not scatter manual `typeof`, property-name, `Object.keys`, or shape checks through nodes and services as substitutes for a contract.
- Keep deterministic code for security and authorization, external input validation, resource limits, domain invariants, side effects, and persistence. Agent reasoning does not replace those controls. Put semantic decision-making in the agent and enforce the resulting decision against explicit domain constraints before executing side effects.
- Make schema adoption incremental: reuse and improve existing agent/state/output abstractions, preserve established workflow behavior, and avoid broad rewrites or adding a second orchestration framework.

## Database and migrations
- Schema changes belong in [src/db/schema.ts](src/db/schema.ts).
- Run migrations with Drizzle after schema changes.
- Keep column naming and types aligned with the existing table structure and the TypeScript model definitions in [src/models](src/models).

## Commands
- Start the backend locally: npm run dev
- Build the project: npm run build
- Start the built app: npm run start

## Notes for agents
- Do not introduce framework-specific patterns that conflict with the current Express + TypeScript + Drizzle setup.
- Preserve the existing error-handling style: return structured JSON responses from controllers and log unexpected failures in services.
- Keep changes minimal and consistent with the repository’s current structure unless the task explicitly requires a broader refactor.
