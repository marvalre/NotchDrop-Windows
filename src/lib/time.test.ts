import { describe, expect, it } from "vitest";
import { clock, stopwatchText } from "./time";

describe("clock", () => {
  it("formatea y no revienta con infinito/NaN", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(Infinity)).toBe("0:00");
    expect(clock(NaN)).toBe("0:00");
    expect(clock(-3)).toBe("0:00");
    expect(clock(1e300)).toBe("5999:59");
  });
});

describe("stopwatchText", () => {
  it("mm:ss.d", () => {
    expect(stopwatchText(0)).toBe("00:00.0");
    expect(stopwatchText(65_430)).toBe("01:05.4");
  });
});
