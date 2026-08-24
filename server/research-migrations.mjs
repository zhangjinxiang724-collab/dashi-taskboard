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
];

export function applyResearchMigrations(database) {
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
    for (const migration of RESEARCH_MIGRATIONS) {
      if (hasMigration.get(migration.version)) continue;
      migration.up(database);
      recordMigration.run(migration.version, new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
