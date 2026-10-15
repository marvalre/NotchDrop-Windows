// Result + status line of the Currency tab — port of updateCurrencyDisplay / formatCurrencyAmount
// (macOS), so both apps show exactly the same text.
import { evaluateArithmetic, parseTaxPercent } from "./calc";

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,234.50 EUR" */
export function formatAmount(value: number, code: string): string {
  return `${nf.format(value)} ${code}`;
}

export function currencyDisplay(
  typed: string, from: string, to: string, taxOn: boolean, taxText: string,
  rate: { rate: number; date: string } | null,
): { result: string; status: string } {
  const base = evaluateArithmetic(typed);
  if (base === null) {
    return { result: "—", status: typed.trim() === "" ? "Escribe un monto — también acepta operaciones como 25*4" : `No se puede calcular «${typed}»` };
  }
  const parts: string[] = [];
  const trimmed = typed.trim();
  if (/[+\-*/×÷()]/.test(trimmed.slice(1))) parts.push(`${trimmed} = ${formatAmount(base, from)}`);

  let amount = base;
  const tax = taxOn ? parseTaxPercent(taxText) : null;
  if (tax !== null) {
    amount = base * (1 + tax / 100);
    const label = Number.isInteger(tax) ? tax.toFixed(0) : tax.toFixed(2);
    parts.push(`+${label}% = ${formatAmount(amount, from)}`);
  }

  if (from === to) {
    parts.push("Misma moneda");
    return { result: formatAmount(amount, to), status: parts.join(" · ") };
  }
  if (rate) {
    parts.push(`1 ${from} = ${rate.rate.toFixed(4)} ${to} · ${rate.date}`);
    return { result: formatAmount(amount * rate.rate, to), status: parts.join(" · ") };
  }
  parts.push("Cargando tasas…");
  return { result: "—", status: parts.join(" · ") };
}
