import { describe, expect, it } from "vitest";
import { ClipboardHistory, MAX_CAPTURED_BYTES, MAX_ITEMS, preview, shouldCapture } from "./clipboard";

describe("preview", () => {
  it("siempre una línea (el bug de la versión Mac 3.14.1)", () => {
    expect(preview("Quiero que continúes\nun proyecto\r\n\n  que empecé")).toBe("Quiero que continúes un proyecto que empecé");
    expect(preview("   \n  hola  ")).toBe("hola");
  });
  it("máximo 300 caracteres", () => {
    expect(preview("x".repeat(5000)).length).toBe(300);
  });
});

describe("shouldCapture", () => {
  it("texto normal sí; vacío o de más de 1 MB no", () => {
    expect(shouldCapture("hola")).toBe(true);
    expect(shouldCapture("")).toBe(false);
    expect(shouldCapture("a".repeat(MAX_CAPTURED_BYTES + 1))).toBe(false);
  });
});

describe("ClipboardHistory", () => {
  it("lo más reciente arriba, sin duplicados", () => {
    const h = new ClipboardHistory();
    h.push("a"); h.push("b"); h.push("a");
    expect(h.items).toEqual(["a", "b"]);
  });
  it(`guarda como máximo ${MAX_ITEMS}`, () => {
    const h = new ClipboardHistory();
    for (let i = 0; i < MAX_ITEMS + 5; i++) h.push(`t${i}`);
    expect(h.items.length).toBe(MAX_ITEMS);
    expect(h.items[0]).toBe(`t${MAX_ITEMS + 4}`);
  });
  it("ignora lo que no se debe capturar", () => {
    const h = new ClipboardHistory();
    h.push("");
    expect(h.items).toEqual([]);
  });
});
