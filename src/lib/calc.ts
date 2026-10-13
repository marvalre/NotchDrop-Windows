// The Currency amount field doubles as a small calculator ("19.99*3").
// Port of evaluateArithmetic / normalizeNumberLiteral from the macOS app: a
// hand-written parser (never eval), returning null for anything it can't read.

/** Turns ONE typed number into something Number() can read, deciding per number.
 * "1,5" is a decimal comma; "1,000" / "12,345" / "1,000,000" are thousands groups;
 * with both separators the last one is the decimal point; anything irregular is null. */
export function normalizeNumberLiteral(lit: string): string | null {
  const commas = [...lit].filter((c) => c === ",").length;
  const dots = [...lit].filter((c) => c === ".").length;
  if (commas === 0) return dots <= 1 ? lit : null;
  const validLeadingGroup = (g: string) => g.length >= 1 && g.length <= 3 && !g.startsWith("0");

  if (dots === 0) {
    const groups = lit.split(",");
    if (commas === 1) {
      if (groups[1].length === 3 && validLeadingGroup(groups[0])) return groups[0] + groups[1];
      return groups[0] + "." + groups[1];
    }
    if (!validLeadingGroup(groups[0]) || !groups.slice(1).every((g) => g.length === 3)) return null;
    return groups.join("");
  }

  const decimalSep = lit.lastIndexOf(",") > lit.lastIndexOf(".") ? "," : ".";
  const groupSep = decimalSep === "," ? "." : ",";
  if ([...lit].filter((c) => c === decimalSep).length !== 1) return null;
  const [intPart, frac] = lit.split(decimalSep);
  const intGroups = intPart.split(groupSep);
  if (!(validLeadingGroup(intGroups[0]) || intGroups.length === 1)) return null;
  if (!intGroups.slice(1).every((g) => g.length === 3)) return null;
  return intGroups.join("") + "." + frac;
}

type Token = { k: "num"; v: number } | { k: "+" | "-" | "*" | "/" | "(" | ")" };

export function evaluateArithmetic(input: string): number | null {
  const tokens: Token[] = [];
  const chars = [...input];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  while (i < chars.length) {
    const c = chars[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (isDigit(c) || c === "." || c === ",") {
      let lit = "";
      while (i < chars.length && (isDigit(chars[i]) || chars[i] === "." || chars[i] === ",")) lit += chars[i++];
      const clean = normalizeNumberLiteral(lit);
      if (clean === null || !/^\d*\.?\d*$/.test(clean) || clean === "." || clean === "") return null;
      const v = Number(clean);
      if (!Number.isFinite(v)) return null;
      tokens.push({ k: "num", v });
      continue;
    }
    const op = c === "×" ? "*" : c === "÷" ? "/" : c;
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "(" || op === ")") tokens.push({ k: op });
    else return null;
    i++;
  }
  if (tokens.length === 0) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const factor = (): number | null => {
    const t = peek();
    if (!t) return null;
    if (t.k === "-") { pos++; const v = factor(); return v === null ? null : -v; }
    if (t.k === "+") { pos++; return factor(); }
    if (t.k === "num") { pos++; return t.v; }
    if (t.k === "(") {
      pos++;
      const v = expression();
      if (v === null || peek()?.k !== ")") return null;
      pos++;
      return v;
    }
    return null;
  };
  const term = (): number | null => {
    let acc = factor();
    if (acc === null) return null;
    while (peek()?.k === "*" || peek()?.k === "/") {
      const op = peek()!.k;
      pos++;
      const rhs = factor();
      if (rhs === null) return null;
      if (op === "/") { if (rhs === 0) return null; acc /= rhs; } else acc *= rhs;
      if (!Number.isFinite(acc)) return null;
    }
    return acc;
  };
  const expression = (): number | null => {
    let acc = term();
    if (acc === null) return null;
    while (peek()?.k === "+" || peek()?.k === "-") {
      const op = peek()!.k;
      pos++;
      const rhs = term();
      if (rhs === null) return null;
      acc = op === "+" ? acc + rhs : acc - rhs;
      if (!Number.isFinite(acc)) return null;
    }
    return acc;
  };
  const result = expression();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/** A tax rate typed by hand: plain non-negative number, comma or point, at most 100. */
export function parseTaxPercent(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

export const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "CNY", "CAD", "AUD", "MXN", "BRL",
  "INR", "KRW", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "TRY",
  "ZAR", "SGD", "HKD", "NZD", "ILS", "PHP", "THB", "IDR", "MYR", "ISK",
];

/** Frankfurter moved from api.frankfurter.app to api.frankfurter.dev/v1; the old host now
 * answers 301 without CORS headers, which a webview treats as a failed request. */
export function rateURL(from: string, to: string): string {
  return `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
