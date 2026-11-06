import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
export const repo = resolve(import.meta.dir, "..");
export async function server(db: string, worker = true) {
  const reservation = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });
  const port = reservation.port;
  await reservation.stop(true);
  const url = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: repo,
    env: {
      ...process.env,
      THREADATLAS_DB: db,
      THREADATLAS_HOST: "127.0.0.1",
      THREADATLAS_PORT: String(port),
      THREADATLAS_WORKER: String(worker),
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/healthz")).ok) return { proc, url };
    } catch {}
    if (proc.exitCode !== null)
      throw Error(
        "Server exited during startup: " +
          (await new Response(proc.stderr).text()),
      );
    await Bun.sleep(25);
  }
  proc.kill();
  throw Error("Server startup timed out");
}
export async function cli(
  args: string[],
  input?: unknown,
  env: Record<string, string> = {},
) {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  assert.equal(
    code,
    0,
    `CLI command failed (no credential content logged): ${stderr}`,
  );
  return JSON.parse(stdout);
}
export async function request(
  url: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  key: string = crypto.randomUUID(),
) {
  const response = await fetch(url + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: (await response.json()) as any };
}
export async function waitJob(url: string, token: string, job_id: string) {
  for (let i = 0; i < 1000; i++) {
    const r = await request(url, token, "GET", "/v1/jobs/" + job_id);
    assert.equal(r.status, 200);
    if (["succeeded", "failed", "cancelled"].includes(r.body.status))
      return r.body;
    await Bun.sleep(25);
  }
  throw Error("Job wait timeout");
}
export async function report(name: string, value: unknown) {
  mkdirSync(resolve(repo, "reports"), { recursive: true });
  await Bun.write(
    resolve(repo, "reports", name),
    JSON.stringify(value, null, 2) + "\n",
  );
}
