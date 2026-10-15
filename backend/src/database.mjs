import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Apply versioned, transactional migrations to the existing authentication database. */
export function openAuthDatabase(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const filename of readdirSync(migrationsDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check under the write lock so concurrent application processes do not
      // both attempt to apply a migration which was initially absent.
      if (db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(filename)) {
        db.exec('COMMIT');
        continue;
      }
      db.exec(readFileSync(path.join(migrationsDirectory, filename), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(filename, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
