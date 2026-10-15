import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { runMigrations } from "../db";

async function fixture(run: (pool: Pool, schema: string) => Promise<void>) {
  const options = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
  };
  const admin = new Pool(options);
  const schema = `migration_test_${randomBytes(8).toString("hex")}`;
  let scoped: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    scoped = new Pool({ ...options, options: `-c search_path=${schema}`, max: 2 });
    await run(scoped, schema);
  } finally {
    await scoped?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}_journal" CASCADE`);
    await admin.end();
  }
}

test("fresh database receives all application tables and an immutable migration history", async () => {
  await fixture(async (pool, schema) => {
    await runMigrations(pool, `${schema}_journal`);
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [schema]);
    assert.equal(tables.rows.length, 17);
    assert.ok(tables.rows.some(row => row.tablename === "sparrow_chat_messages"));
    assert.ok(tables.rows.some(row => row.tablename === "sparrow_chat_sessions"));
    assert.ok(tables.rows.some(row => row.tablename === "domains"));
    assert.equal((await pool.query("SELECT COUNT(*) FROM sparrow_intents")).rows[0].count, "13");
    await pool.query("UPDATE sparrow_intents SET description = 'Operator edit' WHERE code = 'ANALYZE'");
    await runMigrations(pool, `${schema}_journal`);
    assert.equal((await pool.query(`SELECT COUNT(*) FROM "${schema}_journal".__application_migrations`)).rows[0].count, "2");
    assert.equal((await pool.query("SELECT description FROM sparrow_intents WHERE code = 'ANALYZE'")).rows[0].description, "Operator edit");
  });
});

test("legacy tables are adopted, missing fields added and business records preserved", async () => {
  await fixture(async (pool, schema) => {
    await pool.query(`CREATE TABLE workspaces (id varchar(50) PRIMARY KEY, name varchar(100) NOT NULL UNIQUE, is_default boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now());
      INSERT INTO workspaces (id, name) VALUES ('w1', 'Existing business');
      CREATE TABLE projects (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL, workspace_id varchar(50) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE);
      INSERT INTO projects (id, name, workspace_id) VALUES ('p1', 'Existing project', 'w1');
      CREATE TABLE customer_records (id integer PRIMARY KEY, value text);
      INSERT INTO customer_records VALUES (1, 'Preserve me');`);
    await runMigrations(pool, `${schema}_journal`);
    const project = (await pool.query("SELECT * FROM projects WHERE id = 'p1'")).rows[0];
    assert.equal(project.name, "Existing project");
    assert.equal(project.role, "OWNER");
    assert.equal((await pool.query("SELECT character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'workspaces' AND column_name = 'name'", [schema])).rows[0].character_maximum_length, 255);
    assert.ok("domain" in project && "folder_path" in project && "status" in project);
    assert.equal((await pool.query("SELECT value FROM customer_records")).rows[0].value, "Preserve me");
    assert.equal((await pool.query("SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'f'")).rows[0].count, "1");
  });
});

test("incompatible legacy schema rolls back and does not record a successful migration", async (t) => {
  await fixture(async (pool, schema) => {
    await pool.query("CREATE TABLE workspaces (id integer PRIMARY KEY); INSERT INTO workspaces VALUES (7)");
    t.mock.method(console, "error", () => {});
    await assert.rejects(() => runMigrations(pool, `${schema}_journal`), error => {
      assert.match(String((error as any).cause?.message || error), /Baseline mismatch/);
      return true;
    });
    assert.equal((await pool.query("SELECT id FROM workspaces")).rows[0].id, 7);
    assert.equal((await pool.query(`SELECT COUNT(*) FROM "${schema}_journal".__application_migrations`)).rows[0].count, "0");
    assert.equal((await pool.query("SELECT to_regclass('sparrow_intents') AS table_name")).rows[0].table_name, null);
  });
});

test("simultaneous startup migrations serialize and record the baseline once", async () => {
  await fixture(async (pool, schema) => {
    await Promise.all([runMigrations(pool, `${schema}_journal`), runMigrations(pool, `${schema}_journal`)]);
    assert.equal((await pool.query(`SELECT COUNT(*) FROM "${schema}_journal".__application_migrations`)).rows[0].count, "2");
  });
});
