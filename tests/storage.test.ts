import { test, expect } from "bun:test";
import { patchedSQLite, Store } from "../src/store.ts";
import { fixture } from "./helpers.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

test("WAL engine guard excludes known vulnerable versions and permits published fixes", () => {
  for (const version of ["3.50.4", "3.51.2", "3.44.5", "invalid"])
    expect(patchedSQLite(version)).toBe(false);
  for (const version of ["3.51.3", "3.53.4", "3.50.7", "3.44.6"])
    expect(patchedSQLite(version)).toBe(true);
});
test("long reader cannot prevent logical forget; checkpoint reports busy and succeeds after reader closes", async () => {
  const dir = mkdtempSync(join(import.meta.dir, "../.private-storage-")),
    path = join(dir, "memory.sqlite");
  const f = await fixture(path);
  let reader: Store | undefined;
  try {
    const source = (await f.ingest()).body;
    await f.worker.runOnce();
    reader = new Store(path);
    reader.db.exec("BEGIN");
    expect(
      reader.one(
        "SELECT payload_json FROM revisions WHERE id=?",
        source.revision_id,
      ).payload_json,
    ).toContain("Lisbon");
    expect(
      (await f.call("DELETE", "/v1/sources/" + source.source_id, {})).status,
    ).toBe(200);
    expect((await f.context()).body.facts).toHaveLength(0);
    expect(
      f.store.one(
        "SELECT payload_json FROM revisions WHERE id=?",
        source.revision_id,
      ).payload_json,
    ).toBeNull();
    expect(f.store.checkpoint().busy).toBe(1);
    expect(
      reader.one(
        "SELECT payload_json FROM revisions WHERE id=?",
        source.revision_id,
      ).payload_json,
    ).toContain("Lisbon"); // documented existing MVCC snapshot
    reader.db.exec("COMMIT");
    reader.close();
    reader = undefined;
    expect(f.store.checkpoint().busy).toBe(0);
    expect(f.store.one("PRAGMA busy_timeout").timeout).toBe(5000);
    expect(f.store.one("PRAGMA integrity_check").integrity_check).toBe("ok");
  } finally {
    reader?.close();
    f.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
