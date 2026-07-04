import { describe, expect, it } from "vitest";
import {
  bahtToSatang,
  fmt,
  fmtBaht,
  fmtSigned,
  parseAmount,
  satangToBaht,
} from "./money";

describe("parseAmount", () => {
  it("ตัวเลขปกติ", () => {
    expect(parseAmount("1250.50")).toBe(125_050);
    expect(parseAmount("1,250.50")).toBe(125_050);
    expect(parseAmount("0.05")).toBe(5);
    expect(parseAmount("฿ 99")).toBe(9_900);
  });
  it("ค่าที่ไม่ใช่ตัวเลข → null", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.234")).toBeNull(); // ทศนิยมเกิน 2 ตำแหน่ง
    expect(parseAmount("-50")).toBeNull(); // ไม่รับติดลบ (ทิศทางมาจาก type)
  });
});

describe("fmt", () => {
  it("ตัด .00 / คงทศนิยมเมื่อมีเศษ", () => {
    expect(fmt(125_000)).toBe("1,250");
    expect(fmt(125_050)).toBe("1,250.50");
    expect(fmt(5)).toBe("0.05");
    expect(fmtBaht(0)).toBe("฿0");
  });
  it("ค่าติดลบใช้เครื่องหมาย minus จริง (−)", () => {
    expect(fmt(-9_900)).toBe("−99");
  });
  it("float ไม่มีทางเพี้ยน: 0.1+0.2 บาท", () => {
    expect(bahtToSatang(0.1) + bahtToSatang(0.2)).toBe(30);
    expect(fmt(30)).toBe("0.30");
  });
});

describe("bahtToSatang — การปัดเศษ", () => {
  it("ปัดเป็นสตางค์ที่ใกล้ที่สุด (Math.round): 12.345 → 1235", () => {
    expect(bahtToSatang(12.345)).toBe(1_235);
    expect(bahtToSatang(12.344)).toBe(1_234);
  });
});

describe("satangToBaht / fmtSigned", () => {
  it("satangToBaht: สตางค์ → บาท (เลขทศนิยม)", () => {
    expect(satangToBaht(125_050)).toBe(1250.5);
    expect(satangToBaht(0)).toBe(0);
  });
  it("fmtSigned: เครื่องหมายนำหน้าตามทิศทาง in/out", () => {
    expect(fmtSigned(125_000, "in")).toBe("+฿1,250");
    expect(fmtSigned(125_050, "out")).toBe("−฿1,250.50");
  });
});
