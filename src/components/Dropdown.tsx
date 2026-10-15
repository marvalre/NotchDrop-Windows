import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface Option<T extends string> { value: T; label: string; }

/** A pop-up list drawn INSIDE the island window. The native <select> list on Windows is a
 * separate popup that can extend below the panel, so moving the pointer down to choose made
 * the island think the pointer had left and close mid-choice. This one never leaves the
 * window: it opens down or up, whichever fits, and scrolls when long (the currency list). */
export function Dropdown<T extends string>({ value, options, onChange, label, disabled, width }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label?: string; disabled?: boolean; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number; minWidth: number }>({ left: 0, top: 0, maxHeight: 200, minWidth: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(options.length * 28 + 8, 260);
    const down = below >= Math.min(want, 140) || below >= above;
    const maxHeight = Math.max(80, Math.min(want, down ? below : above));
    const left = Math.min(r.left, window.innerWidth - Math.max(r.width, 90) - 6);
    setPlace({ left: Math.max(6, left), top: down ? r.bottom + 4 : r.top - 4 - maxHeight, maxHeight, minWidth: r.width });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const outside = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside, true);
    return () => document.removeEventListener("mousedown", outside, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); btn.current?.focus(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    // Keys while open belong to the list; Escape must not also close the island.
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (/^[a-z0-9]$/i.test(e.key)) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="dropdown"
        style={width ? { width } : undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span>{current?.label ?? "—"}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          ref={list}
          className="dropdown-list"
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKey}
          style={{ left: place.left, top: place.top, maxHeight: place.maxHeight, minWidth: place.minWidth }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              <span className="dropdown-check">{o.value === value && <Check size={13} />}</span>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
