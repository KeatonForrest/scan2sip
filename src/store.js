// One local SQLite file via the built-in node:sqlite module.
// Tables: catalog wines, scan observations, idempotent scan requests
// (including retained timeout reservations), and deduplicated demand.

import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wines (
        id TEXT PRIMARY KEY,
        producer TEXT NOT NULL,
        name TEXT NOT NULL,
        vintage INTEGER,
        identification_aliases TEXT NOT NULL DEFAULT '[]',
        fields TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        fixture_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scan_requests (
        request_id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS demands (
        subject_key TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        producer TEXT,
        name TEXT,
        vintage INTEGER,
        contributions INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (subject_key, utc_day)
      );
    `);
  }

  seedWines(wines) {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO wines (id, producer, name, vintage, identification_aliases, fields)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const w of wines) {
      stmt.run(w.id, w.producer, w.name, w.vintage ?? null,
        JSON.stringify(w.identification_aliases ?? []), JSON.stringify(w.fields ?? {}));
    }
  }

  listWines() {
    return this.db.prepare('SELECT * FROM wines ORDER BY producer, name, vintage').all()
      .map((r) => ({
        id: r.id, producer: r.producer, name: r.name, vintage: r.vintage,
        identification_aliases: JSON.parse(r.identification_aliases),
        fields: JSON.parse(r.fields),
      }));
  }

  getWine(id) {
    return this.listWines().find((w) => w.id === id) ?? null;
  }

  wineCount() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM wines').get().n;
  }

  getRequest(requestId) {
    const row = this.db.prepare('SELECT * FROM scan_requests WHERE request_id = ?').get(requestId);
    return row ? { ...row, result: JSON.parse(row.result) } : null;
  }

  recordRequest({ request_id, fixture_id, status, result, created_at }) {
    this.db.prepare(
      'INSERT INTO scan_requests (request_id, fixture_id, status, result, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(request_id, fixture_id, status, JSON.stringify(result), created_at);
    this.db.prepare(
      'INSERT INTO observations (request_id, fixture_id, status, created_at) VALUES (?, ?, ?, ?)',
    ).run(request_id, fixture_id, status, created_at);
  }

  observationCount() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  }

  /** One contribution per canonical subject per UTC day. */
  addDemand({ subject_key, utc_day, producer, name, vintage }) {
    const existing = this.db.prepare(
      'SELECT * FROM demands WHERE subject_key = ? AND utc_day = ?',
    ).get(subject_key, utc_day);
    if (existing) return { created: false, demand: existing };
    this.db.prepare(
      'INSERT INTO demands (subject_key, utc_day, producer, name, vintage) VALUES (?, ?, ?, ?, ?)',
    ).run(subject_key, utc_day, producer, name, vintage ?? null);
    return {
      created: true,
      demand: this.db.prepare('SELECT * FROM demands WHERE subject_key = ? AND utc_day = ?')
        .get(subject_key, utc_day),
    };
  }

  listDemands() {
    return this.db.prepare('SELECT * FROM demands ORDER BY utc_day, subject_key').all();
  }

  /** Disposable fixture workspace: clear runtime state and reseed. */
  reset(wines) {
    this.db.exec('DELETE FROM observations; DELETE FROM scan_requests; DELETE FROM demands; DELETE FROM wines;');
    this.seedWines(wines);
  }

  close() {
    this.db.close();
  }
}
