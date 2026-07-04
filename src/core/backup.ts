import type { PocketoDB } from "../db/db";
import { encryptBackup } from "./crypto";
import type { Category, Pocket, Recurring, Tx } from "./types";

export interface BackupFile {
  app: "pocketo";
  /** v1 = ไม่มี recurring, v2 = มี recurring — import รองรับทั้งคู่ */
  schemaVersion: 1 | 2;
  exportedAt: string;
  pockets: Pocket[];
  categories: Category[];
  tx: Tx[];
  recurring?: Recurring[];
}

export async function exportData(db: PocketoDB): Promise<BackupFile> {
  const [pockets, categories, tx, recurring] = await Promise.all([
    db.pockets.toArray(),
    db.categories.toArray(),
    db.tx.toArray(),
    db.recurring.toArray(),
  ]);
  return {
    app: "pocketo",
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    pockets,
    categories,
    tx,
    recurring,
  };
}

/**
 * ดาวน์โหลดไฟล์ backup และจดเวลาส่งออกล่าสุด (ใช้โดยปุ่มตั้งค่าและ banner เตือน)
 * ถ้าใส่ passphrase จะเข้ารหัสไฟล์ด้วย AES-GCM ก่อนดาวน์โหลด
 */
export async function downloadBackup(
  db: PocketoDB,
  passphrase?: string,
): Promise<void> {
  const data = await exportData(db);
  const payload = passphrase
    ? await encryptBackup(data, passphrase)
    : data;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const tag = passphrase ? "encrypted-" : "";
  a.download = `pocketo-${tag}backup-${new Date().toLocaleDateString("en-CA")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  await db.kv.put({ key: "lastExport", value: Date.now() });
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** YYYY-MM-DD ที่ parse เป็นวันจริงได้ — วันเสียทำให้ engine รายการประจำวนไม่รู้จบ */
function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}

const TX_TYPES = new Set(["IN", "OUT", "TRANSFER", "INIT"]);
const FREQS = new Set(["monthly", "weekly", "yearly"]);

function isValidTx(v: unknown): boolean {
  return (
    isObj(v) &&
    TX_TYPES.has(v.type as string) &&
    isNum(v.amount) &&
    isNum(v.pocketId) &&
    isISODate(v.date) &&
    isNum(v.createdAt)
  );
}

function isValidPocket(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.name) &&
    isStr(v.icon) &&
    (v.isMain === 0 || v.isMain === 1) &&
    isNum(v.sortOrder) &&
    (v.allocPercent === undefined ||
      (isNum(v.allocPercent) && v.allocPercent >= 0 && v.allocPercent <= 100))
  );
}

function isValidCategory(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.name) &&
    isStr(v.icon) &&
    (v.type === "income" || v.type === "expense") &&
    isNum(v.sortOrder)
  );
}

/** weekly ต้องมี day เป็น int 0–6 ไม่งั้น engine วนไม่รู้จบตอนเปิดแอพ (ดู core/recurring) */
function isValidRecurring(v: unknown): boolean {
  if (!isObj(v)) return false;
  const freq = v.freq === undefined ? "monthly" : v.freq;
  if (!FREQS.has(freq as string) || !isNum(v.day)) return false;
  if (freq === "weekly" && (!Number.isInteger(v.day) || v.day < 0 || v.day > 6))
    return false;
  return (
    (v.type === "IN" || v.type === "OUT") &&
    isNum(v.amount) &&
    isNum(v.pocketId) &&
    isISODate(v.since) &&
    (v.lastPosted === undefined || isISODate(v.lastPosted)) &&
    (v.active === 0 || v.active === 1) &&
    isNum(v.createdAt)
  );
}

export function validateBackup(data: unknown): data is BackupFile {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (
    d.app !== "pocketo" ||
    !(d.schemaVersion === 1 || d.schemaVersion === 2) ||
    !Array.isArray(d.pockets) ||
    !Array.isArray(d.categories) ||
    !Array.isArray(d.tx) ||
    !(d.recurring === undefined || Array.isArray(d.recurring))
  ) {
    return false;
  }
  // ตรวจรูปทุกระเบียน — ไฟล์เสีย/แก้มือต้อง fail สะอาด ไม่ใช่ทำแอพค้างหรือยอดเพี้ยน
  return (
    d.pockets.every(isValidPocket) &&
    d.categories.every(isValidCategory) &&
    d.tx.every(isValidTx) &&
    (d.recurring === undefined || d.recurring.every(isValidRecurring))
  );
}

/** แทนที่ข้อมูลทั้งหมดด้วย backup (atomic — ล้มเหลวคือ rollback ทั้งก้อน) */
export async function importData(
  db: PocketoDB,
  data: unknown,
): Promise<void> {
  if (!validateBackup(data)) {
    throw new Error("ไฟล์ไม่ใช่ backup ของ Pocketo หรือเวอร์ชันไม่ตรง");
  }
  await db.transaction(
    "rw",
    [db.tx, db.pockets, db.categories, db.recurring, db.kv],
    async () => {
      await Promise.all([
        db.tx.clear(),
        db.pockets.clear(),
        db.categories.clear(),
        db.recurring.clear(),
      ]);
      await db.pockets.bulkAdd(data.pockets);
      await db.categories.bulkAdd(data.categories);
      await db.tx.bulkAdd(data.tx);
      if (data.recurring?.length) await db.recurring.bulkAdd(data.recurring);
      await db.kv.put({ key: "seeded", value: 1 });
    },
  );
}
