/** Engine รายการประจำ (รายเดือน/รายสัปดาห์/รายปี) — pure function ทั้งหมด */

import type { RecurringFreq } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** วันที่ day ของเดือนนั้น เลื่อนเป็นวันสุดท้ายถ้าเดือนสั้นกว่า (เช่น 31 → 28 ก.พ.) */
export function clampedDate(year: number, month0: number, day: number): string {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return `${year}-${pad(month0 + 1)}-${pad(Math.min(day, lastDay))}`;
}

export interface RecurringWindow {
  freq?: RecurringFreq;
  /** monthly/yearly: วันที่ 1–31 · weekly: วันของสัปดาห์ 0–6 */
  day: number;
  /** เดือน 1–12 เฉพาะ yearly */
  month?: number;
  since: string;
  lastPosted?: string;
}

interface Bounds {
  lower: string;
  exclusiveLower: boolean;
}

function bounds(rule: RecurringWindow): Bounds {
  const lower =
    rule.lastPosted && rule.lastPosted > rule.since
      ? rule.lastPosted
      : rule.since;
  return {
    lower,
    exclusiveLower: rule.lastPosted !== undefined && lower === rule.lastPosted,
  };
}

const aboveLower = (d: string, b: Bounds) =>
  b.exclusiveLower ? d > b.lower : d >= b.lower;

/**
 * วันครบกำหนดทั้งหมดที่ยังไม่ได้สร้างรายการ จนถึงวันนี้ (รวมวันนี้)
 * - ไม่ย้อนก่อนวันสร้างกฎ (since, inclusive)
 * - ไม่ซ้ำกับที่สร้างแล้ว (lastPosted, exclusive)
 * - ตามเก็บย้อนหลังให้ครบถ้าผู้ใช้ไม่ได้เปิดแอพนาน
 */
export function dueDates(rule: RecurringWindow, today: string): string[] {
  const b = bounds(rule);
  const out: string[] = [];
  const freq = rule.freq ?? "monthly";

  if (freq === "weekly") {
    // getDay() คืน 0–6 เท่านั้น — day นอกช่วงนี้ไม่มีวันตรง วนไม่รู้จบ (กันข้อมูลนำเข้าเสีย)
    if (!Number.isInteger(rule.day) || rule.day < 0 || rule.day > 6) return out;
    const cur = new Date(`${b.lower}T00:00:00`);
    if (Number.isNaN(cur.getTime())) return out; // b.lower parse ไม่ได้ → กันวนไม่รู้จบ
    while (cur.getDay() !== rule.day) cur.setDate(cur.getDate() + 1);
    let d = isoOf(cur);
    while (d <= today) {
      if (aboveLower(d, b)) out.push(d);
      cur.setDate(cur.getDate() + 7);
      d = isoOf(cur);
    }
    return out;
  }

  let y = Number(b.lower.slice(0, 4));
  const ty = Number(today.slice(0, 4));

  if (freq === "yearly") {
    const month0 = (rule.month ?? 1) - 1;
    for (; y <= ty; y++) {
      const d = clampedDate(y, month0, rule.day);
      if (aboveLower(d, b) && d <= today) out.push(d);
    }
    return out;
  }

  // monthly
  let m = Number(b.lower.slice(5, 7)) - 1;
  const tm = Number(today.slice(5, 7)) - 1;
  while (y < ty || (y === ty && m <= tm)) {
    const d = clampedDate(y, m, rule.day);
    if (aboveLower(d, b) && d <= today) out.push(d);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** วันครบกำหนดถัดไป (หลังวันนี้) — ไว้แสดง "กำลังจะถึง" */
export function nextOccurrence(rule: RecurringWindow, today: string): string {
  const freq = rule.freq ?? "monthly";

  if (freq === "weekly") {
    // day นอกช่วง 0–6 หรือ today ที่ parse ไม่ได้ → ไม่วน คืน today เป็น fallback ปลอดภัย
    if (!Number.isInteger(rule.day) || rule.day < 0 || rule.day > 6) return today;
    const cur = new Date(`${today}T00:00:00`);
    if (Number.isNaN(cur.getTime())) return today;
    cur.setDate(cur.getDate() + 1);
    while (cur.getDay() !== rule.day) cur.setDate(cur.getDate() + 1);
    return isoOf(cur);
  }

  let y = Number(today.slice(0, 4));

  if (freq === "yearly") {
    const month0 = (rule.month ?? 1) - 1;
    const thisYear = clampedDate(y, month0, rule.day);
    return thisYear > today ? thisYear : clampedDate(y + 1, month0, rule.day);
  }

  let m = Number(today.slice(5, 7)) - 1;
  for (let i = 0; i < 3; i++) {
    const d = clampedDate(y, m, rule.day);
    if (d > today && d >= rule.since) return d;
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return clampedDate(y, m, rule.day);
}
