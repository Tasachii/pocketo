import { describe, expect, it } from "vitest";
import { clampedDate, dueDates, nextOccurrence } from "./recurring";

describe("clampedDate", () => {
  it("เดือนปกติ", () => {
    expect(clampedDate(2026, 5, 15)).toBe("2026-06-15");
    expect(clampedDate(2026, 0, 31)).toBe("2026-01-31");
  });
  it("วันที่ 31 ในเดือนสั้น เลื่อนเป็นวันสุดท้าย", () => {
    expect(clampedDate(2026, 3, 31)).toBe("2026-04-30");
    expect(clampedDate(2026, 1, 31)).toBe("2026-02-28");
  });
  it("ปีอธิกสุรทิน ก.พ. มี 29 วัน", () => {
    expect(clampedDate(2028, 1, 31)).toBe("2028-02-29");
    expect(clampedDate(2028, 1, 29)).toBe("2028-02-29");
  });
});

describe("dueDates", () => {
  it("กฎใหม่ ยังไม่ถึงวันกำหนด → ว่าง", () => {
    expect(dueDates({ day: 25, since: "2026-06-10" }, "2026-06-20")).toEqual([]);
  });

  it("กฎใหม่ ถึงวันกำหนดเดือนนี้พอดี → ได้ 1 วัน", () => {
    expect(dueDates({ day: 15, since: "2026-06-10" }, "2026-06-15")).toEqual([
      "2026-06-15",
    ]);
  });

  it("ไม่สร้างย้อนหลังก่อนวันสร้างกฎ", () => {
    // สร้างกฎวันที่ 20 มิ.ย. ตั้งทุกวันที่ 10 → 10 มิ.ย. ต้องไม่ถูกสร้าง
    expect(dueDates({ day: 10, since: "2026-06-20" }, "2026-07-15")).toEqual([
      "2026-07-10",
    ]);
  });

  it("วันสร้างกฎตรงวันกำหนดพอดี → นับวันนั้นด้วย (inclusive)", () => {
    expect(dueDates({ day: 10, since: "2026-06-10" }, "2026-06-10")).toEqual([
      "2026-06-10",
    ]);
  });

  it("ตามเก็บย้อนหลังหลายเดือนถ้าไม่ได้เปิดแอพ", () => {
    expect(
      dueDates(
        { day: 1, since: "2026-01-15", lastPosted: "2026-02-01" },
        "2026-06-11",
      ),
    ).toEqual(["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]);
  });

  it("lastPosted เป็น exclusive — ไม่สร้างวันเดิมซ้ำ", () => {
    expect(
      dueDates(
        { day: 11, since: "2026-05-01", lastPosted: "2026-06-11" },
        "2026-06-11",
      ),
    ).toEqual([]);
  });

  it("วันที่ 31 ข้ามเดือนสั้น: เลื่อนตามเดือนและไม่ซ้ำ", () => {
    expect(
      dueDates(
        { day: 31, since: "2026-01-31", lastPosted: "2026-01-31" },
        "2026-04-30",
      ),
    ).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("ข้ามปี: ธ.ค. → ม.ค.", () => {
    expect(
      dueDates(
        { day: 5, since: "2026-11-01", lastPosted: "2026-12-05" },
        "2027-01-10",
      ),
    ).toEqual(["2027-01-05"]);
  });
});

describe("dueDates — weekly", () => {
  // 2026-06-11 คือวันพฤหัส (4)
  it("ตามเก็บทุกสัปดาห์ของวันที่กำหนด", () => {
    expect(
      dueDates({ freq: "weekly", day: 1, since: "2026-06-01" }, "2026-06-16"),
    ).toEqual(["2026-06-01", "2026-06-08", "2026-06-15"]); // วันจันทร์
  });

  it("lastPosted เป็น exclusive", () => {
    expect(
      dueDates(
        { freq: "weekly", day: 1, since: "2026-06-01", lastPosted: "2026-06-08" },
        "2026-06-16",
      ),
    ).toEqual(["2026-06-15"]);
  });

  it("since ไม่ตรงวันกำหนด → เริ่มวันกำหนดแรกถัดไป", () => {
    expect(
      dueDates({ freq: "weekly", day: 0, since: "2026-06-11" }, "2026-06-20"),
    ).toEqual(["2026-06-14"]); // อาทิตย์แรกหลัง since
  });

  it("B2: weekly ที่ day นอกช่วง 0–6 (เช่น 25) → ว่าง ไม่ loop ไม่จบ", () => {
    // guard ใน recurring.ts คืน [] ทันทีเมื่อ day ไม่ใช่ int 0–6 (getDay() คืน 0–6 เสมอ)
    expect(
      dueDates({ freq: "weekly", day: 25, since: "2026-06-01" }, "2026-06-16"),
    ).toEqual([]);
  });

  it("weekly ที่ since parse ไม่ได้ → ว่าง ไม่ loop ไม่จบ", () => {
    expect(
      dueDates({ freq: "weekly", day: 1, since: "not-a-date" }, "2026-06-16"),
    ).toEqual([]);
  });
});

describe("dueDates — yearly", () => {
  it("ปีละครั้ง ตามเก็บข้ามหลายปี", () => {
    expect(
      dueDates(
        { freq: "yearly", day: 15, month: 3, since: "2024-01-01", lastPosted: "2024-03-15" },
        "2026-06-11",
      ),
    ).toEqual(["2025-03-15", "2026-03-15"]);
  });

  it("วันที่ 29 ก.พ. ปีไม่อธิกสุรทิน เลื่อนเป็น 28", () => {
    expect(
      dueDates({ freq: "yearly", day: 29, month: 2, since: "2026-01-01" }, "2026-12-31"),
    ).toEqual(["2026-02-28"]);
  });

  it("ยังไม่ถึงวันกำหนดของปีนี้ → ว่าง", () => {
    expect(
      dueDates({ freq: "yearly", day: 25, month: 12, since: "2026-01-01" }, "2026-06-11"),
    ).toEqual([]);
  });

  it("month (1-12) แมปเป็น month0 ถูกต้อง: month 3 → มีนาคม", () => {
    expect(
      dueDates({ freq: "yearly", day: 10, month: 3, since: "2026-01-01" }, "2026-12-31"),
    ).toEqual(["2026-03-10"]);
  });
});

describe("dueDates — ขอบเขตทั่วไป", () => {
  it("lastPosted === today → ว่าง (ไม่มีอะไรครบกำหนด)", () => {
    expect(
      dueDates({ day: 11, since: "2026-05-01", lastPosted: "2026-06-11" }, "2026-06-11"),
    ).toEqual([]);
  });

  it("since อยู่ในอนาคตเทียบ today → ว่าง", () => {
    expect(dueDates({ day: 15, since: "2026-08-01" }, "2026-06-11")).toEqual([]);
  });
});

describe("legacy: กฎเก่าไม่มี freq = monthly", () => {
  it("ทำงานเหมือน monthly เดิม", () => {
    expect(dueDates({ day: 15, since: "2026-06-10" }, "2026-06-15")).toEqual([
      "2026-06-15",
    ]);
  });
});

describe("nextOccurrence — weekly/yearly", () => {
  it("weekly: วันกำหนดถัดไปหลังวันนี้เสมอ", () => {
    // 2026-06-11 = พฤหัส(4) → พฤหัสถัดไปคือ 18
    expect(
      nextOccurrence({ freq: "weekly", day: 4, since: "2026-01-01" }, "2026-06-11"),
    ).toBe("2026-06-18");
    expect(
      nextOccurrence({ freq: "weekly", day: 5, since: "2026-01-01" }, "2026-06-11"),
    ).toBe("2026-06-12");
  });
  it("weekly ที่ day นอกช่วง 0–6 → คืน today เป็น fallback ไม่ loop ไม่จบ", () => {
    expect(
      nextOccurrence({ freq: "weekly", day: 25, since: "2026-01-01" }, "2026-06-11"),
    ).toBe("2026-06-11");
  });
  it("yearly: ปีนี้ถ้ายังไม่ถึง ไม่งั้นปีหน้า", () => {
    expect(
      nextOccurrence({ freq: "yearly", day: 25, month: 12, since: "2026-01-01" }, "2026-06-11"),
    ).toBe("2026-12-25");
    expect(
      nextOccurrence({ freq: "yearly", day: 1, month: 3, since: "2026-01-01" }, "2026-06-11"),
    ).toBe("2027-03-01");
  });
});

describe("nextOccurrence", () => {
  it("วันกำหนดยังไม่ถึงในเดือนนี้", () => {
    expect(nextOccurrence({ day: 25, since: "2026-01-01" }, "2026-06-11")).toBe(
      "2026-06-25",
    );
  });
  it("วันกำหนดผ่านไปแล้ว → เดือนหน้า", () => {
    expect(nextOccurrence({ day: 5, since: "2026-01-01" }, "2026-06-11")).toBe(
      "2026-07-05",
    );
  });
  it("วันนี้ตรงวันกำหนด → ครั้งถัดไปคือเดือนหน้า", () => {
    expect(nextOccurrence({ day: 11, since: "2026-01-01" }, "2026-06-11")).toBe(
      "2026-07-11",
    );
  });
  it("ข้ามปี", () => {
    expect(nextOccurrence({ day: 10, since: "2026-01-01" }, "2026-12-20")).toBe(
      "2027-01-10",
    );
  });
});
