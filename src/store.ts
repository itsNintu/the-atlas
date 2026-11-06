import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { schema, SCHEMA_VERSION } from "./schema.ts";
import { fail, object, text, timestamp } from "./errors.ts";

export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",")}}`;
  return JSON.stringify(value);
}
export type Actor = {
  id: string;
  workspace_id: string;
  is_admin: number;
  kind: string;
  name: string;
  credential_id: string;
};
export type Assertion = {
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to: string | null;
};
export function assertions(input: unknown, fallback: string): Assertion[] {
  if (!Array.isArray(input) || input.length > 256)
    fail(
      400,
      "invalid_assertions",
      "assertions must be an array of at most 256 explicit statements",
    );
  return (input as any[]).map((value) => {
    const a = object(value);
    const start = timestamp(a.valid_from ?? fallback, "valid_from");
    const end = a.valid_to == null ? null : timestamp(a.valid_to, "valid_to");
    if (end && end <= start)
      fail(
        400,
        "invalid_interval",
        "valid_to must be after valid_from (half-open interval)",
      );
    return {
      subject: text(a.subject, "subject", 512),
      predicate: text(a.predicate, "predicate", 256),
      object: text(a.object, "object", 4096),
      valid_from: start,
      valid_to: end,
    };
  });
}
export class Store {
  db: Database;
  constructor(public path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(path, { create: true });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;",
    );
    const version = (this.one("PRAGMA user_version") as any).user_version;
    if (version > SCHEMA_VERSION) {
      this.db.close();
      fail(
        500,
        "schema_too_new",
        "Upgrade ThreadAtlas before opening this database",
      );
    }
    this.transaction(() => {
      this.db.exec(schema);
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
  }
  all(sql: string, ...params: any[]): any[] {
    return this.db.query(sql).all(...params);
  }
  one(sql: string, ...params: any[]): any {
    return this.db.query(sql).get(...params);
  }
  run(sql: string, ...params: any[]) {
    return this.db.query(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  close() {
    this.db.close();
  }
  bootstrap(name: string) {
    return this.transaction(() => {
      const workspace_id = id("ws"),
        principal_id = id("prn"),
        at = now();
      this.run(
        "INSERT INTO workspaces VALUES (?,?,?)",
        workspace_id,
        text(name, "name"),
        at,
      );
      this.run(
        "INSERT INTO principals VALUES (?,?,?,?,?,?)",
        principal_id,
        workspace_id,
        "Local administrator",
        "human",
        1,
        at,
      );
      return { workspace_id, principal_id, ...this.issueKey(principal_id) };
    });
  }
  issueKey(principal_id: string) {
    if (!this.one("SELECT id FROM principals WHERE id=?", principal_id))
      fail(404, "not_found", "Principal not found");
    const token = "ta_" + randomBytes(32).toString("base64url"),
      credential_id = id("key");
    this.run(
      "INSERT INTO credentials VALUES (?,?,?,?,NULL)",
      credential_id,
      principal_id,
      hash(token),
      now(),
    );
    return { credential_id, token };
  }
  authenticate(token: string | undefined): Actor {
    if (!token) fail(401, "unauthorized", "Bearer credential required");
    const actor = this.one(
      "SELECT p.*,c.id AS credential_id FROM credentials c JOIN principals p ON p.id=c.principal_id WHERE c.token_hash=? AND c.revoked_at IS NULL",
      hash(token!),
    );
    if (!actor) fail(401, "unauthorized", "Invalid or revoked credential");
    return actor;
  }
  active(a: Actor) {
    if (
      !this.one(
        "SELECT id FROM credentials WHERE id=? AND principal_id=? AND revoked_at IS NULL",
        a.credential_id,
        a.id,
      )
    )
      fail(401, "unauthorized", "Credential was revoked during this request");
  }
  admin(a: Actor) {
    if (!a.is_admin)
      fail(403, "forbidden", "Workspace administration permission required");
  }
  space(a: Actor, space_id: string, action: string) {
    const s = this.one(
      "SELECT s.* FROM spaces s JOIN grants g ON g.space_id=s.id WHERE s.id=? AND s.workspace_id=? AND g.principal_id=? AND g.action=?",
      space_id,
      a.workspace_id,
      a.id,
      action,
    );
    if (!s) fail(404, "not_found", "Space not found or action not granted");
    return s;
  }
  source(a: Actor, source_id: string, action: string) {
    const s = this.one(
      "SELECT s.* FROM sources s JOIN grants g ON g.space_id=s.space_id WHERE s.id=? AND s.workspace_id=? AND g.principal_id=? AND g.action=?",
      source_id,
      a.workspace_id,
      a.id,
      action,
    );
    if (!s) fail(404, "not_found", "Source not found or action not granted");
    return s;
  }
  audit(a: Actor, request_id: string, operation: string, target?: string) {
    this.run(
      "INSERT INTO audit VALUES (?,?,?,?,?,?,?)",
      id("evt"),
      a.workspace_id,
      a.id,
      request_id,
      operation,
      target ?? null,
      now(),
    );
  }
  write(
    a: Actor,
    key: string,
    operation: string,
    body: any,
    request_id: string,
    authorize: () => void,
    act: () => any,
  ) {
    text(key, "Idempotency-Key", 200);
    return this.transaction(() => {
      this.active(a);
      authorize(); // Even an old replay must satisfy CURRENT grants and credentials.
      const request_hash = hash(canonical({ operation, body }));
      const previous = this.one(
        "SELECT * FROM idempotency WHERE principal_id=? AND key=?",
        a.id,
        key,
      );
      if (previous) {
        if (previous.request_hash !== request_hash)
          fail(
            409,
            "idempotency_conflict",
            "Key was already used for a different request",
          );
        return {
          ...JSON.parse(previous.response_json),
          idempotent_replay: true,
        };
      }
      const result = act();
      this.run(
        "INSERT INTO idempotency VALUES (?,?,?,?,?)",
        a.id,
        key,
        request_hash,
        JSON.stringify(result),
        now(),
      );
      this.audit(a, request_id, operation, result.id ?? result.source_id);
      return result;
    });
  }
  enqueue(source_id: string, revision_number: number, body: any) {
    const format = text(body.format, "format");
    if (!["text", "json", "messages"].includes(format))
      fail(400, "invalid_request", "format must be text, json or messages");
    const mode = body.mode ?? "assertions";
    if (!["assertions", "natural_language"].includes(mode))
      fail(
        400,
        "invalid_request",
        "mode must be assertions or natural_language",
      );
    const at = now(),
      source_timestamp = timestamp(body.source_timestamp, "source_timestamp");
    if (format === "text") text(body.payload, "payload", 200_000);
    if (format === "json") object(body.payload);
    if (format === "messages") {
      if (
        !Array.isArray(body.payload) ||
        !body.payload.length ||
        body.payload.length > 1000
      )
        fail(
          400,
          "invalid_request",
          "messages payload must be a nonempty array, at most 1000 messages",
        );
      for (const m of body.payload) {
        object(m);
        text(m.role, "role", 32);
        text(m.content, "content", 200_000);
        timestamp(m.timestamp, "message.timestamp");
      }
    }
    const payload_json = JSON.stringify(body.payload);
    if (payload_json.length > 250_000)
      fail(
        413,
        "payload_too_large",
        "Source payload exceeds 250000 UTF-16 units",
      );
    const explicit =
      mode === "assertions"
        ? assertions(body.assertions ?? [], source_timestamp)
        : [];
    if (mode === "natural_language" && body.assertions !== undefined)
      fail(
        400,
        "invalid_request",
        "Natural-language mode does not accept assertions",
      );
    const revision_id = id("rev"),
      job_id = id("job");
    this.run(
      "INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)",
      revision_id,
      source_id,
      revision_number,
      format,
      mode,
      source_timestamp,
      payload_json,
      mode === "assertions" ? JSON.stringify(explicit) : null,
      at,
    );
    this.run(
      "UPDATE sources SET current_revision_id=? WHERE id=?",
      revision_id,
      source_id,
    );
    this.run(
      "INSERT INTO jobs (id,revision_id,status,available_at,created_at) VALUES (?,?,'queued',?,?)",
      job_id,
      revision_id,
      Date.now(),
      at,
    );
    return {
      source_id,
      revision_id,
      revision_number,
      job_id,
      recorded_at: at,
      mode,
    };
  }
  forget(source_id: string, at: string) {
    this.run("UPDATE sources SET deleted_at=? WHERE id=?", at, source_id);
    this.run(
      "UPDATE revisions SET payload_json=NULL,assertions_json=NULL,deleted_at=? WHERE source_id=?",
      at,
      source_id,
    );
    this.run(
      "UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error_code=NULL WHERE revision_id IN (SELECT id FROM revisions WHERE source_id=?) AND status<>'succeeded'",
      source_id,
    );
    this.run(
      "DELETE FROM supports WHERE revision_id IN (SELECT id FROM revisions WHERE source_id=?)",
      source_id,
    );
    this.run(
      "DELETE FROM facts WHERE NOT EXISTS (SELECT 1 FROM supports s WHERE s.fact_id=facts.id)",
    );
  }
}
