import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setting, databasePath } from "../src/config.ts";

test("The Atlas configuration takes precedence and keeps legacy aliases", () => {
  expect(setting("PORT", { THE_ATLAS_PORT: "9000", THREADATLAS_PORT: "8000" })).toBe("9000");
  expect(setting("PORT", { THREADATLAS_PORT: "8000" })).toBe("8000");
  expect(setting("WORKER", { THE_ATLAS_WORKER: "false", THREADATLAS_WORKER: "true" })).toBe("false");
  expect(setting("PROVIDER_API_KEY", { THE_ATLAS_PROVIDER_API_KEY: "", THREADATLAS_PROVIDER_API_KEY: "synthetic" })).toBe("");
  expect(setting("URL", {})).toBeUndefined();
});

test("database defaults preserve existing legacy data and reject ambiguous copies", () => {
  const dir = mkdtempSync(join(import.meta.dir, "../.private-identity-"));
  try {
    mkdirSync(join(dir, "data"));
    expect(databasePath({}, dir)).toBe(join(dir, "data/the-atlas.sqlite"));
    writeFileSync(join(dir, "data/threadatlas.sqlite"), "synthetic legacy fixture");
    expect(databasePath({}, dir)).toBe(join(dir, "data/threadatlas.sqlite"));
    writeFileSync(join(dir, "data/the-atlas.sqlite"), "synthetic current fixture");
    expect(() => databasePath({}, dir)).toThrow("THE_ATLAS_DB");
    expect(databasePath({ THE_ATLAS_DB: "explicit.sqlite", THREADATLAS_DB: "old.sqlite" }, dir)).toBe("explicit.sqlite");
    expect(databasePath({ THREADATLAS_DB: "old.sqlite" }, dir)).toBe("old.sqlite");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI reports the current product and package version", async () => {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "--help"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  const result = JSON.parse(await new Response(proc.stdout).text());
  expect(await proc.exited).toBe(0);
  expect(result.product).toBe("The Atlas");
  expect(result.version).toBe((await import("../package.json")).version);
});
