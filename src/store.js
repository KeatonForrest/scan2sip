// One local SQLite file via the built-in node:sqlite module.
// Tables: catalog wines, scan observations, idempotent scan requests
// (including retained timeout reservations), and deduplicated demand.

import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    // Disposable fixture workspace: an older local wines table without
    // the dedup key is dropped and reseeded rather than migrated.
    const wineCols = this.db.prepare("PRAGMA table_info(wines)").all().map((r) => r.name);
    if (wineCols.length && !wineCols.includes('dedup_key')) this.db.exec('DROP TABLE wines');
    const knowledgeCols = this.db.prepare("PRAGMA table_info(knowledge_rows)").all().map((r) => r.name);
    if (knowledgeCols.length && !knowledgeCols.includes('classification')) this.db.exec('DROP TABLE knowledge_rows');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wines (
        id TEXT PRIMARY KEY,
        producer TEXT NOT NULL,
        name TEXT NOT NULL,
        vintage INTEGER,
        dedup_key TEXT UNIQUE,
        revision INTEGER NOT NULL DEFAULT 1,
        identification_aliases TEXT NOT NULL DEFAULT '[]',
        fields TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        artifact_sha256 TEXT UNIQUE NOT NULL,
        document_id TEXT NOT NULL,
        status TEXT NOT NULL,
        artifact TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        review_digest TEXT PRIMARY KEY,
        artifact_sha256 TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        classification TEXT NOT NULL,
        review TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publications (
        plan_digest TEXT PRIMARY KEY,
        artifact_sha256 TEXT NOT NULL,
        wine_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        changed INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS knowledge_rows (
        wine_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        field TEXT NOT NULL,
        value TEXT,
        source_id TEXT,
        quote TEXT,
        classification TEXT,
        PRIMARY KEY (wine_id, revision, field)
      );
      CREATE TABLE IF NOT EXISTS stage_requests (
        request_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publication_requests (
        request_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_requests (
        request_id TEXT PRIMARY KEY, binding_digest TEXT NOT NULL, result TEXT NOT NULL
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
      `INSERT OR IGNORE INTO wines (id, producer, name, vintage, dedup_key, revision, identification_aliases, fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const w of wines) {
      stmt.run(w.id, w.producer, w.name, w.vintage ?? null, w.dedup_key ?? null, w.revision ?? 1,
        JSON.stringify(w.identification_aliases ?? []), JSON.stringify(w.fields ?? {}));
    }
  }

  insertWine(wine) {
    this.db.prepare(
      `INSERT INTO wines (id, producer, name, vintage, dedup_key, revision, identification_aliases, fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(wine.id, wine.producer, wine.name, wine.vintage ?? null, wine.dedup_key, wine.revision ?? 1,
      JSON.stringify(wine.identification_aliases ?? []), JSON.stringify(wine.fields ?? {}));
  }

  getWineByDedupKey(dedupKey) {
    const row = this.db.prepare('SELECT * FROM wines WHERE dedup_key = ?').get(dedupKey);
    return row ? this.#wineRow(row) : null;
  }

  #wineRow(r) {
    return {
      id: r.id, producer: r.producer, name: r.name, vintage: r.vintage,
      dedup_key: r.dedup_key, revision: r.revision,
      identification_aliases: JSON.parse(r.identification_aliases),
      fields: JSON.parse(r.fields),
    };
  }

  replaceKnowledge(wineId, revision, rows) {
    this.db.prepare('DELETE FROM knowledge_rows WHERE wine_id = ? AND revision = ?').run(wineId, revision);
    const stmt = this.db.prepare(
      'INSERT INTO knowledge_rows (wine_id, revision, field, value, source_id, quote, classification) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      stmt.run(wineId, revision, row.field, row.value ?? null, row.source_id ?? null, row.quote ?? null, row.classification ?? null);
    }
  }

  getKnowledge(wineId, revision) {
    return this.db.prepare('SELECT * FROM knowledge_rows WHERE wine_id = ? AND revision = ? ORDER BY field')
      .all(wineId, revision);
  }

  saveArtifact(artifact) {
    this.db.prepare(
      'INSERT OR IGNORE INTO artifacts (artifact_id, artifact_sha256, document_id, status, artifact) VALUES (?, ?, ?, ?, ?)',
    ).run(artifact.artifact_id, artifact.artifact_sha256, artifact.document_id, artifact.status, JSON.stringify(artifact));
  }

  getArtifact(artifactId) {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId);
    return row ? JSON.parse(row.artifact) : null;
  }

  saveReview(review) {
    this.db.prepare(
      'INSERT OR REPLACE INTO reviews (review_digest, artifact_sha256, plan_digest, classification, review) VALUES (?, ?, ?, ?, ?)',
    ).run(review.review_digest, review.artifact_sha256, review.plan_digest, review.classification, JSON.stringify(review));
  }

  getReview(artifactSha256) {
    const rows = this.getReviews(artifactSha256);
    return rows.length === 1 ? rows[0] : null;
  }

  getReviews(artifactSha256) {
    return this.db.prepare('SELECT * FROM reviews WHERE artifact_sha256 = ? ORDER BY review_digest')
      .all(artifactSha256).map((r) => JSON.parse(r.review));
  }

  getReviewByDigest(reviewDigest) {
    const row = this.db.prepare('SELECT * FROM reviews WHERE review_digest = ?').get(reviewDigest);
    return row ? JSON.parse(row.review) : null;
  }

  getPublicationByPlan(planDigest) {
    return this.db.prepare('SELECT * FROM publications WHERE plan_digest = ?').get(planDigest) ?? null;
  }

  getPublicationByArtifact(artifactSha256) {
    return this.db.prepare('SELECT * FROM publications WHERE artifact_sha256 = ?').get(artifactSha256) ?? null;
  }

  recordPublication({ plan_digest, artifact_sha256, wine_id, revision, status, changed }) {
    this.db.prepare(
      'INSERT INTO publications (plan_digest, artifact_sha256, wine_id, revision, status, changed) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(plan_digest, artifact_sha256, wine_id, revision, status, changed ? 1 : 0);
  }

  getBoundRequest(table, requestId) {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE request_id = ?`).get(requestId);
    return row ?? null;
  }

  recordBoundRequest(table, requestId, binding, result) {
    const columns = {
      stage_requests: 'document_id', publication_requests: 'artifact_id', chat_requests: 'binding_digest',
    }[table];
    this.db.prepare(`INSERT INTO ${table} (request_id, ${columns}, result) VALUES (?, ?, ?)`)
      .run(requestId, binding, JSON.stringify(result));
  }

  /** Run fn inside a single SQLite transaction; roll back on any throw. */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  listWines() {
    return this.db.prepare('SELECT * FROM wines ORDER BY producer, name, vintage').all()
      .map((r) => this.#wineRow(r));
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
    this.db.exec(`DELETE FROM observations; DELETE FROM scan_requests; DELETE FROM demands;
      DELETE FROM artifacts; DELETE FROM reviews; DELETE FROM publications; DELETE FROM knowledge_rows;
      DELETE FROM stage_requests; DELETE FROM publication_requests; DELETE FROM chat_requests; DELETE FROM wines;`);
    this.seedWines(wines);
  }

  close() {
    this.db.close();
  }
}
