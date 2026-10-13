// Small localStorage helpers. WebView2 keeps localStorage in the app's own data folder,
// and any read can come back empty (first launch) — callers always get a fallback.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
export function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
