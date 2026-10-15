import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { AIController } from "../controllers/ai.controller";
import { PostgresAgentThinkingRepository } from "../repositories/agentThinking.repository";
import type { IAgentThinkingService } from "../services/ai/agent-thinking/agentThinking.service.interface";
import type { IIngestionAgentService } from "../services/ai/ingestion-agent/ingestionAgent.service.interface";

const inspection = [{ time: "12:00 PM", text: "Inspecting connector tables", done: true }];
const hierarchy = [{ time: "12:01 PM", text: "Mapping dimensional hierarchy", done: true }];
const timestamp = new Date("2026-10-14T00:00:00Z");
const row = (pipeline: string, substep: string, thinking = hierarchy) => ({
  id: `${pipeline}:${substep}`, projectId: "p1", pipeline, substep, thinking, createdAt: timestamp, updatedAt: timestamp,
});

function fixture(rows: ReturnType<typeof row>[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = { select: () => ({ from: () => ({ where: async (condition: SQL) => {
    const query = new PgDialect().sqlToQuery(condition);
    queries.push(query);
    return rows.filter(item => query.params.includes(item.projectId)
      && (!query.sql.includes('"pipeline"') || query.params.includes(item.pipeline))
      && (!query.sql.includes('"substep"') || query.params.includes(item.substep)));
  } }) }) } as unknown as NodePgDatabase;
  return { repository: new PostgresAgentThinkingRepository(db), queries };
}

test("subprocess lookup never reads another pipeline when its log is absent", async () => {
  const { repository, queries } = fixture([
    row("Data Ingestion", "Data Inspection", inspection),
    row("Data Ingestion", "Hierarchy Mapper", inspection),
  ]);
  assert.equal(await repository.getThinking("p1", "Feature Engineering", "Hierarchy Mapper"), undefined);
  assert.ok(queries.length > 0);
  for (const query of queries) {
    assert.match(query.sql, /"pipeline"/);
    assert.ok(query.params.includes("Feature Engineering"));
  }
});

test("subprocess lookup returns only the requested process logs", async () => {
  const { repository } = fixture([
    row("Data Ingestion", "Data Inspection", inspection),
    row("Feature Engineering", "Hierarchy Mapper"),
  ]);
  assert.deepEqual((await repository.getThinking("p1", "Feature Engineering", "Hierarchy Mapper"))?.thinking, hierarchy);
});

test("pipeline log retrieval applies the requested pipeline scope", async () => {
  const { repository, queries } = fixture([
    row("Data Ingestion", "Data Inspection", inspection),
    row("Feature Engineering", "Hierarchy Mapper"),
  ]);
  const logs = await repository.getAllThinking("p1", "Feature Engineering");
  assert.deepEqual(logs.hierarchyMapperNode, hierarchy);
  assert.equal(logs.inspect, undefined);
  assert.match(queries[0].sql, /"pipeline"/);
});

test("subprocess API requires a pipeline and makes one scoped lookup", async () => {
  const calls: string[][] = [];
  const service = { getThinking: async (...identity: string[]) => { calls.push(identity); return undefined; } } as unknown as IAgentThinkingService;
  const controller = new AIController({} as IIngestionAgentService, service);
  let status = 200;
  let body: unknown;
  const response = {
    status: (code: number) => { status = code; return response; },
    json: (value: unknown) => { body = value; return response; },
  } as unknown as Response;
  await controller.getThinking({ query: { projectId: "p1", substep: "Hierarchy Mapper" } } as unknown as Request, response);
  assert.equal(status, 400);
  assert.deepEqual(calls, []);
  await controller.getThinking({ query: { projectId: "p1", pipeline: "Feature Engineering", substep: "Hierarchy Mapper" } } as unknown as Request, response);
  assert.deepEqual(calls, [["p1", "Feature Engineering", "Hierarchy Mapper"]]);
  assert.deepEqual(body, { success: true, data: { thinking: [] } });
});
