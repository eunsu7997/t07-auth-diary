import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Parameter, Result, Statement } from './db.ts';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export class LocalDatabase implements Database {
  readonly sqlite: DatabaseSync;
  constructor(path = resolve(projectRoot, '.data/t07.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path, { timeout: 5000 });
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    try { this.migrate(); } catch (error) { this.sqlite.close(); throw error; }
  }
  private migrate() {
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
    const directory = resolve(projectRoot, 'migrations');
    for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
      if (this.sqlite.prepare('SELECT name FROM _migrations WHERE name = ?').get(name)) continue;
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        this.sqlite.exec(readFileSync(resolve(directory, name), 'utf8'));
        this.sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
        this.sqlite.exec('COMMIT');
      } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    }
  }
  async all<T>(sql: string, params: Parameter[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
  async batch(statements: Statement[]): Promise<Result[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, params = [] }) => {
        const statement = this.sqlite.prepare(sql);
        if (statement.columns().length) {
          return { results: statement.all(...params), changes: 0 } as Result;
        }
        return { results: [], changes: Number(statement.run(...params).changes) };
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
