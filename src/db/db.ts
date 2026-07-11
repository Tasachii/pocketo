import Dexie, { type EntityTable } from "dexie";
import type { Category, Pocket, Recurring, Tx } from "../core/types";

export interface KV {
  key: string;
  value: unknown;
}

export class PocketoDB extends Dexie {
  tx!: EntityTable<Tx, "id">;
  pockets!: EntityTable<Pocket, "id">;
  categories!: EntityTable<Category, "id">;
  recurring!: EntityTable<Recurring, "id">;
  kv!: EntityTable<KV, "key">;

  constructor(name = "pocketo") {
    super(name);
    // schema v1 — ทุกการแก้โครงสร้างในอนาคตต้องเพิ่ม version ใหม่ ห้ามแก้บรรทัดนี้
    this.version(1).stores({
      tx: "++id, date, type, pocketId, categoryId",
      pockets: "++id, sortOrder",
      categories: "++id, type, sortOrder",
      kv: "key",
    });
    // schema v2 — เพิ่มรายการประจำ (budget ของ category เป็น field ใหม่ ไม่ต้อง index)
    this.version(2).stores({
      recurring: "++id, active",
    });
  }
}

export const db = new PocketoDB();

export const DEFAULT_POCKET: Omit<Pocket, "id"> = {
  name: "ใช้จ่าย",
  icon: "👛",
  isMain: 1,
  sortOrder: 0,
};

export const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  // รายรับ
  { name: "เงินเดือน", icon: "💼", type: "income", sortOrder: 0 },
  { name: "โบนัส", icon: "🎁", type: "income", sortOrder: 1 },
  { name: "รายได้เสริม", icon: "🛠️", type: "income", sortOrder: 2 },
  { name: "ดอกเบี้ย/ปันผล", icon: "📈", type: "income", sortOrder: 3 },
  // รายจ่าย — จัดเข้า 4 เสาแบบ kakeibo
  { name: "อาหาร", icon: "🍜", type: "expense", group: "needs", sortOrder: 0 },
  { name: "เดินทาง", icon: "🚆", type: "expense", group: "needs", sortOrder: 1 },
  { name: "บ้าน/บิล", icon: "🏠", type: "expense", group: "needs", sortOrder: 2 },
  { name: "ของใช้จำเป็น", icon: "🧺", type: "expense", group: "needs", sortOrder: 3 },
  { name: "สุขภาพ", icon: "💊", type: "expense", group: "needs", sortOrder: 4 },
  { name: "กาแฟ/คาเฟ่", icon: "☕", type: "expense", group: "wants", sortOrder: 5 },
  { name: "ช้อปปิ้ง", icon: "🛍️", type: "expense", group: "wants", sortOrder: 6 },
  { name: "บันเทิง", icon: "🎬", type: "expense", group: "wants", sortOrder: 7 },
  { name: "หนังสือ/เรียนรู้", icon: "📚", type: "expense", group: "culture", sortOrder: 8 },
  { name: "ให้/บริจาค", icon: "🤝", type: "expense", group: "culture", sortOrder: 9 },
  { name: "ซ่อม/ฉุกเฉิน", icon: "🔧", type: "expense", group: "extra", sortOrder: 10 },
];

/** seed ครั้งแรกเท่านั้น — ผู้ใช้ลบ/แก้ของตัวเองได้โดยไม่ถูก seed ทับ */
export async function seedIfEmpty(database: PocketoDB = db): Promise<void> {
  await database.transaction(
    "rw",
    [database.pockets, database.categories, database.kv],
    async () => {
      const seeded = await database.kv.get("seeded");
      if (!seeded) {
        if ((await database.pockets.count()) === 0) {
          await database.pockets.add(DEFAULT_POCKET as Pocket);
        }
        if ((await database.categories.count()) === 0) {
          await database.categories.bulkAdd(DEFAULT_CATEGORIES as Category[]);
        }
        await database.kv.put({ key: "seeded", value: 1 });
      }

      // Legacy/corrupt data can have no main pocket (or more than one). Repair it at boot
      // under the same write lock, without re-seeding user-deleted pockets/categories.
      const pockets = (await database.pockets.toArray()).sort(
        (a, b) => a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0),
      );
      if (pockets.length === 0) return;
      const winner = pockets.find((pocket) => pocket.isMain === 1) ?? pockets[0];
      for (const pocket of pockets) {
        const isMain = pocket.id === winner.id ? 1 : 0;
        if (pocket.isMain !== isMain) {
          await database.pockets.update(pocket.id!, { isMain });
        }
      }
    },
  );
}
