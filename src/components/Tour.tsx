import { useLayoutEffect, useState } from "react";

// The macOS first-run tour, same three steps and texts.
export const TOUR_STEPS = [
  { target: '[data-tour="tabs"]', title: "Tus pestañas", text: "Cambia entre Player, Shelf, Tools, Notes, Convert, Currency y Ajustes desde aquí arriba." },
  { target: '[data-tour="shelf"]', title: "Shelf de archivos", text: "Arrastra archivos a la isla en cualquier momento para guardarlos aquí temporalmente." },
  { target: '[data-tour="settings"]', title: "Ajustes", text: "Activa el auto-inicio, desactiva la apertura por hover si te resulta molesta, y más." },
];

export function Tour({ step, onNext, onSkip }: { step: number; onNext: () => void; onSkip: () => void }) {
  const s = TOUR_STEPS[step];
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(s.target);
    const r = el?.getBoundingClientRect();
    setBox(r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
  }, [s.target]);
  const last = step === TOUR_STEPS.length - 1;
  const bubbleLeft = box ? Math.min(Math.max(10, box.left + box.width / 2 - 140), window.innerWidth - 290) : 20;
  const bubbleTop = box ? box.top + box.height + 10 : 60;
  return (
    <div className="tour" role="dialog" aria-label={s.title}>
      {box && <div className="tour-ring" style={{ left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }} />}
      <div className="tour-bubble" style={{ left: bubbleLeft, top: bubbleTop }}>
        <div className="tour-title">{s.title}</div>
        <div className="small">{s.text}</div>
        <div className="row">
          <span className="muted small">{step + 1} / {TOUR_STEPS.length}</span>
          <div className="row-gap">
            {!last && <button className="small-btn" onClick={onSkip}>Saltar</button>}
            <button className="small-btn primary" onClick={onNext}>{last ? "Entendido" : "Siguiente"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
