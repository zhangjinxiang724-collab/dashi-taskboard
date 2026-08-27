#!/usr/bin/env node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createConsistentDatabaseBackup } from "../server/database-backup.mjs";

const [, , databaseArgument, backupDirectoryArgument] = process.argv;
if (!databaseArgument) {
  console.error("Usage: node scripts/backup-research-os.mjs <database-path> [backup-directory]");
  process.exitCode = 1;
} else {
  const databasePath = path.resolve(databaseArgument);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const backupPath = createConsistentDatabaseBackup(database, {
      databasePath,
      backupDirectory: backupDirectoryArgument
        ? path.resolve(backupDirectoryArgument)
        : undefined,
      label: "manual",
    });
    console.log(backupPath);
  } finally {
    database.close();
  }
}
