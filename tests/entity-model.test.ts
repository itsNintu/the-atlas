import { describe, expect, test } from "bun:test";
import { analyzeRecallQuery, diverseSelection, matchesRequestedFacet, memoryEntityInfo, predicateSignature } from "../src/entity-model.ts";

describe("company-focused recall", () => {
  test("selects source-linked offer/interview companies ahead of generic role context", () => {
    const plan = analyzeRecallQuery("Which company is behind my finished interviews and offer?");
    expect(plan.facets).toContain("company");
    expect(plan.topics).toContain("work");
    expect(predicateSignature("received_offer_from").facet).toBe("company");
    expect(predicateSignature("completed_interviews_with").facet).toBe("company");
    const rows = [
      { id: "role", predicate: "job_title", object: "Founding Growth", score: 0.9 },
      { id: "offer", predicate: "received_offer_from", object: "Paradev", score: 0.4 },
      { id: "interviews", predicate: "completed_interviews_with", object: "Paradev", score: 0.3 },
    ];
    const info = (row: any) => memoryEntityInfo(row);
    expect(matchesRequestedFacet(rows[1], plan, info(rows[1]))).toBe(true);
    expect(matchesRequestedFacet(rows[0], plan, info(rows[0]))).toBe(false);
    expect(diverseSelection(rows, 3, plan, info).slice(0, 2).map((row) => row.id)).toEqual(["offer", "interviews"]);
  });
});
