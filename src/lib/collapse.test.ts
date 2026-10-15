import { describe, expect, it } from "vitest";
import { INITIAL, leaveCollapses, onEnter, onListClosed, onListMouseDown } from "./collapse";

describe("cerrar al alejar el mouse (misma regla que AutoCollapsePolicy de la Mac)", () => {
  it("abierto con el mouse: alejarse cierra", () => {
    expect(leaveCollapses(INITIAL)).toBe(true);
  });
  it("abierto con Ctrl+Alt+N: no cierra hasta haber entrado una vez", () => {
    const s = { ...INITIAL, sticky: true };
    expect(leaveCollapses(s)).toBe(false);
    expect(leaveCollapses(onEnter(s))).toBe(true);
  });
  it("con la lista de monedas abierta nunca cierra", () => {
    const s = onListMouseDown(onEnter(INITIAL));
    expect(s.listOpen).toBe(true);
    expect(leaveCollapses(s)).toBe(false);
  });
  it("al elegir una moneda queda pegado hasta que el cursor vuelve", () => {
    const s = onListClosed(onListMouseDown(onEnter(INITIAL)));
    expect(s.listOpen).toBe(false);
    expect(leaveCollapses(s)).toBe(false);
    expect(leaveCollapses(onEnter(s))).toBe(true);
  });
  it("un segundo clic sobre la lista la cierra (sin quedarse 'abierta' para siempre)", () => {
    const s = onListMouseDown(onListMouseDown(onEnter(INITIAL)));
    expect(s.listOpen).toBe(false);
    expect(leaveCollapses(s)).toBe(false);
  });
  it("un diálogo o arrastre en curso nunca cierra", () => {
    expect(leaveCollapses({ ...INITIAL, modal: true })).toBe(false);
  });
});
