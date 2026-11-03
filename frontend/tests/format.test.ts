import { describe, expect, it } from "vitest";
import { compareDecimal, fmtDate, money, pct, sign, subMoney } from "@/lib/utils";

describe("money", () => {
  it("groups and pads without float conversion", () => {
    expect(money("71019.74")).toBe("71,019.74");
    expect(money("5")).toBe("5.00");
    expect(money("0.1")).toBe("0.10");
    expect(money("12345678901234567.89")).toBe("12,345,678,901,234,567.89");
  });
  it("rounds half up at the third decimal", () => {
    expect(money("3421.4578")).toBe("3,421.46");
    expect(money("0.005")).toBe("0.01");
    expect(money("0.0049")).toBe("0.00");
  });
  it("uses accounting parentheses for negatives, never for zero", () => {
    expect(money("-54.43")).toBe("(54.43)");
    expect(money("-0.001")).toBe("0.00");
  });
  it("shows a dash for missing values", () => {
    expect(money(null)).toBe("—");
    expect(money("", { blank: "n/a" })).toBe("n/a");
  });
});

describe("pct", () => {
  it("shifts the decimal point as text", () => {
    expect(pct("0.035")).toBe("3.5000%");
    expect(pct("0.30000000")).toBe("30.0000%");
    expect(pct("1")).toBe("100.0000%");
    expect(pct("0.1", 2)).toBe("10.00%");
    expect(pct("0.95", 0)).toBe("95%");
  });
});

describe("decimal helpers", () => {
  it("sign", () => {
    expect(sign("12.00")).toBe(1);
    expect(sign("-0.01")).toBe(-1);
    expect(sign("0.00")).toBe(0);
    expect(sign(null)).toBe(0);
  });
  it("compareDecimal orders exactly beyond float precision", () => {
    expect(compareDecimal("9007199254740993.01", "9007199254740993.00")).toBe(1);
    expect(compareDecimal("-1", "0.5")).toBe(-1);
    expect(compareDecimal(null, "1")).toBe(-1);
    expect(["10", "9.99", "-2", "100.01"].sort(compareDecimal)).toEqual(["-2", "9.99", "10", "100.01"]);
  });
  it("subMoney is exact", () => {
    expect(subMoney("78784.50", "31484.53")).toBe("47299.97");
    expect(subMoney("0.10", "0.30")).toBe("-0.20");
    expect(subMoney("100", "100.00")).toBe("0.00");
  });
});

describe("fmtDate", () => {
  it("treats ISO dates as calendar dates", () => {
    expect(fmtDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(fmtDate(null)).toBe("—");
  });
});
