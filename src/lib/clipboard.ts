// Clipboard history rules (port of ClipboardTextPolicy from the macOS app).

export const MAX_CAPTURED_BYTES = 1024 * 1024;
export const PREVIEW_CHARACTERS = 300;
export const MAX_ITEMS = 12;

export function shouldCapture(text: string): boolean {
  return text.length > 0 && new TextEncoder().encode(text).length <= MAX_CAPTURED_BYTES;
}

/** One line, always: every run of whitespace becomes one space, capped at 300 chars. */
export function preview(text: string): string {
  return text.slice(0, PREVIEW_CHARACTERS * 4).split(/\s+/u).filter(Boolean).join(" ").slice(0, PREVIEW_CHARACTERS);
}

export class ClipboardHistory {
  items: string[] = [];
  push(text: string) {
    if (!shouldCapture(text)) return;
    this.items = [text, ...this.items.filter((t) => t !== text)].slice(0, MAX_ITEMS);
  }
}
