import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SNAPSHOT_ID = 1;

export function createSqlitePersistence(databasePath = ":memory:", { onSaveDiagnostic } = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspace_snapshots (
      id INTEGER PRIMARY KEY CHECK (id = ${SNAPSHOT_ID}),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS extension_catalog (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
      search_text TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
      value_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS extension_catalog_listing ON extension_catalog(kind, deleted_at, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS workspace_event_collections (name TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_event_rows (
      collection TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY(collection, id)
    ) STRICT;
  `);
  const loadSnapshot = database.prepare("SELECT state_json FROM workspace_snapshots WHERE id = ?");
  const saveSnapshot = database.prepare(`
    INSERT INTO workspace_snapshots (id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `);
  const readCollections = database.prepare("SELECT name FROM workspace_event_collections");
  const readEvents = database.prepare("SELECT id,position,value_json FROM workspace_event_rows WHERE collection=? ORDER BY position");
  const insertCollection = database.prepare("INSERT OR IGNORE INTO workspace_event_collections VALUES (?)");
  const removeCollection = database.prepare("DELETE FROM workspace_event_collections WHERE name=?");
  const removeEvents = database.prepare("DELETE FROM workspace_event_rows WHERE collection=?");
  const removeEvent = database.prepare("DELETE FROM workspace_event_rows WHERE collection=? AND id=?");
  const writeEvent = database.prepare("INSERT INTO workspace_event_rows VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET position=excluded.position,value_json=excluded.value_json");
  const readCatalog = database.prepare("SELECT value_json FROM extension_catalog ORDER BY created_at DESC,id");
  const writeCatalog = database.prepare("INSERT INTO extension_catalog VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,search_text=excluded.search_text,created_at=excluded.created_at,deleted_at=excluded.deleted_at,value_json=excluded.value_json");
  const deleteCatalog = database.prepare("DELETE FROM extension_catalog WHERE id=?");
  const catalogCount = database.prepare("SELECT COUNT(*) AS total FROM extension_catalog WHERE kind=? AND deleted_at IS NULL AND instr(search_text,?)>0");
  const catalogPage = database.prepare("SELECT value_json FROM extension_catalog WHERE kind=? AND deleted_at IS NULL AND instr(search_text,?)>0 ORDER BY created_at DESC,id LIMIT ? OFFSET ?");
  let catalogCache = new Map();
  let cached = new Map();

  return {
    load() {
      const row = loadSnapshot.get(SNAPSHOT_ID);
      if (!row) { cached = new Map(); return null; }
      const state = JSON.parse(row.state_json);
      const catalog = readCatalog.all().map(row => JSON.parse(row.value_json));
      if (catalog.length) state.extensionCatalog = catalog;
      catalogCache = new Map(catalog.map(entry => [entry.id, JSON.stringify(entry)]));
      const loaded = new Map();
      for (const { name } of readCollections.all()) {
        const entries = new Map();
        state[name] = readEvents.all(name).map((item) => {
          const value = JSON.parse(item.value_json);
          // Startup migrations may mutate loaded objects before the first save.
          // Compare against persisted JSON, not those mutable object references.
          entries.set(item.id, { json: item.value_json, position: item.position });
          return value;
        });
        loaded.set(name, entries);
      }
      cached = loaded;
      return state;
    },
    queryExtensions(kind, { search = '', page = 1, pageSize = 20 } = {}) {
      const query = search.trim().toLocaleLowerCase();
      const { total } = catalogCount.get(kind, query);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(page, totalPages);
      const items = catalogPage.all(kind, query, pageSize, (page - 1) * pageSize).map(row => JSON.parse(row.value_json));
      return { items, total, page, pageSize, totalPages, hasMore: page < totalPages };
    },
    save(state) {
      const observed = typeof onSaveDiagnostic === "function";
      const started = observed ? performance.now() : 0, phases = observed ? [] : null;
      let phase = null, phaseStarted = 0, count = 0;
      let outcome = "error", transactionOutcome = "not_started", transactionStarted = false;
      const finishPhase = (result = "success") => {
        if (!observed || phase === null) return;
        phases.push({ phase, elapsedMs: performance.now() - phaseStarted, count, outcome: result });
        phase = null;
      };
      const startPhase = (name) => {
        if (!observed) return;
        finishPhase(); phase = name; count = 0; phaseStarted = performance.now();
      };
      try {
        startPhase("diff");
        const snapshot = { ...state }, next = new Map(), writes = [], removals = [];
        for (const key of ["events", "communicationEvents"]) {
          if (!Array.isArray(state[key])) continue;
          delete snapshot[key];
          const old = cached.get(key) || new Map(), entries = new Map();
          state[key].forEach((value, position) => {
            if (typeof value.id !== "string" || entries.has(value.id)) throw new Error("Invalid persistent event identity");
            const previous = old.get(value.id);
            const json = previous?.value === value ? previous.json : JSON.stringify(value);
            entries.set(value.id, { value, json, position });
            if (!previous || previous.json !== json || previous.position !== position) writes.push([key, value.id, position, json]);
            if (observed) ++count;
          });
          for (const id of old.keys()) if (!entries.has(id)) removals.push([key, id]);
          next.set(key, entries);
        }
        const nextCatalog = new Map((state.extensionCatalog || []).map(entry => [entry.id, JSON.stringify(entry)]));
        delete snapshot.extensionCatalog;
        startPhase("serialize");
        const json = JSON.stringify(snapshot);
        if (observed) ++count;
        startPhase("begin");
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        if (observed) ++count;
        startPhase("reconcile");
        // A fresh adapter reconciles persisted rows before establishing its cache.
        const collections = readCollections.all();
        if (observed) ++count;
        for (const { name } of collections) if (!next.has(name) || !cached.has(name)) {
          removeEvents.run(name); if (observed) ++count;
          removeCollection.run(name); if (observed) ++count;
        }
        for (const key of next.keys()) { insertCollection.run(key); if (observed) ++count; }
        startPhase("delete");
        for (const args of removals) { removeEvent.run(...args); if (observed) ++count; }
        startPhase("upsert_events");
        for (const args of writes) { writeEvent.run(...args); if (observed) ++count; }
        for (const id of catalogCache.keys()) if (!nextCatalog.has(id)) deleteCatalog.run(id);
        for (const entry of state.extensionCatalog || []) if (catalogCache.get(entry.id) !== nextCatalog.get(entry.id)) {
          writeCatalog.run(entry.id, entry.kind, entry.name, `${entry.name} ${entry.description || ''}`.toLocaleLowerCase(), entry.createdAt, entry.deletedAt || null, nextCatalog.get(entry.id));
        }
        startPhase("upsert_snapshot");
        saveSnapshot.run(SNAPSHOT_ID, json, new Date().toISOString());
        if (observed) ++count;
        startPhase("commit");
        database.exec("COMMIT");
        transactionStarted = false;
        transactionOutcome = "committed";
        if (observed) ++count;
        cached = next; catalogCache = nextCatalog;
        outcome = "success";
        finishPhase();
      } catch (error) {
        finishPhase("error");
        if (transactionStarted) {
          startPhase("rollback");
          try {
            database.exec("ROLLBACK");
            transactionOutcome = "rolled_back";
            if (observed) ++count;
            finishPhase();
          } catch {
            transactionOutcome = "rollback_failed";
            finishPhase("error");
          }
        }
        throw error;
      } finally {
        if (observed) {
          const record = { operation: "save", outcome, elapsedMs: performance.now() - started, transactionOutcome, phases };
          // Diagnostics must never turn a committed save into a Store rollback.
          try { onSaveDiagnostic(record); } catch { /* Preserve the original save result. */ }
        }
      }
    },
    close() {
      database.close();
    }
  };
}
