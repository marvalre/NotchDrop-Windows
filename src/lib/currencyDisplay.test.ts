import { describe, expect, it } from "vitest";
import { currencyDisplay, formatAmount } from "./currencyDisplay";

const rate = { rate: 0.8789, date: "2026-10-15" };

describe("currencyDisplay (igual que updateCurrencyDisplay de la Mac)", () => {
  it("formato de monto: 2 decimales, separador de miles y código", () => {
    expect(formatAmount(1234.5, "EUR")).toBe("1,234.50 EUR");
  });
  it("monto simple", () => {
    expect(currencyDisplay("1", "USD", "EUR", false, "16", rate)).toEqual({ result: "0.88 EUR", status: "1 USD = 0.8789 EUR · 2026-10-15" });
  });
  it("operación: muestra a qué se resolvió", () => {
    expect(currencyDisplay("19.99*3", "USD", "EUR", false, "16", rate).status).toBe("19.99*3 = 59.97 USD · 1 USD = 0.8789 EUR · 2026-10-15");
  });
  it("con impuesto: muestra el paso del impuesto", () => {
    const d = currencyDisplay("100", "USD", "EUR", true, "16", rate);
    expect(d.status).toBe("+16% = 116.00 USD · 1 USD = 0.8789 EUR · 2026-10-15");
    expect(d.result).toBe("101.95 EUR");
    expect(currencyDisplay("100", "USD", "EUR", true, "16,5", rate).status.startsWith("+16.50% = 116.50 USD")).toBe(true);
  });
  it("impuesto inválido se ignora", () => {
    expect(currencyDisplay("100", "USD", "EUR", true, "abc", rate).result).toBe("87.89 EUR");
  });
  it("misma moneda", () => {
    expect(currencyDisplay("5", "USD", "USD", false, "", null)).toEqual({ result: "5.00 USD", status: "Misma moneda" });
  });
  it("sin tasa todavía", () => {
    expect(currencyDisplay("5", "USD", "EUR", false, "", null)).toEqual({ result: "—", status: "Cargando tasas…" });
  });
  it("vacío o inválido", () => {
    expect(currencyDisplay("  ", "USD", "EUR", false, "", rate)).toEqual({ result: "—", status: "Escribe un monto — también acepta operaciones como 25*4" });
    expect(currencyDisplay("25*", "USD", "EUR", false, "", rate)).toEqual({ result: "—", status: "No se puede calcular «25*»" });
  });
});
