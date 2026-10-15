const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { readMigrationFiles } = require("drizzle-orm/migrator");

function validateMigrationFiles(folder) {
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
  assert.equal(journal.dialect, "postgresql", `${folder}: unsupported dialect`);
  assert.ok(journal.entries.length > 0, `${folder}: empty migration journal`);
  let previousTimestamp = -1;
  let previousSnapshotId = "00000000-0000-0000-0000-000000000000";
  const expectedFiles = new Set();
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, index, `${folder}: migration index gap`);
    assert.ok(Number.isSafeInteger(entry.when) && entry.when > previousTimestamp, `${entry.tag}: invalid timestamp ordering`);
    assert.ok(new RegExp(`^${String(index).padStart(4, "0")}_[a-z][a-z0-9_]+$`).test(entry.tag), `${entry.tag}: expected NNNN_descriptive_purpose`);
    expectedFiles.add(`${entry.tag}.sql`);
    assert.ok(readFileSync(join(folder, `${entry.tag}.sql`), "utf8").trim(), `${entry.tag}: empty SQL`);
    const snapshot = JSON.parse(readFileSync(join(folder, `meta/${String(index).padStart(4, "0")}_snapshot.json`), "utf8"));
    assert.equal(snapshot.dialect, journal.dialect, `${entry.tag}: snapshot dialect mismatch`);
    assert.equal(snapshot.prevId, previousSnapshotId, `${entry.tag}: broken snapshot chain`);
    previousSnapshotId = snapshot.id;
    previousTimestamp = entry.when;
  }
  const actualFiles = new Set(readdirSync(folder).filter(name => name.endsWith(".sql")));
  assert.deepEqual(actualFiles, expectedFiles, `${folder}: SQL files and journal entries differ`);
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  assert.equal(migrations.length, journal.entries.length);
  for (const [index, migration] of migrations.entries()) {
    assert.ok(migration.sql.some(statement => statement.trim()), `${journal.entries[index].tag}: no SQL statements`);
  }
  return { journal, migrations };
}

module.exports = { validateMigrationFiles };

if (require.main === module) {
  const backend = resolve(__dirname, "..");
  try {
    for (const [label, folder] of [
      ["Active", join(backend, "src/db/migrations/sql")],
      ["Retired", join(backend, "drizzle")],
    ]) {
      if (!existsSync(folder)) continue;
      const { migrations } = validateMigrationFiles(folder);
      console.log(`[Migrations] ${label}: ${migrations.length} SQL files, journal ordering and snapshot chain verified.`);
    }
    console.log("[Migrations] File validation completed. Use the PostgreSQL migration tests to verify execution.");
  } catch (error) {
    console.error(`[Migrations] Validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
