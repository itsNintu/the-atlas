import { test, expect } from "bun:test";
import { fixture, at } from "./helpers.ts";
test("bounded graph expansion follows only authorized live temporal edges with provenance", async () => {
  const f = await fixture();
  try {
    await f.ingest("ignored", {
      assertions: [
        { subject: "Mira", predicate: "works_for", object: "Cedar" },
        { subject: "Cedar", predicate: "based_in", object: "Lisbon" },
        { subject: "Unrelated", predicate: "in", object: "Tokyo" },
      ],
    });
    const hidden = (
      await f.call("POST", "/v1/spaces", {
        name: "Hidden",
        project_id: f.project.id,
      })
    ).body;
    await f.ingest("ignored", {
      space_id: hidden.id,
      assertions: [{ subject: "Lisbon", predicate: "secret", object: "Vault" }],
    });
    while (await f.worker.runOnce()) {}
    const graph = async (max_hops: number) =>
      f.call("POST", "/v1/graph", {
        space_ids: [f.space.id],
        seed_entities: ["Mira"],
        max_hops,
        budget_chars: 2000,
      });
    expect((await graph(1)).body.facts).toHaveLength(1);
    const two = (await graph(2)).body;
    expect(two.facts).toHaveLength(2);
    expect(two.context).toContain("Lisbon");
    expect(two.context).not.toContain("Vault");
    expect(two.context).not.toContain("Tokyo");
    expect(two.facts.every((x: any) => x.supports.length > 0)).toBe(true);
    expect(
      (
        await f.call(
          "POST",
          "/v1/graph",
          { space_ids: [f.space.id], seed_entities: ["Mira"] },
          f.other.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await f.call("POST", "/v1/graph", {
          space_ids: [f.space.id],
          seed_entities: ["Mira"],
          max_hops: 10,
        })
      ).status,
    ).toBe(400);
  } finally {
    f.store.close();
  }
});
