import { setting } from "./config.ts";
import { Memory } from "./memory.ts";
import { memoryGraph } from "./memory-graph.ts";
import { inferenceStatus } from "./inference.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { Store, id, now, hash, canonical, type Actor } from "./store.ts";
import { ApiError, fail, integer, object, text, timestamp } from "./errors.ts";
import {
  providerStatus,
  OpenAICompatible,
  cosine,
  type ExtractionProvider,
} from "./provider.ts";
import { readFileSync } from "node:fs";

const actions = ["read", "write", "delete"];
const chars = (s: string) => Array.from(s).length;
function page(rows: any[], url: URL, binding: string) {
  const limit = integer(
    url.searchParams.has("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined,
    "limit",
    1,
    100,
    25,
  );
  let after = "";
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (c.binding !== binding || typeof c.after !== "string") throw Error();
      after = c.after;
    } catch {
      fail(400, "invalid_cursor", "Cursor does not match this caller/query");
    }
  }
  const remaining = rows
    .filter((r) => r.id > after)
    .sort((a, b) => a.id.localeCompare(b.id));
  const data = remaining.slice(0, limit);
  return {
    data,
    next_cursor:
      remaining.length > limit
        ? Buffer.from(
            JSON.stringify({ after: data.at(-1).id, binding }),
          ).toString("base64url")
        : null,
  };
}
export class App {
  memory: Memory;
  constructor(
    public store: Store,
    public provider: ExtractionProvider = new OpenAICompatible(),
  ) {
    this.memory = new Memory(store);
  }
  async fetch(request: Request): Promise<Response> {
    const request_id = id("req"),
      start = performance.now();
    let status = 200;
    try {
      const u = new URL(request.url),
        method = request.method,
        path = u.pathname;
      // Deliberately exact: no arbitrary file/directory serving for brand assets.
      if (method === "GET" && ["/", "/ui.js", "/style.css", "/brain", "/brain.js", "/brain.css", "/brand.css", "/brand/creator-labs-white.svg", "/brand/SpaceGrotesk-variable.ttf", "/brand/IBMPlexMono-Regular.ttf", "/brand/IBMPlexMono-Medium.ttf"].includes(path)) {
        const name = path === "/" ? "index.html" : path === "/brain" ? "brain.html" : path.slice(1);
        return new Response(
          readFileSync(new URL(`../ui/${name}`, import.meta.url)),
          {
            headers: {
              "Content-Type": name.endsWith("html")
                ? "text/html; charset=utf-8"
                : name.endsWith("js")
                  ? "text/javascript"
                  : name.endsWith("svg")
                    ? "image/svg+xml"
                    : name.endsWith("ttf")
                      ? "font/ttf"
                      : "text/css",
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "no-referrer",
              "Cache-Control": "no-store",
            },
          },
        );
      }
      if (method === "GET" && path === "/healthz")
        return this.json({
          status: "ok",
          api_version: "v1",
          schema_version: SCHEMA_VERSION,
          request_id,
        });
      if (!path.startsWith("/v1/")) fail(404, "not_found", "Route not found");
      const a = this.store.authenticate(
        request.headers.get("authorization")?.replace(/^Bearer /, ""),
      );
      let b: any = {};
      if (!["GET", "HEAD"].includes(method)) {
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          fail(
            415,
            "unsupported_media_type",
            "Content-Type application/json required",
          );
        if (Number(request.headers.get("content-length")) > 1_000_000)
          fail(413, "payload_too_large", "Request exceeds 1 MB");
        // Stream-limit even chunked bodies before JSON parsing.
        const reader = request.body?.getReader();
        let total = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > 1_000_000) {
              await reader.cancel();
              fail(413, "payload_too_large", "Request exceeds 1 MB");
            }
            chunks.push(value);
          }
        }
        try {
          b = object(
            JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
          );
        } catch (e) {
          if (e instanceof ApiError) throw e;
          fail(400, "invalid_json", "Malformed JSON body");
        }
        if ("workspace_id" in b || "user_id" in b)
          fail(
            400,
            "identity_not_authority",
            "Workspace and identity come from the credential, not request fields",
          );
      }
      this.store.active(a); // Revalidate after streamed body consumption.
      const write = (authorize: () => void, act: () => any) =>
        this.store.write(
          a,
          request.headers.get("idempotency-key") ?? "",
          `${method} ${path}`,
          b,
          request_id,
          authorize,
          act,
        );
      const admin = () => this.store.admin(a);
      const listed = (rows: any[]) =>
        page(
          rows,
          u,
          hash(a.id + path + (u.searchParams.get("space_id") ?? "")),
        );
      let result: any;
      const match = (pattern: RegExp) => path.match(pattern)?.[1];
      if (method === "POST" && path === "/v1/events")
        result = {
          data: write(
            () => {
              this.memory.authorize(
                a,
                b.agent_id,
                b.operation === "delete" ? "delete" : "write",
              );
            },
            () => this.memory.event(a, b),
          ),
        };
      else if (method === "POST" && path === "/v1/recall")
        result = { data: await this.memory.recall(a, b) };
      else if (method === "POST" && path === "/v1/memory/graph")
        result = { data: memoryGraph(this.memory, a, b) };
      else if (method === "POST" && path === "/v1/feedback")
        result = {
          data: write(
            () => {
              this.memory.authorize(a, b.agent_id, "write");
            },
            () => this.memory.feedback(a, b),
          ),
        };
      else if (method === "POST" && path === "/v1/memory/bind")
        result = {
          data: write(admin, () =>
            this.memory.bind(
              a,
              text(b.principal_id, "principal_id"),
              text(b.agent_id, "agent_id"),
            ),
          ),
        };
      else if (method === "GET" && path === "/v1/memory/jobs")
        result = {
          data: this.memory.diagnostics(
            a,
            u.searchParams.get("agent_id") ?? "",
          ),
        };
      else if (
        method === "POST" &&
        match(/^\/v1\/memory\/jobs\/([^/]+)\/retry$/)
      )
        result = {
          data: write(
            () => {
              this.memory.authorize(a, b.agent_id, "write");
            },
            () =>
              this.memory.retry(
                a,
                b.agent_id,
                match(/^\/v1\/memory\/jobs\/([^/]+)\/retry$/)!,
              ),
          ),
        };
      else if (method === "GET" && path === "/v1/me")
        result = {
          principal: a,
          workspace: this.store.one(
            "SELECT * FROM workspaces WHERE id=?",
            a.workspace_id,
          ),
        };
      else if (method === "GET" && path === "/v1/status")
        result = {
          api_version: "v1",
          schema_version: SCHEMA_VERSION,
          provider: providerStatus(),
          memory_inference: inferenceStatus(),
          storage: "sqlite_wal_single_node",
          sqlite_version: this.store.sqlite_version,
          sqlite_wal_reset_fix: this.store.sqlite_wal_reset_fix,
          extraction_modes: ["assertions", "natural_language"],
          queue: this.store.all(
            "SELECT j.status,COUNT(*) AS count FROM jobs j JOIN revisions r ON r.id=j.revision_id JOIN sources s ON s.id=r.source_id JOIN grants g ON g.space_id=s.space_id AND g.principal_id=? AND g.action='read' WHERE s.workspace_id=? GROUP BY j.status",
            a.id,
            a.workspace_id,
          ),
        };
      else if (method === "POST" && path === "/v1/projects")
        result = write(admin, () => {
          const value = {
            id: id("proj"),
            workspace_id: a.workspace_id,
            name: text(b.name, "name"),
            created_at: now(),
          };
          this.store.run(
            "INSERT INTO projects VALUES (?,?,?,?)",
            value.id,
            value.workspace_id,
            value.name,
            value.created_at,
          );
          return value;
        });
      else if (method === "GET" && path === "/v1/projects")
        result = listed(
          this.store.all(
            "SELECT p.* FROM projects p WHERE p.workspace_id=? AND (?=1 OR EXISTS(SELECT 1 FROM spaces s JOIN grants g ON g.space_id=s.id WHERE s.project_id=p.id AND g.principal_id=?))",
            a.workspace_id,
            a.is_admin,
            a.id,
          ),
        );
      else if (method === "POST" && path === "/v1/principals")
        result = write(admin, () => {
          const kind = b.kind ?? "agent";
          if (!["human", "agent", "service"].includes(kind))
            fail(400, "invalid_request", "Unknown principal kind");
          const value = {
            id: id("prn"),
            name: text(b.name, "name"),
            kind,
            created_at: now(),
          };
          this.store.run(
            "INSERT INTO principals VALUES (?,?,?,?,0,?)",
            value.id,
            a.workspace_id,
            value.name,
            kind,
            value.created_at,
          );
          return value;
        });
      else if (method === "GET" && path === "/v1/principals") {
        admin();
        result = listed(
          this.store.all(
            "SELECT id,name,kind,is_admin,created_at FROM principals WHERE workspace_id=?",
            a.workspace_id,
          ),
        );
      } else if (method === "POST" && path === "/v1/spaces")
        result = write(admin, () => {
          if (
            !this.store.one(
              "SELECT id FROM projects WHERE id=? AND workspace_id=?",
              b.project_id,
              a.workspace_id,
            )
          )
            fail(404, "not_found", "Project not found");
          const kind = b.kind ?? "shared",
            owner_id = b.owner_id ?? a.id;
          if (!["personal", "shared"].includes(kind))
            fail(
              400,
              "invalid_request",
              "Space kind must be personal or shared",
            );
          if (
            !this.store.one(
              "SELECT id FROM principals WHERE id=? AND workspace_id=?",
              owner_id,
              a.workspace_id,
            )
          )
            fail(404, "not_found", "Owner not found");
          const value = {
            id: id("sp"),
            project_id: b.project_id,
            name: text(b.name, "name"),
            kind,
            owner_id,
            created_at: now(),
          };
          this.store.run(
            "INSERT INTO spaces VALUES (?,?,?,?,?,?,?)",
            value.id,
            a.workspace_id,
            value.project_id,
            value.name,
            kind,
            owner_id,
            value.created_at,
          );
          for (const action of actions)
            this.store.run(
              "INSERT INTO grants VALUES (?,?,?)",
              value.id,
              owner_id,
              action,
            );
          return value;
        });
      else if (method === "GET" && path === "/v1/spaces")
        result = listed(
          this.store.all(
            "SELECT DISTINCT s.* FROM spaces s JOIN grants g ON g.space_id=s.id AND g.principal_id=? WHERE s.workspace_id=?",
            a.id,
            a.workspace_id,
          ),
        );
      else if (method === "POST" && path === "/v1/grants")
        result = write(admin, () => {
          const space = this.store.one(
            "SELECT * FROM spaces WHERE id=? AND workspace_id=?",
            b.space_id,
            a.workspace_id,
          );
          const principal = this.store.one(
            "SELECT id FROM principals WHERE id=? AND workspace_id=?",
            b.principal_id,
            a.workspace_id,
          );
          if (!space || !principal)
            fail(404, "not_found", "Space or principal not found");
          if (space.kind === "personal" && space.owner_id !== principal.id)
            fail(
              403,
              "personal_space",
              "Personal spaces may only grant their owner; use a shared space for collaboration",
            );
          if (
            !Array.isArray(b.actions) ||
            b.actions.some((x: any) => !actions.includes(x))
          )
            fail(
              400,
              "invalid_request",
              "actions must contain read, write and/or delete",
            );
          this.store.run(
            "DELETE FROM grants WHERE space_id=? AND principal_id=?",
            space.id,
            principal.id,
          );
          for (const action of new Set(b.actions))
            this.store.run(
              "INSERT INTO grants VALUES (?,?,?)",
              space.id,
              principal.id,
              action,
            );
          return {
            space_id: space.id,
            principal_id: principal.id,
            actions: b.actions,
          };
        });
      else if (method === "GET" && path === "/v1/grants") {
        admin();
        result = listed(
          this.store.all(
            "SELECT g.space_id || ':' || g.principal_id || ':' || g.action AS id,g.* FROM grants g JOIN spaces s ON s.id=g.space_id WHERE s.workspace_id=?",
            a.workspace_id,
          ),
        );
      } else if (method === "POST" && path === "/v1/sources")
        result = write(
          () => {
            this.store.space(a, text(b.space_id, "space_id"), "write");
          },
          () => {
            const source_id = id("src");
            if (
              this.store.one(
                "SELECT id FROM sources WHERE space_id=? AND external_id=?",
                b.space_id,
                text(b.external_id, "external_id"),
              )
            )
              fail(
                409,
                "source_exists",
                "External source identity already exists; correct it through its source ID",
              );
            this.store.run(
              "INSERT INTO sources VALUES (?,?,?,?,NULL,?,NULL)",
              source_id,
              a.workspace_id,
              b.space_id,
              b.external_id,
              now(),
            );
            return this.store.enqueue(source_id, 1, b);
          },
        );
      else if (method === "GET" && path === "/v1/sources") {
        const space_id = u.searchParams.get("space_id");
        if (space_id) this.store.space(a, space_id, "read");
        result = listed(
          this.store.all(
            "SELECT s.* FROM sources s JOIN grants g ON g.space_id=s.space_id AND g.principal_id=? AND g.action='read' WHERE s.workspace_id=? AND (? IS NULL OR s.space_id=?)",
            a.id,
            a.workspace_id,
            space_id,
            space_id,
          ),
        );
      } else if (method === "GET" && match(/^\/v1\/sources\/([^/]+)$/)) {
        const s = this.store.source(
          a,
          match(/^\/v1\/sources\/([^/]+)$/)!,
          "read",
        );
        result = {
          ...s,
          revisions: this.store
            .all(
              "SELECT * FROM revisions WHERE source_id=? ORDER BY revision_number",
              s.id,
            )
            .map((r) => ({
              ...r,
              payload: r.payload_json ? JSON.parse(r.payload_json) : null,
              assertions: r.assertions_json
                ? JSON.parse(r.assertions_json)
                : null,
              payload_json: undefined,
              assertions_json: undefined,
            })),
        };
      } else if (
        method === "POST" &&
        match(/^\/v1\/sources\/([^/]+)\/revisions$/)
      ) {
        const source_id = match(/^\/v1\/sources\/([^/]+)\/revisions$/)!;
        result = write(
          () => {
            this.store.source(a, source_id, "write");
          },
          () => {
            const source = this.store.source(a, source_id, "write");
            if (source.deleted_at)
              fail(
                410,
                "source_forgotten",
                "Forgotten source cannot be revised",
              );
            const old = this.store.one(
              "SELECT * FROM revisions WHERE id=?",
              source.current_revision_id,
            );
            if (b.expected_revision_number !== old.revision_number)
              fail(
                409,
                "revision_conflict",
                "expected_revision_number must match current source revision",
              );
            const next = this.store.enqueue(
              source_id,
              old.revision_number + 1,
              b,
            );
            this.store.run(
              "UPDATE revisions SET superseded_at=? WHERE id=?",
              next.recorded_at,
              old.id,
            );
            this.store.run(
              "UPDATE supports SET recorded_to=? WHERE revision_id=? AND recorded_to IS NULL",
              next.recorded_at,
              old.id,
            );
            this.store.run(
              "UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE revision_id=? AND status NOT IN ('succeeded','cancelled')",
              old.id,
            );
            return next;
          },
        );
      } else if (method === "DELETE" && match(/^\/v1\/sources\/([^/]+)$/)) {
        const source_id = match(/^\/v1\/sources\/([^/]+)$/)!;
        result = write(
          () => {
            this.store.source(a, source_id, "delete");
          },
          () => {
            const at = now();
            this.store.forget(source_id, at);
            return { source_id, deleted_at: at, payload_erased: true };
          },
        );
        // Logical erasure is immediate. WAL checkpoint is best effort; backups are operator-owned.
        this.store.checkpoint();
      } else if (method === "GET" && path === "/v1/jobs")
        result = listed(
          this.store.all(
            "SELECT j.id,j.revision_id,j.status,j.attempts,j.max_attempts,j.available_at,j.lease_until,j.error_code,j.created_at,j.completed_at FROM jobs j JOIN revisions r ON r.id=j.revision_id JOIN sources s ON s.id=r.source_id JOIN grants g ON g.space_id=s.space_id AND g.principal_id=? AND g.action='read' WHERE s.workspace_id=?",
            a.id,
            a.workspace_id,
          ),
        );
      else if (method === "GET" && match(/^\/v1\/jobs\/([^/]+)$/))
        result = this.job(a, match(/^\/v1\/jobs\/([^/]+)$/)!, "read");
      else if (method === "POST" && match(/^\/v1\/jobs\/([^/]+)\/retry$/)) {
        const job_id = match(/^\/v1\/jobs\/([^/]+)\/retry$/)!;
        result = write(
          () => {
            this.job(a, job_id, "write");
          },
          () => {
            const job = this.job(a, job_id, "write");
            if (!["failed", "retry"].includes(job.status))
              fail(
                409,
                "job_not_retryable",
                "Only failed/retry jobs can be manually retried",
              );
            const revision = this.store.one(
              "SELECT r.deleted_at,s.deleted_at AS source_deleted,s.current_revision_id FROM revisions r JOIN sources s ON s.id=r.source_id WHERE r.id=?",
              job.revision_id,
            );
            if (
              revision.deleted_at ||
              revision.source_deleted ||
              revision.current_revision_id !== job.revision_id
            )
              fail(
                409,
                "revision_not_current",
                "Cannot retry superseded or forgotten evidence",
              );
            this.store.run(
              "UPDATE jobs SET status='queued',attempts=0,error_code=NULL,completed_at=NULL,available_at=?,lease_until=NULL,lease_token=NULL WHERE id=?",
              Date.now(),
              job_id,
            );
            return { id: job_id, status: "queued" };
          },
        );
      } else if (
        method === "POST" &&
        (path === "/v1/context" || path === "/v1/graph")
      )
        result = await this.context(
          a,
          path === "/v1/graph" ? { ...b, query: "", graph_only: true } : b,
        );
      else if (method === "GET" && match(/^\/v1\/facts\/([^/]+)$/)) {
        const fact_id = match(/^\/v1\/facts\/([^/]+)$/)!;
        const fact = this.store.one(
          "SELECT f.* FROM facts f JOIN spaces s ON s.id=f.space_id JOIN grants g ON g.space_id=s.id WHERE f.id=? AND s.workspace_id=? AND g.principal_id=? AND g.action='read'",
          fact_id,
          a.workspace_id,
          a.id,
        );
        if (!fact) fail(404, "not_found", "Fact not found");
        result = {
          ...fact,
          embedding_json: undefined,
          fingerprint: undefined,
          supports: this.supports(fact_id),
        };
      } else if (method === "GET" && path === "/v1/audit") {
        admin();
        result = listed(
          this.store.all(
            "SELECT * FROM audit WHERE workspace_id=?",
            a.workspace_id,
          ),
        );
      } else if (
        method === "POST" &&
        match(/^\/v1\/credentials\/([^/]+)\/revoke$/)
      ) {
        const key_id = match(/^\/v1\/credentials\/([^/]+)\/revoke$/)!;
        result = write(
          () => {
            const target = this.store.one(
              "SELECT c.id,p.id AS principal_id,p.workspace_id FROM credentials c JOIN principals p ON p.id=c.principal_id WHERE c.id=?",
              key_id,
            );
            if (
              !target ||
              target.workspace_id !== a.workspace_id ||
              (!a.is_admin && target.principal_id !== a.id)
            )
              fail(404, "not_found", "Credential not found");
          },
          () => {
            this.store.run(
              "UPDATE credentials SET revoked_at=? WHERE id=?",
              now(),
              key_id,
            );
            return { id: key_id, revoked: true };
          },
        );
      } else fail(404, "not_found", "Route not found");
      return this.json({ api_version: "v1", request_id, ...result });
    } catch (e) {
      const error =
        e instanceof ApiError
          ? e
          : new ApiError(
              500,
              "internal_error",
              "Internal error; inspect local diagnostics without source contents",
            );
      status = error.status;
      return this.json(
        {
          api_version: "v1",
          request_id,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
          },
        },
        status,
      );
    } finally {
      if (setting("LOG_REQUESTS") === "true")
        console.log(
          JSON.stringify({
            request_id,
            method: request.method,
            status,
            duration_ms: +(performance.now() - start).toFixed(2),
          }),
        );
    }
  }
  json(value: unknown, status = 200) {
    return Response.json(value, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  job(a: Actor, job_id: string, action: string) {
    const job = this.store.one(
      "SELECT j.*,r.source_id FROM jobs j JOIN revisions r ON r.id=j.revision_id JOIN sources s ON s.id=r.source_id JOIN grants g ON g.space_id=s.space_id WHERE j.id=? AND s.workspace_id=? AND g.principal_id=? AND g.action=?",
      job_id,
      a.workspace_id,
      a.id,
      action,
    );
    if (!job) fail(404, "not_found", "Job not found or action not granted");
    const { lease_token, ...safe } = job;
    return safe;
  }
  supports(fact_id: string, recorded_at?: string) {
    return this.store.all(
      "SELECT p.revision_id,r.source_id,r.revision_number,r.source_timestamp,p.recorded_from,p.recorded_to,r.superseded_at FROM supports p JOIN revisions r ON r.id=p.revision_id WHERE p.fact_id=? AND r.deleted_at IS NULL AND (? IS NULL OR (p.recorded_from<=? AND (p.recorded_to IS NULL OR p.recorded_to>?))) ORDER BY r.source_id,r.revision_number",
      fact_id,
      recorded_at ?? null,
      recorded_at ?? null,
      recorded_at ?? null,
    );
  }
  async context(a: Actor, b: any) {
    const query =
      typeof b.query === "string" && b.query.length <= 1000
        ? b.query
        : fail(
            400,
            "invalid_request",
            "query must be a string, at most 1000 characters",
          );
    const budget = integer(b.budget_chars, "budget_chars", 0, 100_000, 2000);
    const limit = integer(b.limit, "limit", 1, 100, 20);
    const recorded_at = timestamp(b.recorded_at ?? now(), "recorded_at"),
      valid_at = timestamp(b.valid_at ?? now(), "valid_at");
    if (
      !Array.isArray(b.space_ids) ||
      !b.space_ids.length ||
      b.space_ids.length > 32 ||
      b.space_ids.some((x: any) => typeof x !== "string")
    )
      fail(
        400,
        "invalid_request",
        "space_ids must explicitly select 1-32 authorized spaces",
      );
    const space_ids: string[] = [...new Set<string>(b.space_ids)];
    space_ids.forEach((s) => this.store.space(a, s, "read"));
    const strategy = b.strategy ?? "lexical";
    if (!["lexical", "hybrid"].includes(strategy))
      fail(400, "invalid_request", "strategy must be lexical or hybrid");
    let vector: number[] | undefined;
    if (strategy === "hybrid" && query.trim())
      vector = (await this.provider.embed([query]))[0];
    this.store.active(a);
    space_ids.forEach((s) => this.store.space(a, s, "read"));
    const slots = space_ids.map(() => "?").join(",");
    // Authorization and both time axes are applied BEFORE ranking or any inference.
    const rows = this.store.all(
      `SELECT f.* FROM facts f WHERE f.space_id IN (${slots}) AND f.valid_from<=? AND (f.valid_to IS NULL OR f.valid_to>?) AND EXISTS(SELECT 1 FROM supports p JOIN revisions r ON r.id=p.revision_id WHERE p.fact_id=f.id AND r.deleted_at IS NULL AND p.recorded_from<=? AND (p.recorded_to IS NULL OR p.recorded_to>?)) ORDER BY f.id LIMIT 5001`,
      ...space_ids,
      valid_at,
      valid_at,
      recorded_at,
      recorded_at,
    );
    if (rows.length > 5000)
      fail(
        422,
        "query_too_broad",
        "M0 scores at most 5000 time-filtered facts per request; narrow space_ids or time selection",
      );
    const terms = [
      ...new Set<string>(
        query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [],
      ),
    ];
    let candidates = rows;
    let traversal: Record<string, unknown> | undefined;
    if (b.graph_only) {
      if (
        !Array.isArray(b.seed_entities) ||
        !b.seed_entities.length ||
        b.seed_entities.length > 32 ||
        b.seed_entities.some(
          (x: any) => typeof x !== "string" || !x.trim() || x.length > 512,
        )
      )
        fail(
          400,
          "invalid_request",
          "seed_entities must be 1-32 exact entity labels",
        );
      const max_hops = integer(b.max_hops, "max_hops", 1, 3, 1);
      const seen = new Set<string>(b.seed_entities),
        chosen = new Set<string>();
      let frontier = new Set<string>(b.seed_entities);
      for (let hop = 0; hop < max_hops && frontier.size; hop++) {
        const next = new Set<string>();
        for (const f of rows) {
          if (!frontier.has(f.subject) && !frontier.has(f.object)) continue;
          chosen.add(f.id);
          for (const entity of [f.subject, f.object])
            if (!seen.has(entity)) {
              seen.add(entity);
              next.add(entity);
            }
        }
        frontier = next;
      }
      candidates = rows.filter((f) => chosen.has(f.id));
      traversal = {
        seed_entities: b.seed_entities,
        max_hops,
        visited_entities: seen.size,
        matching_edges: candidates.length,
        matching:
          "exact case-sensitive labels; undirected expansion; no entity resolution",
      };
    }
    const ranked = candidates
      .map((f) => {
        const haystack =
          `${f.subject} ${f.predicate} ${f.object}`.toLocaleLowerCase();
        const lexical = terms.length
          ? terms.filter((t) => haystack.includes(t)).length / terms.length
          : 1;
        const semantic =
          vector &&
          f.embedding_model === this.provider.embedding_model &&
          f.embedding_json
            ? cosine(vector, JSON.parse(f.embedding_json))
            : 0;
        return { ...f, score: lexical + Math.max(0, semantic) };
      })
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    let context = "";
    const selected: any[] = [];
    for (const f of ranked) {
      if (selected.length >= limit) break;
      const line = `${f.subject} | ${f.predicate} | ${f.object} [${f.id}]`;
      const candidate = context ? context + "\n" + line : line;
      if (chars(candidate) > budget) continue;
      context = candidate;
      const { embedding_json, embedding_model, fingerprint, ...safe } = f;
      selected.push({ ...safe, supports: this.supports(f.id, recorded_at) });
    }
    return {
      ...(traversal ? { traversal } : {}),
      context,
      used_chars: chars(context),
      budget_chars: budget,
      facts: selected,
      matched_facts: ranked.length,
      omitted_facts: ranked.length - selected.length,
      recorded_at,
      valid_at,
      strategy,
      ranking:
        "M0 normalized lexical coverage plus optional positive cosine; no language-model reranker",
      budget_applies_to: "context Unicode code points; metadata is separate",
    };
  }
}
