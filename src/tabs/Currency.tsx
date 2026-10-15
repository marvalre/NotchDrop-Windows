import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { CURRENCY_CODES, rateURL } from "../lib/calc";
import { currencyDisplay } from "../lib/currencyDisplay";
import { load, save } from "../lib/store";
import { Dropdown } from "../components/Dropdown";

interface Rate { rate: number; date: string; }
interface CachedRate extends Rate { at: number; }

// Rates from Frankfurter (European Central Bank data, no API key). The ECB publishes once a
// day around 16:00 CET, so a rate is refreshed after 3 hours rather than once per calendar
// day. An older rate is still kept: offline, the last figure stays on screen (as on the Mac).
const RATE_TTL_MS = 3 * 60 * 60 * 1000;
const RATE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function pruneRates(now: number) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("rate:")) continue;
      const v = load<CachedRate | null>(k, null);
      if (!v || typeof v.at !== "number" || now - v.at > RATE_KEEP_MS) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}

const OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

export function Currency() {
  const [amount, setAmount] = useState(() => load("cur:amount", "1"));
  const [from, setFrom] = useState(() => load("cur:from", "USD"));
  const [to, setTo] = useState(() => load("cur:to", "EUR"));
  const [taxOn, setTaxOn] = useState(() => load("cur:taxOn", false));
  const [tax, setTax] = useState(() => load("cur:tax", "16"));
  const [rate, setRate] = useState<Rate | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    save("cur:amount", amount); save("cur:from", from); save("cur:to", to); save("cur:taxOn", taxOn); save("cur:tax", tax);
  }, [amount, from, to, taxOn, tax]);

  // Only the pair triggers a network request, never typing (same as the Mac).
  useEffect(() => {
    setOffline(false);
    if (from === to) { setRate(null); return; }
    const now = Date.now();
    pruneRates(now);
    const key = `rate:${from}:${to}`;
    const cached = load<CachedRate | null>(key, null);
    setRate(cached);
    if (cached && now - cached.at <= RATE_TTL_MS) return;
    let alive = true;
    fetch(rateURL(from, to))
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then((json) => {
        const r = json?.rates?.[to];
        if (typeof r !== "number") throw new Error("sin tasa");
        const next: CachedRate = { rate: r, date: String(json.date ?? ""), at: Date.now() };
        save(key, next);
        if (alive) setRate(next);
      })
      .catch(() => { if (alive) setOffline(true); });
    return () => { alive = false; };
  }, [from, to]);

  const d = currencyDisplay(amount, from, to, taxOn, tax, from === to ? null : rate);
  const status = offline ? "Sin conexión — no se pudo actualizar la tasa" : d.status;

  return (
    <div className="currency">
      <div className="currency-title">Currency</div>
      <div className="currency-row">
        <input className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Monto" />
        <label className="tax">
          <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} /> Impuesto
        </label>
        {taxOn && <><input className="tax-input" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="Impuesto en porcentaje" /><span className="muted">%</span></>}
      </div>
      <div className="pair">
        <Dropdown value={from} options={OPTIONS} onChange={setFrom} label="Moneda de origen" width={92} />
        <button className="swap" aria-label="Invertir monedas" title="Invertir" onClick={() => { setFrom(to); setTo(from); }}><ArrowLeftRight size={17} /></button>
        <Dropdown value={to} options={OPTIONS} onChange={setTo} label="Moneda de destino" width={92} />
      </div>
      <div className="result">{d.result}</div>
      <div className={`muted small center status-line ${offline ? "danger" : ""}`} title={status}>{status}</div>
    </div>
  );
}
