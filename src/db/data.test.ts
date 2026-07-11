import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Pocket, Tx } from "../core/types";
import { PocketoDB, seedIfEmpty } from "./db";

// calcBalances เป็น pure function — เทสต์ได้โดยไม่ต้องแตะ DB
// transfer ต้องการ db จริง → mock instance ด้วย getter pattern เดียวกับ tx-edit.test.ts
let testDb: PocketoDB;
vi.mock("./db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./db")>();
  return {
    ...mod,
    get db() {
      return testDb;
    },
  };
});

const { calcBalances, transfer, saveQuickTx, monthKey } = await import("./data");

// helper สร้าง pocket/tx แบบสั้น
const pkt = (id: number): Pocket => ({
  id,
  name: `p${id}`,
  icon: "💰",
  isMain: id === 1 ? 1 : 0,
  sortOrder: id,
});
let txSeq = 0;
const tx = (over: Partial<Tx> & Pick<Tx, "type" | "amount" | "pocketId">): Tx => ({
  date: "2026-06-01",
  createdAt: ++txSeq,
  ...over,
});

describe("calcBalances", () => {
  it("IN สะสมเข้ากล่อง (บวก)", () => {
    const m = calcBalances([pkt(1)], [tx({ type: "IN", amount: 1000, pocketId: 1 })]);
    expect(m.get(1)).toBe(1000);
  });

  it("OUT หักออกจากกล่อง (ลบ)", () => {
    const m = calcBalances(
      [pkt(1)],
      [tx({ type: "IN", amount: 1000, pocketId: 1 }), tx({ type: "OUT", amount: 300, pocketId: 1 })],
    );
    expect(m.get(1)).toBe(700);
  });

  it("INIT สะสมเหมือน IN (ยอดยกมา)", () => {
    const m = calcBalances([pkt(1)], [tx({ type: "INIT", amount: 5000, pocketId: 1 })]);
    expect(m.get(1)).toBe(5000);
  });

  it("TRANSFER หักต้นทาง + เพิ่มปลายทาง", () => {
    const m = calcBalances(
      [pkt(1), pkt(2)],
      [tx({ type: "TRANSFER", amount: 400, pocketId: 1, toPocketId: 2 })],
    );
    expect(m.get(1)).toBe(-400);
    expect(m.get(2)).toBe(400);
  });

  it("TRANSFER ที่ toPocketId == null → หักฝั่งเดียว ไม่ crash ไม่มี key ผี", () => {
    const m = calcBalances([pkt(1)], [tx({ type: "TRANSFER", amount: 400, pocketId: 1 })]);
    expect(m.get(1)).toBe(-400);
    expect(m.size).toBe(1);
  });

  it("txs ว่าง → ทุกกล่อง = 0 (seed จาก pockets)", () => {
    const m = calcBalances([pkt(1), pkt(2), pkt(3)], []);
    expect(m.get(1)).toBe(0);
    expect(m.get(2)).toBe(0);
    expect(m.get(3)).toBe(0);
  });

  it("pockets ว่าง + tx อ้าง pocketId ที่ไม่รู้จัก → สร้าง key ผ่าน ?? 0", () => {
    const m = calcBalances([], [tx({ type: "IN", amount: 250, pocketId: 9 })]);
    expect(m.get(9)).toBe(250);
  });

  it("หลายรายการข้ามหลายกล่อง สะสมแยกกัน", () => {
    const m = calcBalances(
      [pkt(1), pkt(2), pkt(3)],
      [
        tx({ type: "IN", amount: 1000, pocketId: 1 }),
        tx({ type: "OUT", amount: 200, pocketId: 1 }),
        tx({ type: "IN", amount: 500, pocketId: 2 }),
        tx({ type: "TRANSFER", amount: 300, pocketId: 1, toPocketId: 3 }),
      ],
    );
    expect(m.get(1)).toBe(500); // 1000 - 200 - 300
    expect(m.get(2)).toBe(500);
    expect(m.get(3)).toBe(300);
  });

  it("net-zero: IN 1000 แล้ว OUT 1000 บนกล่องเดียวกัน → 0", () => {
    const m = calcBalances(
      [pkt(1)],
      [tx({ type: "IN", amount: 1000, pocketId: 1 }), tx({ type: "OUT", amount: 1000, pocketId: 1 })],
    );
    expect(m.get(1)).toBe(0);
  });

  it("ยอดติดลบได้: OUT 500 โดยไม่มี IN มาก่อน → -500 (เอกสารพฤติกรรม B1)", () => {
    const m = calcBalances([pkt(1)], [tx({ type: "OUT", amount: 500, pocketId: 1 })]);
    expect(m.get(1)).toBe(-500);
  });

  it("invariant: TRANSFER ย้ายเงินโดยผลรวมทุกกล่องไม่เปลี่ยน", () => {
    const pockets = [pkt(1), pkt(2), pkt(3)];
    const before = calcBalances(pockets, [
      tx({ type: "INIT", amount: 1000, pocketId: 1 }),
      tx({ type: "INIT", amount: 2000, pocketId: 2 }),
    ]);
    const sumBefore = [...before.values()].reduce((s, v) => s + v, 0);
    const after = calcBalances(pockets, [
      tx({ type: "INIT", amount: 1000, pocketId: 1 }),
      tx({ type: "INIT", amount: 2000, pocketId: 2 }),
      tx({ type: "TRANSFER", amount: 750, pocketId: 1, toPocketId: 3 }),
    ]);
    const sumAfter = [...after.values()].reduce((s, v) => s + v, 0);
    expect(sumAfter).toBe(sumBefore);
  });
});

describe("transfer", () => {
  let n = 0;
  let mainId: number;
  let savingsId: number;
  beforeEach(async () => {
    testDb = new PocketoDB(`transfer-test-${++n}`);
    await seedIfEmpty(testDb);
    mainId = (await testDb.pockets.toArray()).find((p) => p.isMain)!.id!;
    savingsId = (await testDb.pockets.add({
      name: "ออม",
      icon: "💰",
      isMain: 0,
      sortOrder: 1,
    })) as number;
  });

  it("fromId === toId → throw", async () => {
    await expect(transfer(mainId, mainId, 1000, "2026-06-01")).rejects.toThrow(
      "กล่องต้นทางและปลายทางต้องต่างกัน",
    );
  });

  it("amount <= 0 (0 และ -1) → throw", async () => {
    await expect(transfer(mainId, savingsId, 0, "2026-06-01")).rejects.toThrow(
      "จำนวนเงินต้องมากกว่า 0",
    );
    await expect(transfer(mainId, savingsId, -1, "2026-06-01")).rejects.toThrow(
      "จำนวนเงินต้องมากกว่า 0",
    );
  });

  it("happy path: เพิ่ม TRANSFER row เดียวที่ field ครบถูกต้อง", async () => {
    // ใส่ยอดต้นทางก่อน (D6: guard เงินไม่พอย้ายเข้า transfer แล้ว)
    await testDb.tx.add({
      type: "INIT",
      amount: 100_000,
      pocketId: mainId,
      date: "2026-06-01",
      createdAt: 1,
    });
    await transfer(mainId, savingsId, 25_000, "2026-06-02");
    const rows = (await testDb.tx.toArray()).filter((t) => t.type === "TRANSFER");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.type).toBe("TRANSFER");
    expect(r.pocketId).toBe(mainId);
    expect(r.toPocketId).toBe(savingsId);
    expect(r.amount).toBe(25_000);
    expect(r.date).toBe("2026-06-02");
    expect(typeof r.createdAt).toBe("number");
  });

  // D6: guard เงินไม่พอ ย้ายเข้าชั้น data แล้ว — invariant คงอยู่ไม่ว่าใครเรียก
  it("D6: โอนเกินยอด (ยอดเริ่ม 0) → throw 'ยอดในกล่องต้นทางไม่พอ' และไม่เขียนแถว", async () => {
    await expect(
      transfer(mainId, savingsId, 9_999_999, "2026-06-03"),
    ).rejects.toThrow("ยอดในกล่องต้นทางไม่พอ");
    expect(await testDb.tx.count()).toBe(0);
  });
});

describe("monthKey", () => {
  it("ปี + เดือน (0-indexed) → 'YYYY-MM' เดือน 1-indexed เติมศูนย์", () => {
    expect(monthKey(2026, 0)).toBe("2026-01");
    expect(monthKey(2026, 11)).toBe("2026-12");
  });
});

describe("seedIfEmpty — มีข้อมูลอยู่แล้วแต่ยังไม่เคยตั้ง flag seeded", () => {
  let n = 0;
  it("กล่อง/หมวดมีอยู่แล้ว → ข้าม count===0 ไม่ seed ทับ แต่ตั้ง flag", async () => {
    const dbx = new PocketoDB(`seed-existing-${++n}`);
    await dbx.pockets.add({ name: "x", icon: "💰", isMain: 1, sortOrder: 0 } as Pocket);
    await dbx.categories.add({
      name: "c",
      icon: "🍜",
      type: "expense",
      sortOrder: 0,
    } as Category);
    await seedIfEmpty(dbx);
    expect(await dbx.pockets.count()).toBe(1);
    expect(await dbx.categories.count()).toBe(1);
    expect((await dbx.kv.get("seeded"))?.value).toBe(1);
  });

  it("seeded DB ที่มีกล่องแต่ไม่มี main → promote กล่องแรกตาม sortOrder โดยไม่ seed ทับ", async () => {
    const dbx = new PocketoDB(`seed-repair-none-${++n}`);
    await dbx.pockets.bulkAdd([
      { name: "ที่สอง", icon: "2️⃣", isMain: 0, sortOrder: 2 },
      { name: "ที่หนึ่ง", icon: "1️⃣", isMain: 0, sortOrder: 1 },
    ] as Pocket[]);
    await dbx.kv.put({ key: "seeded", value: 1 });

    await seedIfEmpty(dbx);

    const pockets = await dbx.pockets.orderBy("sortOrder").toArray();
    expect(pockets).toHaveLength(2);
    expect(pockets.filter((p) => p.isMain)).toHaveLength(1);
    expect(pockets.find((p) => p.isMain)?.name).toBe("ที่หนึ่ง");
  });

  it("ข้อมูลเสียที่มี main หลายกล่อง → เหลือ main เดียวอย่าง deterministic", async () => {
    const dbx = new PocketoDB(`seed-repair-many-${++n}`);
    await dbx.pockets.bulkAdd([
      { name: "B", icon: "B", isMain: 1, sortOrder: 5 },
      { name: "A", icon: "A", isMain: 1, sortOrder: 1 },
    ] as Pocket[]);
    await dbx.kv.put({ key: "seeded", value: 1 });

    await seedIfEmpty(dbx);

    const pockets = await dbx.pockets.toArray();
    expect(pockets.filter((p) => p.isMain)).toHaveLength(1);
    expect(pockets.find((p) => p.isMain)?.name).toBe("A");
  });
});

describe("saveQuickTx — auto-allocation guards", () => {
  let n = 0;

  it("รวม % เกิน 100 (ข้อมูลนำเข้าเสีย) → บันทึกรายรับได้ ไม่ throw และไม่มี TRANSFER", async () => {
    testDb = new PocketoDB(`alloc-guard-${++n}`);
    await seedIfEmpty(testDb);
    const mainId = (await testDb.pockets.toArray()).find((p) => p.isMain)!.id!;
    await testDb.pockets.bulkAdd([
      { name: "a", icon: "💰", isMain: 0, sortOrder: 1, allocPercent: 70 },
      { name: "b", icon: "💰", isMain: 0, sortOrder: 2, allocPercent: 60 },
    ] as Pocket[]);
    await expect(
      saveQuickTx({ type: "IN", amount: 100_000, pocketId: mainId, date: "2026-06-01" }),
    ).resolves.toBeUndefined();
    const rows = await testDb.tx.toArray();
    expect(rows.filter((t) => t.type === "TRANSFER")).toHaveLength(0);
    expect(rows.filter((t) => t.type === "IN")).toHaveLength(1);
  });

  it("รายรับเข้ากล่องที่ไม่ใช่กล่องหลัก → ไม่แบ่งอัตโนมัติ (early-return)", async () => {
    testDb = new PocketoDB(`alloc-nonmain-${++n}`);
    await seedIfEmpty(testDb);
    const savingsId = (await testDb.pockets.add({
      name: "s",
      icon: "💰",
      isMain: 0,
      sortOrder: 1,
      allocPercent: 20,
    })) as number;
    await saveQuickTx({ type: "IN", amount: 100_000, pocketId: savingsId, date: "2026-06-01" });
    const rows = await testDb.tx.toArray();
    expect(rows.filter((t) => t.type === "TRANSFER")).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });
});
