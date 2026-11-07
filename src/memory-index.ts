import type { Store } from "./store.ts";

// Deterministic random-hyperplane LSH. This is approximate candidate generation,
// not an exact nearest-neighbour claim. Cosine/relevance gating follows lookup.
const BANDS = 24, BITS = 8;
const planes = new Map<number, Float32Array>();
function projections(dim: number) {
  let p = planes.get(dim);
  if (!p) {
    p = new Float32Array(BANDS * BITS * dim);
    let state = 0x6d2b79f5;
    for (let i = 0; i < p.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      p[i] = (state >>> 0) / 0xffffffff - 0.5;
    }
    planes.set(dim, p);
  }
  return p;
}
export function vectorBuckets(vector: number[], probe = false) {
  if (!vector.length || vector.length > 8192 || vector.some(x => !Number.isFinite(x))) return [];
  const p = projections(vector.length), keys: number[] = [];
  for (let band = 0; band < BANDS; band++) {
    let code = 0;
    for (let bit = 0; bit < BITS; bit++) {
      let dot = 0, offset = (band * BITS + bit) * vector.length;
      for (let d = 0; d < vector.length; d++) dot += vector[d]! * p[offset + d]!;
      if (dot >= 0) code |= 1 << bit;
    }
    keys.push(band * 256 + code);
    if (probe) for (let bit = 0; bit < BITS; bit++) keys.push(band * 256 + (code ^ (1 << bit)));
  }
  return keys;
}
const STOP = new Set("a an the is are was were be been do does did what which who how when where why can could would should will please tell me about for of to in on at with and or it its this that my your i we you have has had she he they them their those these preference preferences".split(" "));
export function queryTerms(query: string) {
  return [...new Set(query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])]
    .filter(t => t.length > 1 && !STOP.has(t)).slice(0, 32);
}
export function installMemoryIndex(s: Store) {
  s.db.function("atlas_memory_buckets", { deterministic: true }, (raw: any) => {
    try { return JSON.stringify(vectorBuckets(JSON.parse(raw))); } catch { return "[]"; }
  });
  s.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(subject,predicate,object,content='memories',content_rowid='rowid',tokenize='porter unicode61');
    CREATE TABLE IF NOT EXISTS memory_vector_buckets(memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL,scope TEXT NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,bucket INTEGER NOT NULL,PRIMARY KEY(memory_id,bucket));
    CREATE INDEX IF NOT EXISTS memory_bucket_lookup ON memory_vector_buckets(workspace_id,scope,model,dimensions,bucket,memory_id);
    CREATE TABLE IF NOT EXISTS memory_index_meta(version INTEGER PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS memory_search_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memory_search(rowid,subject,predicate,object) VALUES(new.rowid,new.subject,new.predicate,new.object);
      INSERT INTO memory_vector_buckets SELECT new.id,new.workspace_id,new.scope,new.embedding_model,json_array_length(new.embedding_json),value FROM json_each(atlas_memory_buckets(new.embedding_json));
    END;
    CREATE TRIGGER IF NOT EXISTS memory_search_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memory_search(memory_search,rowid,subject,predicate,object) VALUES('delete',old.rowid,old.subject,old.predicate,old.object);
      DELETE FROM memory_vector_buckets WHERE memory_id=old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS memory_search_update AFTER UPDATE OF subject,predicate,object,embedding_json,embedding_model,scope ON memories BEGIN
      INSERT INTO memory_search(memory_search,rowid,subject,predicate,object) VALUES('delete',old.rowid,old.subject,old.predicate,old.object);
      INSERT INTO memory_search(rowid,subject,predicate,object) VALUES(new.rowid,new.subject,new.predicate,new.object);
      DELETE FROM memory_vector_buckets WHERE memory_id=old.id;
      INSERT INTO memory_vector_buckets SELECT new.id,new.workspace_id,new.scope,new.embedding_model,json_array_length(new.embedding_json),value FROM json_each(atlas_memory_buckets(new.embedding_json));
    END;
    CREATE INDEX IF NOT EXISTS memory_subject_lookup ON memories(workspace_id,scope,subject_id,recorded_from);
    CREATE INDEX IF NOT EXISTS memory_label_lookup ON memories(workspace_id,scope,subject,importance);
    CREATE INDEX IF NOT EXISTS memory_lower_subject ON memories(workspace_id,scope,lower(subject));
    CREATE INDEX IF NOT EXISTS memory_change_lookup ON memory_changes(target_id,recorded_at);
    CREATE INDEX IF NOT EXISTS memory_thread_lookup ON memory_events(workspace_id,agent_id,thread_id,accepted_at);
    CREATE TABLE IF NOT EXISTS memory_chunk_progress(event_pk TEXT PRIMARY KEY REFERENCES memory_events(id),offset_chars INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_curation_metrics(job_id TEXT NOT NULL,event_pk TEXT NOT NULL,chunk_start INTEGER NOT NULL,chunk_end INTEGER NOT NULL,input_tokens INTEGER NOT NULL,input_bytes INTEGER NOT NULL,candidate_count INTEGER NOT NULL,recent_count INTEGER NOT NULL,decision_count INTEGER NOT NULL,elapsed_ms REAL NOT NULL,created_at TEXT NOT NULL);
  `);
  if (!s.one("SELECT 1 FROM memory_index_meta WHERE version=1")) {
    s.db.exec(`INSERT INTO memory_search(memory_search) VALUES('rebuild');
      INSERT OR IGNORE INTO memory_vector_buckets SELECT m.id,m.workspace_id,m.scope,m.embedding_model,json_array_length(m.embedding_json),b.value FROM memories m,json_each(atlas_memory_buckets(m.embedding_json)) b;
      INSERT INTO memory_index_meta VALUES(1);`);
  }
}
export function indexedCandidates(s: Store, workspace: string, scopes: string[], query: string, vector?: number[], model?: string, limit = 96) {
  if (!scopes.length) return [];
  const slots = scopes.map(() => "?").join(","), ids = new Set<string>(), ts = queryTerms(query);
  if (ts.length) {
    const match = ts.map(t => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    for (const r of s.all(`SELECT m.id FROM memory_search JOIN memories m ON m.rowid=memory_search.rowid WHERE memory_search MATCH ? AND m.workspace_id=? AND m.scope IN (${slots}) ORDER BY bm25(memory_search),m.id LIMIT ?`, match, workspace, ...scopes, limit)) ids.add(r.id);
  }
  if (vector?.length && model) {
    // Indexed multi-probe lookup. Only bounded IDs are materialized; neither
    // embeddings nor source payloads are read for the full authorized corpus.
    const buckets = vectorBuckets(vector, true);
    for (const r of s.all(`SELECT b.memory_id,COUNT(*) AS hits FROM memory_vector_buckets b JOIN memories m ON m.id=b.memory_id WHERE b.workspace_id=? AND b.scope IN (${slots}) AND b.model=? AND b.dimensions=? AND b.bucket IN (${buckets.map(() => "?").join(",")}) GROUP BY b.memory_id ORDER BY hits DESC,MAX(m.importance) DESC,b.memory_id LIMIT ?`, workspace, ...scopes, model, vector.length, ...buckets, limit)) ids.add(r.memory_id);
  }
  if (!ids.size) return [];
  return s.all(`SELECT * FROM memories WHERE workspace_id=? AND scope IN (${slots}) AND id IN (${[...ids].map(() => "?").join(",")})`, workspace, ...scopes, ...ids);
}
