import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PocketoDB, seedIfEmpty } from "./db";

// ทดสอบ applyDueRecurring กับ db จริง (fake-indexeddb) — ต้อง mock instance db ใน data.ts
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

const { applyDueRecurring, applyDueRecurringForDb } = await import("./data");

let n = 0;
beforeEach(async () => {
  testDb = new PocketoDB(`apply-test-${++n}`);
  await seedIfEmpty(testDb);
});

describe("applyDueRecurring", () => {
  it("สร้างรายการที่ครบกำหนด + อัพเดท lastPosted + เรียกซ้ำไม่สร้างซ้ำ", async () => {
    const main = (await testDb.pockets.toArray()).find((p) => p.isMain)!;
    await testDb.recurring.add({
      type: "OUT",
      amount: 500_000,
      pocketId: main.id!,
      note: "ค่าเช่า",
      day: 1,
      since: "2026-04-15",
      active: 1,
      createdAt: 1,
    });

    const posted = await applyDueRecurring("2026-06-11");
    expect(posted).toBe(2); // 1 พ.ค. + 1 มิ.ย. (ไม่ย้อนก่อน since)
    expect(await testDb.tx.count()).toBe(2);

    const rule = (await testDb.recurring.toArray())[0];
    expect(rule.lastPosted).toBe("2026-06-01");

    // เรียกซ้ำวันเดียวกัน → ไม่สร้างเพิ่ม
    expect(await applyDueRecurring("2026-06-11")).toBe(0);
    expect(await testDb.tx.count()).toBe(2);
  });

  it("กฎ inactive ไม่ถูกสร้าง", async () => {
    const main = (await testDb.pockets.toArray()).find((p) => p.isMain)!;
    await testDb.recurring.add({
      type: "OUT",
      amount: 100,
      pocketId: main.id!,
      day: 1,
      since: "2026-01-01",
      active: 0,
      createdAt: 1,
    });
    expect(await applyDueRecurring("2026-06-11")).toBe(0);
    expect(await testDb.tx.count()).toBe(0);
  });

  it("รายรับประจำเข้ากล่องหลัก ถูกแบ่งอัตโนมัติตาม % ด้วย", async () => {
    const main = (await testDb.pockets.toArray()).find((p) => p.isMain)!;
    const savingsId = (await testDb.pockets.add({
      name: "ออม",
      icon: "💰",
      isMain: 0,
      allocPercent: 20,
      sortOrder: 1,
    })) as number;
    await testDb.recurring.add({
      type: "IN",
      amount: 1_000_000, // 10,000 บาท
      pocketId: main.id!,
      day: 25,
      since: "2026-05-01",
      active: 1,
      createdAt: 1,
    });

    await applyDueRecurring("2026-05-25");
    const txs = await testDb.tx.toArray();
    expect(txs).toHaveLength(2); // IN + TRANSFER แบ่งอัตโนมัติ
    const tf = txs.find((t) => t.type === "TRANSFER")!;
    expect(tf.toPocketId).toBe(savingsId);
    expect(tf.amount).toBe(200_000); // 20%
  });

  it("สอง tab apply พร้อมกัน → due date แต่ละวันถูกสร้างครั้งเดียว", async () => {
    const name = `apply-concurrent-${++n}`;
    const tabA = new PocketoDB(name);
    await seedIfEmpty(tabA);
    const main = (await tabA.pockets.toArray()).find((p) => p.isMain)!;
    await tabA.recurring.add({
      type: "OUT",
      amount: 250_000,
      pocketId: main.id!,
      note: "ค่าเช่า",
      day: 1,
      since: "2026-04-15",
      active: 1,
      createdAt: 1,
    });
    const tabB = new PocketoDB(name);
    await tabB.open();

    const counts = await Promise.all([
      applyDueRecurringForDb(tabA, "2026-06-11"),
      applyDueRecurringForDb(tabB, "2026-06-11"),
    ]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect((await tabA.tx.orderBy("date").toArray()).map((tx) => tx.date)).toEqual([
      "2026-05-01",
      "2026-06-01",
    ]);
    expect((await tabA.recurring.toCollection().first())?.lastPosted).toBe("2026-06-01");
    tabA.close();
    tabB.close();
  });
});
