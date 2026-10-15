import { describe, expect, it } from "vitest";
import { isNewer } from "./version";

// Same cases as UpdateVersion in the macOS tests.
describe("isNewer", () => {
  it.each([
    ["3.13.0", "3.12.1", true], ["v3.13.0", "3.12.1", true], ["3.12.10", "3.12.9", true], ["4.0", "3.99.99", true],
    ["3.12.1", "3.12.1", false], ["3.12.0", "3.12.1", false], ["3.12", "3.12.0", false], ["basura", "1.0", false], ["", "1.0", false],
  ])("%s > %s → %s", (a, b, want) => expect(isNewer(a, b)).toBe(want));
});
