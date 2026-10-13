import { describe, expect, it } from "vitest";
import { STOPPED, elapsed, pause, start } from "./stopwatch";

describe("stopwatch", () => {
  it("cuenta, pausa y reanuda sin perder tiempo", () => {
    let s = start(STOPPED, 1000);
    expect(elapsed(s, 3500)).toBe(2500);
    s = pause(s, 3500);
    expect(elapsed(s, 99_999)).toBe(2500);
    s = start(s, 10_000);
    expect(elapsed(s, 10_400)).toBe(2900);
  });
  it("iniciar dos veces no reinicia", () => {
    const s = start(STOPPED, 1000);
    expect(start(s, 5000)).toBe(s);
  });
});
