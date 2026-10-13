/** Same rule as the Rust side: http(s), a dotted host, no spaces. */
export function isSupportedLink(text: string): boolean {
  const t = text.trim();
  const m = /^https?:\/\/([^/?#\s]+)/i.exec(t);
  return !!m && m[1].includes(".") && !/\s/.test(t);
}
