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
const isSafeInt = (v: unknown): v is number =>
  isNum(v) && Number.isSafeInteger(v);
const isPositiveInt = (v: unknown): v is number => isSafeInt(v) && v > 0;
const isTimestamp = (v: unknown): v is number => isSafeInt(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** YYYY-MM-DD ที่ parse เป็นวันจริงได้ — วันเสียทำให้ engine รายการประจำวนไม่รู้จบ */
function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
}

const TX_TYPES = new Set(["IN", "OUT", "TRANSFER", "INIT"]);
const FREQS = new Set(["monthly", "weekly", "yearly"]);

function isValidTx(v: unknown): boolean {
  return (
    isObj(v) &&
    isPositiveInt(v.id) &&
    TX_TYPES.has(v.type as string) &&
    isPositiveInt(v.amount) &&
    isPositiveInt(v.pocketId) &&
    (v.toPocketId === undefined || isPositiveInt(v.toPocketId)) &&
    (v.categoryId === undefined || isPositiveInt(v.categoryId)) &&
    (v.parentId === undefined || isPositiveInt(v.parentId)) &&
    isISODate(v.date) &&
    isTimestamp(v.createdAt)
  );
}

function isValidPocket(v: unknown): boolean {
  return (
    isObj(v) &&
    isPositiveInt(v.id) &&
    isStr(v.name) &&
    v.name.trim().length > 0 &&
    isStr(v.icon) &&
    (v.isMain === 0 || v.isMain === 1) &&
    isSafeInt(v.sortOrder) &&
    (v.goal === undefined || isPositiveInt(v.goal)) &&
    (v.allocPercent === undefined ||
      (isNum(v.allocPercent) && v.allocPercent >= 0 && v.allocPercent <= 100))
  );
}

function isValidCategory(v: unknown): boolean {
  return (
    isObj(v) &&
    isPositiveInt(v.id) &&
    isStr(v.name) &&
    v.name.trim().length > 0 &&
    isStr(v.icon) &&
    (v.type === "income" || v.type === "expense") &&
    isSafeInt(v.sortOrder) &&
    (v.budget === undefined || isPositiveInt(v.budget))
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
    isPositiveInt(v.id) &&
    (v.type === "IN" || v.type === "OUT") &&
    isPositiveInt(v.amount) &&
    isPositiveInt(v.pocketId) &&
    (v.categoryId === undefined || isPositiveInt(v.categoryId)) &&
    isISODate(v.since) &&
    (v.lastPosted === undefined || isISODate(v.lastPosted)) &&
    (v.active === 0 || v.active === 1) &&
    isTimestamp(v.createdAt) &&
    (freq !== "monthly" || (Number.isInteger(v.day) && v.day >= 1 && v.day <= 31)) &&
    (freq !== "yearly" ||
      (Number.isInteger(v.day) &&
        v.day >= 1 &&
        v.day <= 31 &&
        Number.isInteger(v.month) &&
        (v.month as number) >= 1 &&
        (v.month as number) <= 12))
  );
}

function hasUniqueIds(rows: Array<{ id?: number }>): boolean {
  const ids = rows.map((row) => row.id);
  return ids.every(isPositiveInt) && new Set(ids).size === ids.length;
}

function hasSemanticIntegrity(data: BackupFile): boolean {
  if (
    !hasUniqueIds(data.pockets) ||
    !hasUniqueIds(data.categories) ||
    !hasUniqueIds(data.tx) ||
    !hasUniqueIds(data.recurring ?? []) ||
    data.pockets.filter((pocket) => pocket.isMain === 1).length !== 1
  ) {
    return false;
  }

  const pocketIds = new Set(data.pockets.map((pocket) => pocket.id!));
  const categories = new Map(data.categories.map((category) => [category.id!, category]));
  const txById = new Map(data.tx.map((tx) => [tx.id!, tx]));
  const allocationTotal = data.pockets
    .filter((pocket) => pocket.isMain === 0)
    .reduce((sum, pocket) => sum + (pocket.allocPercent ?? 0), 0);
  if (allocationTotal > 100) return false;

  for (const tx of data.tx) {
    if (!pocketIds.has(tx.pocketId)) return false;
    if (tx.type === "TRANSFER") {
      if (
        !tx.toPocketId ||
        !pocketIds.has(tx.toPocketId) ||
        tx.toPocketId === tx.pocketId ||
        tx.categoryId !== undefined
      ) {
        return false;
      }
    } else if (tx.toPocketId !== undefined) {
      return false;
    }

    if (tx.categoryId !== undefined) {
      const category = categories.get(tx.categoryId);
      if (
        !category ||
        (tx.type === "IN" && category.type !== "income") ||
        (tx.type === "OUT" && category.type !== "expense") ||
        (tx.type !== "IN" && tx.type !== "OUT")
      ) {
        return false;
      }
    }

    if (tx.parentId !== undefined) {
      const parent = txById.get(tx.parentId);
      if (tx.type !== "TRANSFER" || !parent || parent.type !== "IN") return false;
    }
  }

  for (const recurring of data.recurring ?? []) {
    if (!pocketIds.has(recurring.pocketId)) return false;
    if (recurring.categoryId !== undefined) {
      const category = categories.get(recurring.categoryId);
      if (
        !category ||
        (recurring.type === "IN" && category.type !== "income") ||
        (recurring.type === "OUT" && category.type !== "expense")
      ) {
        return false;
      }
    }
  }
  return true;
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
  const structurallyValid =
    d.pockets.every(isValidPocket) &&
    d.categories.every(isValidCategory) &&
    d.tx.every(isValidTx) &&
    (d.recurring === undefined || d.recurring.every(isValidRecurring));
  return structurallyValid && hasSemanticIntegrity(d as unknown as BackupFile);
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
