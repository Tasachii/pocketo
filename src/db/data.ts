import { splitByPercent } from "../core/allocate";
import { dueDates } from "../core/recurring";
import type { Pocket, Satang, Tx } from "../core/types";
import { db } from "./db";

export function todayStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function monthKey(y: number, m0: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

/** ยอดคงเหลือทุกกล่อง คำนวณจากรายการเสมอ (ไม่เก็บ balance — ยอดไม่มีวันเพี้ยน) */
export function calcBalances(
  pockets: Pocket[],
  txs: Tx[],
): Map<number, Satang> {
  const m = new Map<number, Satang>();
  for (const p of pockets) m.set(p.id!, 0);
  const add = (id: number, v: Satang) => m.set(id, (m.get(id) ?? 0) + v);
  for (const t of txs) {
    if (t.type === "IN" || t.type === "INIT") add(t.pocketId, t.amount);
    else if (t.type === "OUT") add(t.pocketId, -t.amount);
    else if (t.type === "TRANSFER") {
      add(t.pocketId, -t.amount);
      if (t.toPocketId != null) add(t.toPocketId, t.amount);
    }
  }
  return m;
}

export interface QuickTxInput {
  type: "IN" | "OUT";
  amount: Satang;
  pocketId: number;
  categoryId?: number;
  note?: string;
  date: string;
}

/**
 * บันทึกรายการ — ถ้าเป็นรายรับเข้ากล่องหลักและมีกฎแบ่งอัตโนมัติ
 * จะสร้างรายการโอนไปกล่องอื่นตาม % ให้ทันที (atomic ทั้งชุด)
 */
export async function saveQuickTx(input: QuickTxInput): Promise<void> {
  await db.transaction("rw", [db.tx, db.pockets], async () => {
    const createdAt = Date.now();
    const id = (await db.tx.add({ ...input, createdAt })) as number;
    if (input.type !== "IN") return;
    await createAutoAllocations(id, input.amount, input.pocketId, input.date);
  });
}

/** สร้าง TRANSFER แบ่งอัตโนมัติ (ผูก parentId กลับไปที่รายรับ เพื่อลบ/แก้เป็นชุดได้) */
async function createAutoAllocations(
  parentId: number,
  amount: Satang,
  pocketId: number,
  date: string,
): Promise<void> {
  const pockets = await db.pockets.toArray();
  const main = pockets.find((p) => p.isMain);
  if (!main || pocketId !== main.id) return;
  const rules = pockets
    .filter((p) => !p.isMain && (p.allocPercent ?? 0) > 0)
    .map((p) => ({ pocketId: p.id!, percent: p.allocPercent! }));
  // UI คุมผลรวม ≤ 100 อยู่แล้ว (PocketDialog) — แต่ถ้าข้อมูลนำเข้าเสียจนเกิน 100
  // ข้ามการแบ่งอัตโนมัติ (เงินคงอยู่กล่องหลัก) แทนที่จะให้ splitByPercent throw
  // แล้ว rollback การบันทึกรายรับทั้งก้อน / ทำแอพค้างตอนเปิด (applyDueRecurring)
  if (rules.reduce((s, r) => s + r.percent, 0) > 100) return;
  const createdAt = Date.now();
  for (const a of splitByPercent(amount, rules)) {
    await db.tx.add({
      type: "TRANSFER",
      amount: a.amount,
      pocketId: main.id!,
      toPocketId: a.pocketId,
      // ไม่เก็บ note — การแสดงผลของ TRANSFER ใช้ "โอนไป {กล่อง}" อยู่แล้ว (i18n)
      date,
      parentId,
      createdAt,
    });
  }
}

/**
 * ลบรายการพร้อมรายการแบ่งอัตโนมัติที่เกิดจากมัน (atomic)
 * คืนแถวที่ถูกลบทั้งหมดไว้สำหรับ "เลิกทำ"
 */
export async function deleteTxCascade(id: number): Promise<Tx[]> {
  return db.transaction("rw", [db.tx], async () => {
    const t = await db.tx.get(id);
    if (!t) return [];
    const children =
      t.type === "IN"
        ? await db.tx.filter((x) => x.parentId === id).toArray()
        : [];
    const all = [t, ...children];
    await db.tx.bulkDelete(all.map((x) => x.id!));
    return all;
  });
}

/** กู้รายการที่เพิ่งลบกลับมา (id เดิม — ความเชื่อมโยง parentId ไม่เสีย) */
export async function restoreTxs(rows: Tx[]): Promise<void> {
  await db.tx.bulkAdd(rows);
}

export interface TxPatch {
  amount?: Satang;
  categoryId?: number;
  pocketId?: number;
  toPocketId?: number;
  note?: string;
  date?: string;
}

/**
 * แก้ไขรายการ — ถ้าเป็นรายรับที่ถูกแบ่งอัตโนมัติและยอด/วันที่/กล่องเปลี่ยน
 * จะลบการแบ่งเดิมแล้วแบ่งใหม่ตามกฎปัจจุบัน ให้ยอดกล่องถูกเสมอ
 */
export async function updateTx(id: number, patch: TxPatch): Promise<void> {
  await db.transaction("rw", [db.tx, db.pockets], async () => {
    const t = await db.tx.get(id);
    if (!t) return;
    await db.tx.update(id, patch);
    if (t.type !== "IN") return;
    const children = await db.tx.filter((x) => x.parentId === id).toArray();
    if (children.length === 0) return;
    const next = { ...t, ...patch };
    if (
      next.amount !== t.amount ||
      next.date !== t.date ||
      next.pocketId !== t.pocketId
    ) {
      await db.tx.bulkDelete(children.map((c) => c.id!));
      await createAutoAllocations(id, next.amount, next.pocketId, next.date);
    }
  });
}

/**
 * สร้างรายการจากกฎประจำที่ครบกำหนดแล้วทั้งหมด (เรียกตอนเปิดแอพ)
 * ตามเก็บย้อนหลังทุกเดือนที่พลาด และอัพเดท lastPosted กันสร้างซ้ำ
 */
export async function applyDueRecurring(
  today: string = todayStr(),
): Promise<number> {
  const rules = await db.recurring.where("active").equals(1).toArray();
  let posted = 0;
  for (const r of rules) {
    const dates = dueDates(r, today);
    if (dates.length === 0) continue;
    await db.transaction("rw", [db.tx, db.pockets, db.recurring], async () => {
      for (const date of dates) {
        await saveQuickTx({
          type: r.type,
          amount: r.amount,
          pocketId: r.pocketId,
          categoryId: r.categoryId,
          note: r.note || undefined, // ไม่มี note ของผู้ใช้ → แสดง fallback เป็นชื่อหมวด
          date,
        });
      }
      await db.recurring.update(r.id!, { lastPosted: dates[dates.length - 1] });
    });
    posted += dates.length;
  }
  return posted;
}

export async function transfer(
  fromId: number,
  toId: number,
  amount: Satang,
  date: string,
): Promise<void> {
  if (fromId === toId) throw new Error("กล่องต้นทางและปลายทางต้องต่างกัน");
  if (amount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0");
  // guard เงินไม่พอ อยู่ในชั้นข้อมูล (atomic) — invariant คงอยู่ไม่ว่าใครเรียก
  // คำนวณยอดต้นทางจากรายการในทรานแซกชันเดียวกับการเขียน กัน race
  await db.transaction("rw", [db.tx, db.pockets], async () => {
    const [pockets, txs] = await Promise.all([
      db.pockets.toArray(),
      db.tx.toArray(),
    ]);
    const fromBalance = calcBalances(pockets, txs).get(fromId) ?? 0;
    if (amount > fromBalance) throw new Error("ยอดในกล่องต้นทางไม่พอ");
    await db.tx.add({
      type: "TRANSFER",
      amount,
      pocketId: fromId,
      toPocketId: toId,
      date,
      createdAt: Date.now(),
    });
  });
}
