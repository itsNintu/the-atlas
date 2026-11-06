import { Store, id } from "../src/store.ts";
import { App } from "../src/app.ts";
import { Worker } from "../src/worker.ts";
export const at = "2026-01-01T00:00:00.000Z";
export const statement = (value = "Lisbon", extra = {}) => ({
  subject: "Mira",
  predicate: "lives_in",
  object: value,
  ...extra,
});
export async function fixture(path = ":memory:") {
  const store = new Store(path),
    app = new App(store),
    worker = new Worker(store);
  const owner = store.bootstrap("Synthetic workspace A"),
    other = store.bootstrap("Synthetic workspace B");
  const call = async (
    method: string,
    route: string,
    body?: any,
    token = owner.token,
    key = id("test"),
  ) => {
    const response = await app.fetch(
      new Request("http://localhost" + route, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  const project = (await call("POST", "/v1/projects", { name: "Test project" }))
    .body;
  const space = (
    await call("POST", "/v1/spaces", { name: "Shared", project_id: project.id })
  ).body;
  const ingest = async (value = "Lisbon", extra: any = {}, key?: string) =>
    call(
      "POST",
      "/v1/sources",
      {
        space_id: space.id,
        external_id: id("external"),
        format: "text",
        mode: "assertions",
        source_timestamp: at,
        payload: `Mira lives in ${value}.`,
        assertions: [statement(value)],
        ...extra,
      },
      owner.token,
      key,
    );
  const context = async (extra: any = {}, token = owner.token) =>
    call(
      "POST",
      "/v1/context",
      {
        space_ids: [space.id],
        query: "Mira",
        budget_chars: 2000,
        valid_at: "2026-06-01T00:00:00Z",
        ...extra,
      },
      token,
    );
  return {
    store,
    app,
    worker,
    owner,
    other,
    call,
    project,
    space,
    ingest,
    context,
  };
}
