// @vitest-environment jsdom
// downloadBackup ใช้ DOM (createElement('a'), URL.createObjectURL) — ต้อง jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBackup, exportData, importData, validateBackup } from "./backup";
import { isEncryptedBackup } from "./crypto";
import { PocketoDB, seedIfEmpty } from "../db/db";

let db: PocketoDB;
let n = 0;

beforeEach(() => {
  db = new PocketoDB(`test-${++n}`);
});

describe("backup round-trip", () => {
  it("export → import กลับมาได้ข้อมูลครบทุกรายการ", async () => {
    await seedIfEmpty(db);
    const main = await db.pockets.toCollection().first();
    await db.tx.bulkAdd([
      {
        type: "IN",
        amount: 3_800_000,
        pocketId: main!.id!,
        categoryId: 1,
        date: "2026-06-01",
        createdAt: 1,
      },
      {
        type: "OUT",
        amount: 32_050,
        pocketId: main!.id!,
        categoryId: 5,
        note: "ราเมง",
        date: "2026-06-02",
        createdAt: 2,
      },
    ]);

    const backup = await exportData(db);
    expect(validateBackup(backup)).toBe(true);
    expect(backup.tx).toHaveLength(2);

    // import ลง DB ใหม่ (จำลองย้ายเครื่อง)
    const db2 = new PocketoDB(`test-import-${n}`);
    await importData(db2, JSON.parse(JSON.stringify(backup)));
    expect(await db2.tx.count()).toBe(2);
    expect(await db2.categories.count()).toBe(backup.categories.length);
    const restored = await db2.tx.where("date").equals("2026-06-02").first();
    expect(restored?.note).toBe("ราเมง");
    expect(restored?.amount).toBe(32_050);
  });

  it("import ทับของเดิม: ข้อมูลเก่าหายหมด เหลือเฉพาะใน backup", async () => {
    await seedIfEmpty(db);
    const backup = await exportData(db);
    await db.tx.add({
      type: "OUT",
      amount: 100,
      pocketId: 1,
      date: "2026-06-03",
      createdAt: 3,
    });
    await importData(db, backup);
    expect(await db.tx.count()).toBe(0);
  });

  it("ไฟล์แปลกปลอม → โยน error และข้อมูลเดิมไม่หาย", async () => {
    await seedIfEmpty(db);
    const before = await db.categories.count();
    await expect(importData(db, { foo: "bar" })).rejects.toThrow();
    expect(await db.categories.count()).toBe(before);
  });

  it("recurring ไป-กลับครบ และไฟล์ v1 เก่า (ไม่มี recurring) นำเข้าได้", async () => {
    await seedIfEmpty(db);
    await db.recurring.add({
      type: "IN",
      amount: 3_800_000,
      pocketId: 1,
      categoryId: 1,
      note: "เงินเดือน",
      day: 25,
      since: "2026-06-01",
      active: 1,
      createdAt: 1,
    });
    const backup = await exportData(db);
    expect(backup.schemaVersion).toBe(2);
    expect(backup.recurring).toHaveLength(1);

    const db2 = new PocketoDB(`test-rec-${n}`);
    await importData(db2, JSON.parse(JSON.stringify(backup)));
    expect(await db2.recurring.count()).toBe(1);

    // ไฟล์ v1 จากแอพเวอร์ชันก่อน — ไม่มี field recurring
    const v1 = { ...backup, schemaVersion: 1 as const };
    delete (v1 as Partial<typeof v1>).recurring;
    const db3 = new PocketoDB(`test-v1-${n}`);
    await importData(db3, JSON.parse(JSON.stringify(v1)));
    expect(await db3.tx.count()).toBe(0);
    expect(await db3.recurring.count()).toBe(0);
    expect(await db3.categories.count()).toBe(backup.categories.length);
  });

  it("seedIfEmpty ไม่ seed ซ้ำหลังผู้ใช้ลบหมวด", async () => {
    await seedIfEmpty(db);
    await db.categories.clear();
    await seedIfEmpty(db);
    expect(await db.categories.count()).toBe(0);
  });
});

describe("validateBackup — ระเบียนเสียต้อง reject สะอาด", () => {
  const valid = {
    app: "pocketo",
    schemaVersion: 2 as const,
    exportedAt: "2026-06-01T00:00:00.000Z",
    pockets: [{ id: 1, name: "หลัก", icon: "👛", isMain: 1, sortOrder: 0 }],
    categories: [{ id: 1, name: "อาหาร", icon: "🍜", type: "expense", sortOrder: 0 }],
    tx: [
      { id: 1, type: "OUT", amount: 100, pocketId: 1, date: "2026-06-01", createdAt: 1 },
    ],
    recurring: [] as unknown[],
  };

  it("ไฟล์รูปครบถูกต้อง → true", () => {
    expect(validateBackup(valid)).toBe(true);
  });

  it("tx.amount ไม่ใช่ตัวเลข → false", () => {
    expect(
      validateBackup({
        ...valid,
        tx: [{ id: 1, type: "OUT", amount: "100", pocketId: 1, date: "2026-06-01", createdAt: 1 }],
      }),
    ).toBe(false);
  });

  it("tx.date เป็นวันปฏิทินที่ไม่มีจริง → false", () => {
    expect(
      validateBackup({
        ...valid,
        tx: [{ id: 1, type: "OUT", amount: 100, pocketId: 1, date: "2026-13-40", createdAt: 1 }],
      }),
    ).toBe(false);
  });

  it("pocket.allocPercent เกิน 100 → false", () => {
    expect(
      validateBackup({
        ...valid,
        pockets: [{ id: 1, name: "x", icon: "💰", isMain: 0, sortOrder: 0, allocPercent: 150 }],
      }),
    ).toBe(false);
  });

  it("recurring weekly ที่ day นอกช่วง 0–6 → false (กัน engine วนไม่รู้จบตอนเปิดแอพ)", () => {
    expect(
      validateBackup({
        ...valid,
        recurring: [
          {
            id: 1,
            type: "IN",
            amount: 100,
            pocketId: 1,
            freq: "weekly",
            day: 25,
            since: "2026-06-01",
            active: 1,
            createdAt: 1,
          },
        ],
      }),
    ).toBe(false);
  });

  it.each(["2026-02-30", "2025-02-29", "2026-04-31"])(
    "วันที่ %s ไม่มีจริง → false",
    (date) => {
      expect(validateBackup({ ...valid, tx: [{ ...valid.tx[0], date }] })).toBe(false);
    },
  );

  it("ยอดติดลบ, id ซ้ำ/หาย และ foreign key กำพร้า → false", () => {
    expect(validateBackup({ ...valid, tx: [{ ...valid.tx[0], amount: -100 }] })).toBe(false);
    expect(
      validateBackup({
        ...valid,
        pockets: [...valid.pockets, { ...valid.pockets[0], isMain: 0 }],
      }),
    ).toBe(false);
    expect(validateBackup({ ...valid, tx: [{ ...valid.tx[0], id: undefined }] })).toBe(false);
    expect(validateBackup({ ...valid, tx: [{ ...valid.tx[0], pocketId: 999 }] })).toBe(false);
  });

  it("ต้องมี main pocket เดียว และ allocation รวมต้องไม่เกิน 100", () => {
    expect(validateBackup({ ...valid, pockets: [{ ...valid.pockets[0], isMain: 0 }] })).toBe(false);
    expect(
      validateBackup({
        ...valid,
        pockets: [
          valid.pockets[0],
          { id: 2, name: "ออม", icon: "🏦", isMain: 0, sortOrder: 1, allocPercent: 60 },
          { id: 3, name: "เที่ยว", icon: "✈️", isMain: 0, sortOrder: 2, allocPercent: 50 },
        ],
      }),
    ).toBe(false);
  });

  it("TRANSFER และ category type ต้องรักษา referential invariant", () => {
    const twoPockets = [
      valid.pockets[0],
      { id: 2, name: "ออม", icon: "🏦", isMain: 0 as const, sortOrder: 1 },
    ];
    expect(
      validateBackup({
        ...valid,
        pockets: twoPockets,
        tx: [{ ...valid.tx[0], type: "TRANSFER", toPocketId: 999, categoryId: undefined }],
      }),
    ).toBe(false);
    expect(
      validateBackup({ ...valid, tx: [{ ...valid.tx[0], type: "IN", categoryId: 1 }] }),
    ).toBe(false);
  });
});

describe("downloadBackup (jsdom DOM path)", () => {
  let createObjSpy: ReturnType<typeof vi.fn>;
  let revokeObjSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;
  // เก็บ {type, ข้อความ JSON ดิบที่ส่งเข้า Blob} — เลี่ยง blob.text() ที่ jsdom ไม่รองรับ
  let blobs: Array<{ type: string; text: string }>;

  beforeEach(() => {
    blobs = [];
    createObjSpy = vi.fn(() => "blob:sentinel");
    revokeObjSpy = vi.fn();
    // jsdom ไม่มี URL.createObjectURL — stub เอง
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjSpy });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjSpy });
    clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
    // ดัก parts/type ที่ถูกส่งเข้า Blob — downloadBackup ส่ง [JSON.stringify(...)] เสมอ
    const RealBlob = globalThis.Blob;
    vi.spyOn(globalThis, "Blob").mockImplementation((parts?: BlobPart[], opts?: BlobPropertyBag) => {
      blobs.push({ type: opts?.type ?? "", text: (parts ?? []).join("") });
      return new RealBlob(parts ?? [], opts);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("export ธรรมดา: ชื่อไฟล์ pocketo-backup-<en-CA>.json และเขียน kv lastExport", async () => {
    await seedIfEmpty(db);
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "download", "set");
    await downloadBackup(db);

    const expectDate = new Date().toLocaleDateString("en-CA");
    expect(downloadSpy).toHaveBeenCalledWith(`pocketo-backup-${expectDate}.json`);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjSpy).toHaveBeenCalledWith("blob:sentinel");
    expect(typeof (await db.kv.get("lastExport"))?.value).toBe("number");
  });

  it("Blob เป็น application/json และ parse กลับเป็น backup ได้", async () => {
    await seedIfEmpty(db);
    await downloadBackup(db);
    const blob = blobs.at(-1)!;
    expect(blob.type).toBe("application/json");
    const parsed = JSON.parse(blob.text);
    expect(validateBackup(parsed)).toBe(true);
  });

  it("export เข้ารหัส: ชื่อไฟล์มี 'encrypted-' และ payload เป็น EncryptedBackup", async () => {
    await seedIfEmpty(db);
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, "download", "set");
    await downloadBackup(db, "hunter2pw");

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(String(downloadSpy.mock.calls[0][0])).toContain("encrypted-");
    const parsed = JSON.parse(blobs.at(-1)!.text);
    expect(isEncryptedBackup(parsed)).toBe(true);
    expect(parsed.encrypted).toBe(true);
  });
});
