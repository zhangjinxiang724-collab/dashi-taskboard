import { mkdirSync } from "node:fs";
import path from "node:path";

const RESEARCH_MIGRATIONS = [
  {
    version: "001_topic_task_core",
    up(database) {
      database.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'inbox', 'active', 'waiting', 'thesis_formed', 'tracking', 'archived'
          )),
          core_question TEXT NOT NULL DEFAULT '',
          current_view TEXT NOT NULL DEFAULT '',
          next_action TEXT NOT NULL DEFAULT '',
          labels TEXT NOT NULL DEFAULT '[]',
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE topic_tasks (
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (topic_id, task_id),
          UNIQUE (task_id)
        );

        CREATE INDEX topics_status_updated
          ON topics(status, updated_at DESC, id);
        CREATE INDEX topic_tasks_topic_created
          ON topic_tasks(topic_id, created_at, task_id);
      `);
    },
  },
  {
    version: "002_topic_current_state",
    up(database) {
      database.exec(`
        ALTER TABLE topics ADD COLUMN confidence_level TEXT
          CHECK (confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high'));
        ALTER TABLE topics ADD COLUMN review_trigger TEXT NOT NULL DEFAULT '';
        ALTER TABLE topics ADD COLUMN last_researched_at TEXT;

        CREATE TABLE topic_questions (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          question TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'resolved', 'dropped')),
          answer_or_note TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX topic_questions_topic_order
          ON topic_questions(topic_id, sort_order, id);
        CREATE INDEX topic_questions_topic_status
          ON topic_questions(topic_id, status, sort_order);
      `);
    },
  },
];

function appliedVersions(database) {
  const exists = database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'research_schema_migrations'
  `).get();
  if (!exists) return new Set();
  return new Set(database.prepare(`
    SELECT version FROM research_schema_migrations
  `).all().map((row) => row.version));
}

function createMigrationBackup(database, databasePath, nextVersion) {
  if (!databasePath || databasePath === ":memory:") return null;
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(databasePath)}.before-research-${nextVersion}-${timestamp}-${process.pid}.sqlite`,
  );
  database.prepare("VACUUM INTO ?").run(backupPath);
  return backupPath;
}

export function applyResearchMigrations(database, { databasePath } = {}) {
  const applied = appliedVersions(database);
  const pending = RESEARCH_MIGRATIONS.filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) return { backupPath: null, applied: [] };

  const backupPath = createMigrationBackup(database, databasePath, pending[0].version);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS research_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const hasMigration = database.prepare(`
      SELECT 1 FROM research_schema_migrations WHERE version = ?
    `);
    const recordMigration = database.prepare(`
      INSERT INTO research_schema_migrations (version, applied_at) VALUES (?, ?)
    `);
    for (const migration of pending) {
      if (hasMigration.get(migration.version)) continue;
      migration.up(database);
      recordMigration.run(migration.version, new Date().toISOString());
    }
    const violation = database.prepare("PRAGMA foreign_key_check").get();
    if (violation) {
      throw new Error(`Research migration produced a foreign key violation in '${violation.table}'`);
    }
    database.exec("COMMIT");
    return { backupPath, applied: pending.map((migration) => migration.version) };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
