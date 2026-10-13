import { describe, expect, it } from "vitest";
import { evaluateArithmetic, parseTaxPercent } from "./calc";

// Same cases as tests/main.swift in the macOS app.
const cases: [string, number | null][] = [
  ["1", 1], ["25.5", 25.5], ["25,5", 25.5], ["  42  ", 42], ["0", 0],
  ["25*4", 100], ["1200/3", 400], ["10+5", 15], ["10-5", 5],
  ["2+3*4", 14], ["(2+3)*4", 20], ["100/4+1", 26], ["1.5*2", 3], ["1,5*2", 3],
  ["19.99*3", 59.97], ["1500+250", 1750], ["(1200+800)/2", 1000], ["50*1.16", 58],
  ["-5", -5], ["-5+10", 5], ["10*-2", -20],
  ["1,000", 1000], ["12,345", 12345], ["1,000,000", 1_000_000],
  ["1,000.50", 1000.5], ["1.000,50", 1000.5], ["1,5", 1.5], ["0,25", 0.25],
  ["1,000+2,5", 1002.5], ["2,5*1,000", 2500], ["1,5+1,5", 3], ["1,000+1,000", 2000],
  ["2,500*2", 5000], ["(1,000+500)/3", 500], ["1,0000", 1], ["0,500", 0.5], ["1,00,000", null],
  ["3×4", 12], ["12÷4", 3],
];
const invalid = ["", "   ", "abc", "5++", "*5", "5*", "(5+3", "5+3)", "()", "5..3", "FUNCTION(1)", "$(whoami)", "5/0", "1e999"];

describe("evaluateArithmetic", () => {
  it.each(cases)("%s", (input, want) => {
    const got = evaluateArithmetic(input);
    if (want === null) expect(got).toBeNull();
    else expect(got).toBeCloseTo(want, 6);
  });
  it.each(invalid)("inválido: %j", (input) => expect(evaluateArithmetic(input)).toBeNull());
});

describe("parseTaxPercent", () => {
  it("acepta 16 y 16,5", () => {
    expect(parseTaxPercent("16")).toBe(16);
    expect(parseTaxPercent("16,5")).toBe(16.5);
  });
  it("rechaza vacío, negativo, >100 y expresiones", () => {
    for (const bad of ["", "-1", "101", "5*2", "1.2.3", "abc"]) expect(parseTaxPercent(bad)).toBeNull();
  });
});
