import { describe, expect, it } from "vitest";
import { centsToDecimal, csvCell, csvFilename, CSV_BOM, expensesToCsv } from "./expense-csv";

const names = { m1: "Ana", m2: "Bruno" };

describe("expense CSV (RF-15)", () => {
  it("starts with a UTF-8 BOM so Excel reads the accents", () => {
    const text = expensesToCsv([], names);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    const bytes = new TextEncoder().encode(text);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain("Descrição");
  });

  it("writes one line per expense with cents as decimals and shares that add up", () => {
    const text = expensesToCsv(
      [
        { paid_by: "m1", amount_cents: 10000, spent_on: "2026-10-03", description: "Material escolar", category: "escola", payer_share_bps: 5000, status: "confirmed" },
        { paid_by: "m2", amount_cents: 7, spent_on: "2026-10-12", description: "Pão", category: "alimentacao", payer_share_bps: 3333, status: "pending" },
      ],
      names,
    );
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Data;Descrição;Categoria;Pago por;Valor;Quota do pagador (%);Parte do pagador;Parte do outro;Status");
    expect(lines[1]).toBe("03/10/2026;Material escolar;Escola;Ana;100,00;50;50,00;50,00;Confirmada");
    expect(lines[2]).toBe("12/10/2026;Pão;Alimentação;Bruno;0,07;33,33;0,02;0,05;Pendente");
    expect(lines[3]).toBe("");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("simples")).toBe("simples");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
  });

  it("formats cents without floats", () => {
    expect(centsToDecimal(0)).toBe("0,00");
    expect(centsToDecimal(5)).toBe("0,05");
    expect(centsToDecimal(123456)).toBe("1234,56");
    expect(centsToDecimal(-250)).toBe("-2,50");
  });

  it("names the file after the month", () => {
    expect(csvFilename("2026-10")).toBe("despesas-2026-10.csv");
  });
});
