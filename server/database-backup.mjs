import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function safeLabel(value) {
  return String(value || "manual").replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function createConsistentDatabaseBackup(
  database,
  { databasePath, backupDirectory, label = "manual" } = {},
) {
  if (!databasePath || databasePath === ":memory:") {
    throw new Error("A file-backed SQLite database path is required for backup");
  }

  const destinationDirectory = backupDirectory
    ? path.resolve(backupDirectory)
    : path.join(path.dirname(path.resolve(databasePath)), "backups");
  mkdirSync(destinationDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const backupPath = path.join(
    destinationDirectory,
    `${path.basename(databasePath)}.${safeLabel(label)}-${timestamp}-${process.pid}-${randomUUID()}.sqlite`,
  );

  database.prepare("VACUUM INTO ?").run(backupPath);

  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    backup.prepare("SELECT 1").get();
    const violation = backup.prepare("PRAGMA foreign_key_check").get();
    if (violation) {
      throw new Error(`Backup contains a foreign key violation in '${violation.table}'`);
    }
  } finally {
    backup.close();
  }

  return backupPath;
}
