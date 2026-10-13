import { describe, expect, it } from "vitest";
import { AlarmStore, GRACE_SECONDS, MAX_ALARMS, pillText } from "./alarms";

const t0 = 2_000_000_000;
const at = (s: number) => t0 + s * 1000;

describe("AlarmStore", () => {
  it("varias alarmas conviven, ordenadas por hora", () => {
    const s = new AlarmStore();
    const a5 = s.add(at(300), 5);
    const a8 = s.add(at(480), 8);
    const a2 = s.add(at(120), 2);
    expect(s.items.map((i) => i.id)).toEqual([a2.id, a5.id, a8.id]);
    expect(s.next?.id).toBe(a2.id);
  });
  it("cada una suena a su hora", () => {
    const s = new AlarmStore();
    const a2 = s.add(at(120), 2);
    const a5 = s.add(at(300), 5);
    const a8 = s.add(at(480), 8);
    expect(s.settle(at(60)).ring).toEqual([]);
    expect(s.settle(at(121)).ring.map((i) => i.id)).toEqual([a2.id]);
    expect(s.settle(at(301)).ring.map((i) => i.id)).toEqual([a5.id]);
    expect(s.items.map((i) => i.id)).toEqual([a8.id]);
  });
  it("pasado el margen de gracia se marca perdida y no suena", () => {
    const s = new AlarmStore();
    const a = s.add(at(60), 1);
    const r = s.settle(at(60 + GRACE_SECONDS + 1));
    expect(r.ring).toEqual([]);
    expect(r.missed.map((i) => i.id)).toEqual([a.id]);
    expect(s.items).toEqual([]);
  });
  it("justo en el margen todavía suena", () => {
    const s = new AlarmStore();
    s.add(at(60), 1);
    expect(s.settle(at(60 + GRACE_SECONDS)).ring.length).toBe(1);
  });
  it("cancelar una no toca las demás", () => {
    const s = new AlarmStore();
    const x = s.add(at(60), 1);
    const y = s.add(at(90), 2);
    s.remove(x.id);
    expect(s.items.map((i) => i.id)).toEqual([y.id]);
  });
  it(`tope de ${MAX_ALARMS}`, () => {
    const s = new AlarmStore();
    for (let i = 0; i < MAX_ALARMS + 3; i++) s.add(at(60 * (i + 1)), i + 1);
    expect(s.items.length).toBe(MAX_ALARMS);
  });
  it("se guarda y se recupera; basura → vacío", () => {
    const s = new AlarmStore();
    s.add(at(60), 1);
    const back = AlarmStore.fromJSON(s.toJSON());
    expect(back.items).toEqual(s.items);
    expect(AlarmStore.fromJSON("basura").items).toEqual([]);
    expect(AlarmStore.fromJSON('[{"id":1}]').items).toEqual([]);
  });
});

describe("pillText", () => {
  it("minutos arriba de 10 min, m:ss abajo, ·N con varias", () => {
    expect(pillText(750, 1)).toBe("12m");
    expect(pillText(125, 1)).toBe("2:05");
    expect(pillText(125, 3)).toBe("2:05·3");
    expect(pillText(-4, 1)).toBe("0:00");
  });
});
