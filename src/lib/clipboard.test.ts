import { describe, expect, it } from "vitest";
import { ClipboardHistory, MAX_CAPTURED_BYTES, MAX_IMAGE_TOTAL, MAX_ITEMS, preview, shouldCapture } from "./clipboard";

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

const img = (n: number, bytes = 1000) => ({ kind: "image" as const, url: `data:image/png;base64,${n}`, bytes });

describe("ClipboardHistory", () => {
  it("lo más reciente arriba, sin duplicados", () => {
    const h = new ClipboardHistory();
    h.pushText("a"); h.pushText("b"); h.pushText("a");
    expect(h.texts()).toEqual(["a", "b"]);
  });
  it(`guarda como máximo ${MAX_ITEMS}`, () => {
    const h = new ClipboardHistory();
    for (let i = 0; i < MAX_ITEMS + 5; i++) h.pushText(`t${i}`);
    expect(h.items.length).toBe(MAX_ITEMS);
    expect(h.texts()[0]).toBe(`t${MAX_ITEMS + 4}`);
  });
  it("ignora lo que no se debe capturar", () => {
    const h = new ClipboardHistory();
    h.pushText("");
    expect(h.items).toEqual([]);
  });
  it("texto e imágenes conviven; la misma imagen no se repite", () => {
    const h = new ClipboardHistory();
    h.pushText("hola"); h.push(img(1)); h.push(img(1));
    expect(h.items.map((i) => i.kind)).toEqual(["image", "text"]);
  });
  it("las imágenes no pasan del tope total: se van las más viejas", () => {
    const h = new ClipboardHistory();
    const big = Math.floor(MAX_IMAGE_TOTAL / 2.5);
    h.push(img(1, big)); h.pushText("t"); h.push(img(2, big)); h.push(img(3, big));
    const urls = h.items.filter((i) => i.kind === "image").map((i) => (i as { url: string }).url);
    expect(urls).toEqual([img(3).url, img(2).url]);
    expect(h.texts()).toEqual(["t"]);
  });
  it("solo el texto se guarda en disco", () => {
    const h = new ClipboardHistory();
    h.pushText("a"); h.push(img(1));
    expect(h.persistable()).toEqual(["a"]);
    expect(ClipboardHistory.restore(["x", 5 as unknown as string]).texts()).toEqual(["x"]);
  });
});
