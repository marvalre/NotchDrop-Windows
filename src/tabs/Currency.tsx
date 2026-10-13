import { useEffect, useState } from "react";
import { CURRENCY_CODES, evaluateArithmetic, parseTaxPercent, rateURL } from "../lib/calc";
import { load, save } from "../lib/store";

interface Rate { rate: number; date: string; }

// Rates from Frankfurter (European Central Bank data, no API key). The ECB publishes once a
// day around 16:00 CET, so a rate is reused for 3 hours, not a whole calendar day (a morning
// fetch would otherwise stick until midnight). Old entries are pruned.
const RATE_TTL_MS = 3 * 60 * 60 * 1000;
interface CachedRate extends Rate { at: number; }

function pruneRates(now: number) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("rate:")) continue;
      const v = load<CachedRate | null>(k, null);
      if (!v || typeof v.at !== "number" || now - v.at > RATE_TTL_MS) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}

async function fetchRate(from: string, to: string): Promise<Rate> {
  const now = Date.now();
  pruneRates(now);
  const key = `rate:${from}:${to}`;
  const cached = load<CachedRate | null>(key, null);
  if (cached && now - cached.at <= RATE_TTL_MS) return cached;
  const res = await fetch(rateURL(from, to));
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  const rate = json?.rates?.[to];
  if (typeof rate !== "number") throw new Error("sin tasa");
  const r: CachedRate = { rate, date: String(json.date ?? ""), at: now };
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
  const [retry, setRetry] = useState(0);

  useEffect(() => { save("cur:amount", amount); save("cur:from", from); save("cur:to", to); }, [amount, from, to]);

  useEffect(() => {
    if (from === to) { setRate({ rate: 1, date: "" }); setError(null); return; }
    let alive = true;
    setRate(null);
    setError(null);
    const id = window.setTimeout(() => {
      fetchRate(from, to)
        .then((r) => { if (alive) { setRate(r); setError(null); } })
        .catch(() => { if (alive) setError("No se pudo obtener la tasa. Revisa tu conexión."); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [from, to, retry]);

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
      <div className="result">{error ? <span className="danger small">{error} <button className="small-btn" onClick={() => setRetry((n) => n + 1)}>Reintentar</button></span> : total !== null ? fmt(total, to) : value === null && amount.trim() ? "—" : "…"}</div>
      {rate && rate.date && <div className="muted small center">1 {from} = {rate.rate.toFixed(4)} {to} · {rate.date}</div>}
    </div>
  );
}
