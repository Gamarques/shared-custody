import { describe, expect, it } from "vitest";
import { canDecide, MAX_DISPUTE_COMMENT, validateDisputeComment } from "./expense-decision";

describe("validateDisputeComment", () => {
  it("rejects blank comments", () => {
    expect(validateDisputeComment("   ").ok).toBe(false);
    expect(validateDisputeComment("").ok).toBe(false);
  });
  it("trims and accepts", () => {
    expect(validateDisputeComment("  valor errado ")).toEqual({ ok: true, comment: "valor errado" });
  });
  it("rejects over the limit", () => {
    expect(validateDisputeComment("a".repeat(MAX_DISPUTE_COMMENT + 1)).ok).toBe(false);
    expect(validateDisputeComment("a".repeat(MAX_DISPUTE_COMMENT)).ok).toBe(true);
  });
});

describe("canDecide", () => {
  it("only the member who did not pay, and not already confirmed", () => {
    expect(canDecide({ paid_by: "a", status: "pending" }, "b")).toBe(true);
    expect(canDecide({ paid_by: "a", status: "disputed" }, "b")).toBe(true);
    expect(canDecide({ paid_by: "a", status: "pending" }, "a")).toBe(false);
    expect(canDecide({ paid_by: "a", status: "confirmed" }, "b")).toBe(false);
    expect(canDecide({ paid_by: "a", status: "pending" }, null)).toBe(false);
  });
});
