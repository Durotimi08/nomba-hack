import { describe, expect, it } from "vitest";
import { matchesMetadata } from "./match.js";

describe("matchesMetadata", () => {
  it("matches everyone when the predicate is empty", () => {
    expect(matchesMetadata({}, {})).toBe(true);
    expect(matchesMetadata({}, { scholarship: true })).toBe(true);
  });

  it("requires every predicate pair to be present", () => {
    expect(matchesMetadata({ scholarship: true }, { scholarship: true })).toBe(true);
    expect(matchesMetadata({ scholarship: true }, { scholarship: false })).toBe(false);
    expect(matchesMetadata({ scholarship: true }, {})).toBe(false);
  });

  it("supports multi-key predicates and ignores extra student tags", () => {
    expect(matchesMetadata({ house: "Blue" }, { house: "Blue", scholarship: true })).toBe(true);
    expect(matchesMetadata({ house: "Blue", boarder: true }, { house: "Blue" })).toBe(false);
  });
});
