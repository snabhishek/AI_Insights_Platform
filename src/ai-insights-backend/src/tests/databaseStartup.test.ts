import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { checkAndCreateDatabase, initializeDatabaseSchemas, pool, runMigrations } from "../db";

test("schema initialization logs and propagates the original database failure", async (t) => {
  const failure = new Error("Permission denied during schema initialization");
  t.mock.method(pool, "query", async () => { throw failure; });
  const log = t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  await assert.rejects(initializeDatabaseSchemas, (error) => error === failure);
  assert.equal(log.mock.calls[0].arguments[1], failure);
});

test("database verification failures reach the startup caller", async (t) => {
  const failure = new Error("Database authentication failed");
  t.mock.method(Client.prototype, "connect", async () => { throw failure; });
  const close = t.mock.method(Client.prototype, "end", async () => {});
  const log = t.mock.method(console, "error", () => {});
  await assert.rejects(checkAndCreateDatabase, (error) => error === failure);
  assert.equal(log.mock.calls[0].arguments[1], failure);
  assert.equal(close.mock.callCount(), 1);
});

test("migration errors containing Failed query are not reported as already initialized", async (t) => {
  const failure = Object.assign(new Error("Failed query: CREATE TABLE test"), { cause: { code: "42501" } });
  const log = t.mock.method(console, "error", () => {});
  const db = { dialect: { migrate: async () => { throw failure; } }, session: {} };
  await assert.rejects(() => runMigrations(db as any), (error) => error === failure);
  assert.equal(log.mock.calls[0].arguments[1], failure);
});
