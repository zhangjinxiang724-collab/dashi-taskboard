import { createConsistentDatabaseBackup } from "./database-backup.mjs";

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
  {
    version: "003_research_records",
    up(database) {
      database.exec(`
        CREATE TABLE research_records (
          id TEXT PRIMARY KEY,
          primary_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          provider TEXT NOT NULL,
          kind TEXT NOT NULL,
          url TEXT,
          external_id TEXT,
          summary TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          occurred_at TEXT NOT NULL,
          capture_adapter TEXT NOT NULL DEFAULT 'manual-v1',
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE research_record_tasks (
          record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (record_id, task_id)
        );

        CREATE INDEX research_records_topic_occurred
          ON research_records(primary_topic_id, occurred_at DESC, id);
        CREATE INDEX research_records_provider_external
          ON research_records(provider, external_id);
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

export function applyResearchMigrations(database, { databasePath } = {}) {
  const applied = appliedVersions(database);
  const pending = RESEARCH_MIGRATIONS.filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) return { backupPath: null, applied: [] };

  const backupPath = databasePath && databasePath !== ":memory:"
    ? createConsistentDatabaseBackup(database, {
      databasePath,
      label: `before-research-${pending[0].version}`,
    })
    : null;
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
