// Several alarms at once (port of AlarmStore + AlarmPolicy from the macOS app).
// Times are epoch milliseconds.

export const GRACE_SECONDS = 120;
export const MAX_ALARMS = 10;

export interface AlarmItem { id: string; end: number; minutes: number; }

export class AlarmStore {
  items: AlarmItem[] = [];

  get next(): AlarmItem | undefined { return this.items[0]; }

  add(end: number, minutes: number, id: string = crypto.randomUUID()): AlarmItem {
    const item = { id, end, minutes };
    this.items.push(item);
    this.items.sort((a, b) => a.end - b.end);
    if (this.items.length > MAX_ALARMS) this.items.length = MAX_ALARMS;
    return item;
  }

  remove(id: string) { this.items = this.items.filter((i) => i.id !== id); }

  /** Takes every alarm whose time has come out of the set. A Mac/PC that slept through
   * one doesn't blast it hours late: past the grace period it is reported missed. */
  settle(now: number = Date.now()): { ring: AlarmItem[]; missed: AlarmItem[] } {
    const ring: AlarmItem[] = [], missed: AlarmItem[] = [];
    for (const i of this.items) {
      const late = (now - i.end) / 1000;
      if (late < 0) continue;
      (late <= GRACE_SECONDS ? ring : missed).push(i);
    }
    const done = new Set([...ring, ...missed].map((i) => i.id));
    this.items = this.items.filter((i) => !done.has(i.id));
    return { ring, missed };
  }

  toJSON(): string { return JSON.stringify(this.items); }

  static fromJSON(raw: string | null): AlarmStore {
    const s = new AlarmStore();
    try {
      const arr = JSON.parse(raw ?? "[]");
      if (Array.isArray(arr)) {
        for (const x of arr) {
          if (x && typeof x.id === "string" && typeof x.end === "number" && typeof x.minutes === "number") s.add(x.end, x.minutes, x.id);
        }
      }
    } catch { /* corrupt → empty */ }
    return s;
  }
}

/** The island pill is tiny: "12m" above ten minutes, "2:05" below; "·N" when several are set. */
export function pillText(remainingSeconds: number, count: number): string {
  const s = Math.max(0, Math.floor(remainingSeconds));
  const base = s >= 600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return count > 1 ? `${base}·${count}` : base;
}
