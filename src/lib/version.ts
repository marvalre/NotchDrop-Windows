/** Numeric dotted-version compare (port of UpdateVersion.isNewer, macOS). Accepts a leading "v";
 * anything unparsable is never "newer". */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const s = v.trim().replace(/^v/i, "");
    if (!/^\d+(\.\d+)*$/.test(s)) return null;
    return s.split(".").map(Number);
  };
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const RELEASES_API = "https://api.github.com/repos/marvalre/NotchDrop-Windows/releases/latest";
