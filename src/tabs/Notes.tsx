import { useState } from "react";
import { copyText } from "../lib/api";
import { load, save } from "../lib/store";

interface Note { id: string; text: string; at: number; }

// Apple Notes doesn't exist on Windows, so notes live in the app itself.
export function Notes() {
  const [draft, setDraft] = useState(() => load<string>("noteDraft", ""));
  const [notes, setNotes] = useState<Note[]>(() => load<Note[]>("notes", []));
  const [flash, setFlash] = useState<string | null>(null);

  const persist = (n: Note[]) => { setNotes(n); save("notes", n); };
  const saveNote = () => {
    const text = draft.trim();
    if (!text) return;
    persist([{ id: crypto.randomUUID(), text, at: Date.now() }, ...notes]);
    setDraft(""); save("noteDraft", "");
    setFlash("✓ Nota guardada"); setTimeout(() => setFlash(null), 1500);
  };

  return (
    <div className="notes">
      <textarea
        placeholder="Escribe una nota rápida…"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); save("noteDraft", e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote(); }}
      />
      <div className="row">
        <span className="muted small">{flash ?? "Ctrl+Enter para guardar"}</span>
        <button className="small-btn primary" onClick={saveNote}>Guardar nota</button>
      </div>
      <div className="note-list">
        {notes.map((n) => (
          <div className="note" key={n.id}>
            <div className="note-text">{n.text}</div>
            <div className="row">
              <span className="muted small">{new Date(n.at).toLocaleString()}</span>
              <div className="row-gap">
                <button className="small-btn" onClick={() => void copyText(n.text)}>Copiar</button>
                <button className="small-btn" onClick={() => persist(notes.filter((x) => x.id !== n.id))}>Borrar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
