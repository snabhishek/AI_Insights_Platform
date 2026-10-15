const { cpSync, mkdirSync, readdirSync, unlinkSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { validateMigrationFiles } = require("./validate-migrations.cjs");

const source = resolve(__dirname, "../src/db/migrations/sql");
const { journal } = validateMigrationFiles(source);
const currentFiles = new Set(journal.entries.map(entry => `${entry.tag}.sql`));
const destination = resolve(__dirname, "../dist/db/migrations/sql");
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
// Remove obsolete SQL names left by earlier builds after a migration is renamed.
for (const entry of readdirSync(destination, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql") && !currentFiles.has(entry.name)) {
    unlinkSync(join(destination, entry.name));
  }
}
validateMigrationFiles(destination);
