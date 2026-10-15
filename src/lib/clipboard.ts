// Clipboard history rules (port of ClipboardTextPolicy + the image caps of the macOS app).

export const MAX_CAPTURED_BYTES = 1024 * 1024;
export const PREVIEW_CHARACTERS = 300;
export const MAX_ITEMS = 12;
export const MAX_IMAGE_TOTAL = 30 * 1024 * 1024;

export type ClipItem = { kind: "text"; text: string } | { kind: "image"; url: string; bytes: number };

export function shouldCapture(text: string): boolean {
  return text.length > 0 && new TextEncoder().encode(text).length <= MAX_CAPTURED_BYTES;
}

/** One line, always: every run of whitespace becomes one space, capped at 300 chars. */
export function preview(text: string): string {
  return text.slice(0, PREVIEW_CHARACTERS * 4).split(/\s+/u).filter(Boolean).join(" ").slice(0, PREVIEW_CHARACTERS);
}

const same = (a: ClipItem, b: ClipItem) =>
  a.kind === "text" ? b.kind === "text" && a.text === b.text : b.kind === "image" && a.url === b.url;

export class ClipboardHistory {
  items: ClipItem[] = [];

  constructor(items: ClipItem[] = []) { this.items = items; }

  push(item: ClipItem) {
    if (item.kind === "text" && !shouldCapture(item.text)) return;
    const next = [item, ...this.items.filter((i) => !same(i, item))].slice(0, MAX_ITEMS);
    // Screenshots are big: keep the newest images under the total cap, drop the oldest.
    let total = 0;
    this.items = next.filter((i) => {
      if (i.kind !== "image") return true;
      total += i.bytes;
      return total <= MAX_IMAGE_TOTAL;
    });
  }

  pushText(text: string) { this.push({ kind: "text", text }); }

  texts(): string[] { return this.items.flatMap((i) => (i.kind === "text" ? [i.text] : [])); }

  /** Only text goes to disk; images never do (same as the macOS app). */
  persistable(): string[] { return this.texts(); }

  static restore(raw: unknown): ClipboardHistory {
    const arr = Array.isArray(raw) ? raw : [];
    return new ClipboardHistory(arr.filter((x): x is string => typeof x === "string" && shouldCapture(x)).slice(0, MAX_ITEMS).map((text) => ({ kind: "text", text })));
  }
}
