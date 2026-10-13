import { useEffect, useState } from "react";
import { CURRENCY_CODES, evaluateArithmetic, parseTaxPercent } from "../lib/calc";
import { load, save } from "../lib/store";

interface Rate { rate: number; date: string; }

// Rates from Frankfurter (European Central Bank data, no API key), reused for the day.
async function fetchRate(from: string, to: string): Promise<Rate> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `rate:${from}:${to}:${day}`;
  const cached = load<Rate | null>(key, null);
  if (cached) return cached;
  const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  const rate = json?.rates?.[to];
  if (typeof rate !== "number") throw new Error("sin tasa");
  const r = { rate, date: String(json.date ?? day) };
  save(key, r);
  return r;
}

const fmt = (n: number, code: string) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(n); }
  catch { return `${n.toFixed(2)} ${code}`; }
};

export function Currency() {
  const [amount, setAmount] = useState(() => load("cur:amount", "1"));
  const [from, setFrom] = useState(() => load("cur:from", "USD"));
  const [to, setTo] = useState(() => load("cur:to", "MXN"));
  const [taxOn, setTaxOn] = useState(false);
  const [tax, setTax] = useState("16");
  const [rate, setRate] = useState<Rate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { save("cur:amount", amount); save("cur:from", from); save("cur:to", to); }, [amount, from, to]);

  useEffect(() => {
    if (from === to) { setRate({ rate: 1, date: "" }); setError(null); return; }
    let alive = true;
    setRate(null);
    const id = window.setTimeout(() => {
      fetchRate(from, to)
        .then((r) => { if (alive) { setRate(r); setError(null); } })
        .catch(() => { if (alive) setError("No se pudo obtener la tasa. Revisa tu conexión."); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [from, to]);

  const value = evaluateArithmetic(amount);
  const isExpression = value !== null && /[+\-*/×÷()]/.test(amount.trim().replace(/^-/, ""));
  const taxPct = taxOn ? parseTaxPercent(tax) : null;
  const base = value !== null && rate ? value * rate.rate : null;
  const total = base !== null && taxPct !== null ? base * (1 + taxPct / 100) : base;

  return (
    <div className="currency">
      <input className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto o cuenta: 19.99*3" />
      {isExpression && value !== null && <div className="muted small center">= {value.toLocaleString()}</div>}
      <div className="pair">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="swap" aria-label="Invertir" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
        <select value={to} onChange={(e) => setTo(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <label className="tax">
        <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} /> Impuesto
        {taxOn && <><input className="tax-input" value={tax} onChange={(e) => setTax(e.target.value)} /> %</>}
      </label>
      <div className="result">{error ? <span className="danger small">{error}</span> : total !== null ? fmt(total, to) : value === null && amount.trim() ? "—" : "…"}</div>
      {rate && rate.date && <div className="muted small center">1 {from} = {rate.rate.toFixed(4)} {to} · {rate.date}</div>}
    </div>
  );
}
