import { describe, expect, it } from "vitest";
import { INITIAL, leaveCollapses, onEnter } from "./collapse";

describe("cerrar al alejar el mouse (misma regla que AutoCollapsePolicy de la Mac)", () => {
  it("abierto con el mouse: alejarse cierra", () => {
    expect(leaveCollapses(INITIAL)).toBe(true);
  });
  it("abierto con Ctrl+Alt+N: no cierra hasta haber entrado una vez", () => {
    const s = { ...INITIAL, sticky: true };
    expect(leaveCollapses(s)).toBe(false);
    expect(leaveCollapses(onEnter(s))).toBe(true);
  });
  it("un diálogo o arrastre en curso nunca cierra", () => {
    expect(leaveCollapses({ ...INITIAL, modal: true })).toBe(false);
  });
});
