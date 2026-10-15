import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { checkAndCreateDatabase, initializeApplicationData, pool } from "../db";

test("data initialization logs and propagates the original database failure", async (t) => {
  const failure = new Error("Permission denied during data initialization");
  t.mock.method(pool, "query", async () => { throw failure; });
  const log = t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  await assert.rejects(initializeApplicationData, error => error === failure);
  assert.equal(log.mock.calls[0].arguments[1], failure);
});

test("database verification failures reach the startup caller", async (t) => {
  const failure = new Error("Database authentication failed");
  t.mock.method(Client.prototype, "connect", async () => { throw failure; });
  const close = t.mock.method(Client.prototype, "end", async () => {});
  const log = t.mock.method(console, "error", () => {});
  await assert.rejects(checkAndCreateDatabase, error => error === failure);
  assert.equal(log.mock.calls[0].arguments[1], failure);
  assert.equal(close.mock.callCount(), 1);
});

test("database verification performs no application schema initialization", async (t) => {
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ exists: 1 }] }) as any);
  t.mock.method(Client.prototype, "end", async () => {});
  const appQuery = t.mock.method(pool, "query", async () => { throw new Error("Verification must not create tables"); });
  t.mock.method(console, "log", () => {});
  await checkAndCreateDatabase();
  assert.equal(appQuery.mock.callCount(), 0);
});
