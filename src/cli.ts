#!/usr/bin/env bun
import { Store, id } from "./store.ts";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
  readFileSync,
  statSync,
  fsyncSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { ApiError } from "./errors.ts";

const args = process.argv.slice(2),
  command = args.shift();
function option(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw Error(`--${name} needs a value`);
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}
const db = option(
  "db",
  process.env.THREADATLAS_DB ?? "./data/threadatlas.sqlite",
)!;
const credential_file = option(
  "credential-file",
  process.env.THREADATLAS_CREDENTIAL_FILE ?? "./data/admin.credentials.json",
)!;
const base = option(
  "url",
  process.env.THREADATLAS_URL ?? "http://127.0.0.1:8787",
)!;
function output(x: unknown) {
  console.log(JSON.stringify(x, null, 2));
}
function readCredentials() {
  if (process.platform !== "win32" && statSync(credential_file).mode & 0o077)
    throw Error(
      "Credential file is group/world accessible; chmod 600 it first",
    );
  return JSON.parse(readFileSync(credential_file, "utf8"));
}
async function body() {
  const file = option("file");
  const data = file ? readFileSync(file, "utf8") : await Bun.stdin.text();
  return data.trim() ? JSON.parse(data) : {};
}
async function api(method: string, path: string, value?: unknown) {
  const c = readCredentials(),
    url = new URL(path, base),
    target = new URL(base);
  if (url.origin !== target.origin || !url.pathname.startsWith("/v1/"))
    throw Error("Only same-origin /v1 paths allowed");
  if (
    target.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  )
    throw Error("Use HTTPS for non-loopback servers");
  const response = await fetch(url, {
    method,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": option("idempotency-key", id("cli"))!,
    },
    body: method === "GET" ? undefined : JSON.stringify(value ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) {
    output(result);
    process.exit(1);
  }
  return result as any;
}
try {
  if (command === "bootstrap" || command === "issue-key") {
    const name = option("name", "My workspace")!,
      principal = option("principal-id");
    mkdirSync(dirname(resolve(credential_file)), {
      recursive: true,
      mode: 0o700,
    });
    const fd = openSync(credential_file, "wx", 0o600); // Reserve file before changing the DB; never overwrite an existing key.
    let store: Store | undefined;
    try {
      store = new Store(db);
      const result = store.transaction(() => {
        const result =
          command === "bootstrap"
            ? store!.bootstrap(name)
            : { principal_id: principal, ...store!.issueKey(principal ?? "") };
        writeFileSync(fd, JSON.stringify({ ...result, url: base }) + "\n", {
          encoding: "utf8",
        });
        fsyncSync(fd);
        return result;
      });
      const { token, ...safe } = result;
      output({
        ...safe,
        credential_file: resolve(credential_file),
        secret_printed: false,
      });
    } catch (e) {
      unlinkSync(credential_file);
      throw e;
    } finally {
      closeSync(fd);
      store?.close();
    }
  } else if (command === "api") {
    const method = args.shift()?.toUpperCase(),
      path = args.shift();
    if (!method || !path)
      throw Error("Usage: api METHOD /v1/path [--file JSON] (otherwise stdin)");
    output(
      await api(method, path, method === "GET" ? undefined : await body()),
    );
  } else if (command === "ingest")
    output(await api("POST", "/v1/sources", await body()));
  else if (command === "graph")
    output(await api("POST", "/v1/graph", await body()));
  else if (command === "context")
    output(await api("POST", "/v1/context", await body()));
  else if (command === "correct")
    output(
      await api(
        "POST",
        `/v1/sources/${encodeURIComponent(args.shift() ?? "")}/revisions`,
        await body(),
      ),
    );
  else if (command === "forget")
    output(
      await api(
        "DELETE",
        `/v1/sources/${encodeURIComponent(args.shift() ?? "")}`,
        {},
      ),
    );
  else if (command === "inspect")
    output(
      await api("GET", `/v1/sources/${encodeURIComponent(args.shift() ?? "")}`),
    );
  else if (command === "jobs") output(await api("GET", "/v1/jobs"));
  else if (command === "spaces") output(await api("GET", "/v1/spaces"));
  else if (command === "doctor") output(await api("GET", "/v1/status"));
  else if (command === "wait") {
    const job = args.shift(),
      timeout = Number(option("timeout-ms", "30000")),
      start = Date.now();
    if (!job || !Number.isFinite(timeout) || timeout < 1 || timeout > 300_000)
      throw Error("wait JOB_ID [--timeout-ms 1..300000]");
    while (true) {
      const result = await api("GET", `/v1/jobs/${encodeURIComponent(job)}`);
      if (["succeeded", "failed", "cancelled"].includes(result.status)) {
        output(result);
        if (result.status !== "succeeded") process.exitCode = 1;
        break;
      }
      if (Date.now() - start > timeout) {
        output({
          error: {
            code: "wait_timeout",
            message: "Job remains durable; inspect/retry later",
            retryable: true,
            details: { job_id: job },
          },
        });
        process.exitCode = 1;
        break;
      }
      await Bun.sleep(100);
    }
  } else {
    output({
      product: "ThreadAtlas",
      version: "0.1.0-alpha.0",
      commands: [
        "bootstrap --name NAME --credential-file FILE [--db FILE]",
        "issue-key --principal-id ID --credential-file NEW_FILE [--db FILE] (local OS operator)",
        "api METHOD /v1/PATH [--file JSON]",
        "ingest|context|graph --file JSON",
        "inspect SOURCE_ID",
        "correct SOURCE_ID --file JSON",
        "forget SOURCE_ID",
        "wait JOB_ID",
        "doctor|jobs|spaces",
      ],
      options: ["--url URL", "--credential-file FILE", "--idempotency-key KEY"],
      note: "Writes accept JSON stdin when --file is absent. Never put bearer credentials on the command line. See docs/quickstart.md.",
    });
  }
} catch (e) {
  output({
    error: {
      code: e instanceof ApiError ? e.code : "cli_error",
      message:
        e instanceof ApiError
          ? e.message
          : "Command failed; check arguments, file permissions, database path and server availability. See --help and docs/quickstart.md.",
      retryable: false,
      details: {},
    },
  });
  process.exitCode = 1;
}
