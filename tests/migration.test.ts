import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, canonical, hash } from "../src/store.ts";
import { finalizeMigration, importMigrationBatch, migrationManifest } from "../src/migration.ts";

const tables = ["memory_conversation_focus", "memory_schedule_clock", "derived_brain_reset_state", "memory_index_meta"];

describe("hosted migration singleton state", () => {
  test("imports reset, scheduler and focus values on first attempt and idempotent replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "atlas-migration-"));
    const source = new Store(join(directory, "source.sqlite"));
    const destination = new Store(join(directory, "destination.sqlite"));
    try {
      source.run("UPDATE derived_brain_reset_state SET epoch=3,reset_id='reset-test',reset_at='2026-11-10T00:00:00Z' WHERE singleton=1");
      source.run("UPDATE memory_schedule_clock SET sequence=123456789 WHERE singleton=1");
      const columnsByTable = new Map<string, string[]>();
      for (const table of tables) {
        const columns = source.all(`PRAGMA table_info("${table}")`).map((column) => column.name);
        columnsByTable.set(table, columns);
        const rows = source.all(`SELECT * FROM "${table}"`).map((row) => columns.map((column) => row[column]));
        const body = { table, batch_id: "singleton", columns, rows, batch_sha256: hash(canonical({ table, columns, rows })) };
        importMigrationBatch(destination, body);
        importMigrationBatch(destination, body);
      }
      const expected = migrationManifest(source);
      expect(migrationManifest(destination).reset.epoch).toBe(3);
      expect(migrationManifest(destination).reset.reset_id).toBe("reset-test");
      expect(finalizeMigration(destination, expected).quick_check).toBe("ok");
    } finally {
      source.close();
      destination.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
