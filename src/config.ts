import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError } from "./errors.ts";

type Environment = Record<string, string | undefined>;

// Keep existing deployments and protected provider credentials usable after the rename.
// An explicitly set current variable (even an empty string) wins over its legacy alias.
export function setting(name: string, env: Environment = process.env) {
  return env[`THE_ATLAS_${name}`] ?? env[`THREADATLAS_${name}`];
}

export function databasePath(env: Environment = process.env, cwd = process.cwd()) {
  const configured = setting("DB", env);
  if (configured !== undefined) return configured;
  const current = resolve(cwd, "data/the-atlas.sqlite");
  const legacy = resolve(cwd, "data/threadatlas.sqlite");
  if (existsSync(current) && existsSync(legacy)) {
    throw new ApiError(
      500,
      "database_path_conflict",
      "Both current and legacy databases exist; set THE_ATLAS_DB explicitly. No data was moved or merged.",
    );
  }
  // Do not rename an existing SQLite file: WAL/SHM companions and saved credentials stay intact.
  return existsSync(legacy) ? legacy : current;
}
