import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { fmt, parseAmount } from "../core/money";
import { nextOccurrence } from "../core/recurring";
import type { Recurring, RecurringFreq } from "../core/types";
import { useT } from "../i18n";
import type { Translator } from "../i18n";
import { applyDueRecurring, todayStr } from "../db/data";
import { db } from "../db/db";
import { confirmDialog } from "./Feedback";
import { Field, inputCls, Overlay } from "./Modal";

function freqLabel(r: Recurring, tr: Translator): string {
  const freq = r.freq ?? "monthly";
  if (freq === "weekly")
    return tr.t("rec_everyWeekday", { w: tr.weekday(r.day) });
  if (freq === "yearly")
    return tr.t("rec_everyYear", { d: r.day, m: tr.shortMonth((r.month ?? 1) - 1) });
  return tr.t("rec_everyDay", { d: r.day });
}

/** จัดการรายการประจำรายเดือน (เงินเดือน ค่าเช่า subscription ฯลฯ) */
export function RecurringManager() {
  const tr = useT();
  const { t, name: tName } = tr;
  const rules = useLiveQuery(() => db.recurring.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);

  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c])),
    [categories],
  );
  const today = todayStr();

  const toggle = async (r: Recurring) => {
    // เปิดใช้ใหม่: ข้ามช่วงที่ปิดไว้ ไม่ตามเก็บย้อนหลัง — เริ่มนับจากวันนี้
    await db.recurring.update(r.id!, {
      active: r.active ? 0 : 1,
      ...(r.active ? {} : { lastPosted: today }),
    });
  };

  return (
    <div>
      <ul className="space-y-1">
        {rules.map((r) => {
          const cat = r.categoryId != null ? catById.get(r.categoryId) : undefined;
          const name = r.note || (cat ? tName(cat.name) : t("rec_defaultName"));
          return (
            <li key={r.id} className="flex items-center gap-3 py-1.5">
              <button
                onClick={() => setEditing(r)}
                className="pressable flex min-w-0 flex-1 items-center gap-3 text-left"
                style={{ opacity: r.active ? 1 : 0.45 }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2">
                  {cat?.icon ?? "🔁"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{name}</span>
                  <span className="block text-xs text-faint">
                    {freqLabel(r, tr)} · {t("rec_nextSuffix", { date: tr.date(nextOccurrence(r, today)) })}
                  </span>
                </span>
                <span
                  className="tabular text-sm font-medium"
                  style={{
                    color: r.type === "IN" ? "var(--income)" : "var(--expense)",
                  }}
                >
                  {r.type === "IN" ? "+" : "−"}฿{fmt(r.amount)}
                </span>
              </button>
              <button
                onClick={() => toggle(r)}
                role="switch"
                aria-checked={r.active === 1}
                aria-label={t("rec_aria_toggle", { name })}
                className="pressable relative h-6 w-10 shrink-0 rounded-full transition-colors"
                style={{
                  background: r.active ? "var(--accent)" : "var(--surface2)",
                }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                  style={{ left: r.active ? "calc(100% - 22px)" : "2px" }}
                />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => setEditing("new")}
        className="pressable mt-2 rounded-xl bg-surface2 px-4 py-2 text-sm text-sub"
      >
        {t("rec_add")}
      </button>

      {editing !== null && (
        <RecurringDialog
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RecurringDialog({
  rule,
  onClose,
}: {
  rule: Recurring | null;
  onClose: () => void;
}) {
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const pockets =
    useLiveQuery(() => db.pockets.orderBy("sortOrder").toArray(), []) ?? [];
  const main = pockets.find((p) => p.isMain);

  const { t, name: tName, weekday, shortMonth } = useT();
  const [type, setType] = useState<"IN" | "OUT">(rule?.type ?? "OUT");
  const [amountStr, setAmountStr] = useState(rule ? fmt(rule.amount) : "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId);
  const [pocketId, setPocketId] = useState(rule?.pocketId ?? main?.id);
  const [freq, setFreq] = useState<RecurringFreq>(rule?.freq ?? "monthly");
  const [day, setDay] = useState(rule?.day ?? 1);
  const [month, setMonth] = useState(rule?.month ?? 1);
  const [note, setNote] = useState(rule?.note ?? "");
  const [error, setError] = useState("");

  const changeFreq = (f: RecurringFreq) => {
    setFreq(f);
    setDay(1); // ความหมายของ day เปลี่ยนตามความถี่ — รีเซ็ตกันค่าค้าง
  };

  const cats = categories
    .filter((c) => c.type === (type === "IN" ? "income" : "expense"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const effectiveCatId =
    categoryId != null && cats.some((c) => c.id === categoryId)
      ? categoryId
      : cats[0]?.id;
  // pockets มาจาก useLiveQuery ซึ่งยังว่างตอน dialog mount —
  // ห้ามอ่าน main?.id ผ่าน useState ตอนเริ่ม ไม่งั้นค่าค้าง undefined ถาวร
  const effectivePocketId =
    pocketId != null && pockets.some((p) => p.id === pocketId)
      ? pocketId
      : main?.id;

  const save = async () => {
    const amount = parseAmount(amountStr);
    if (amount === null || amount <= 0) return setError(t("rec_errAmount"));
    if (effectivePocketId == null) return setError(t("rec_errPocket"));
    const fields = {
      type,
      amount,
      pocketId: effectivePocketId,
      categoryId: effectiveCatId,
      note: note.trim() || undefined,
      freq,
      day,
      month: freq === "yearly" ? month : undefined,
    };
    if (rule) {
      await db.recurring.update(rule.id!, fields);
    } else {
      await db.recurring.add({
        ...fields,
        since: todayStr(),
        active: 1,
        createdAt: Date.now(),
      } as Recurring);
    }
    // ถ้าวันที่ตั้งครบกำหนดแล้ว (เช่นตั้งเป็นวันนี้) สร้างรายการให้เลย
    await applyDueRecurring();
    onClose();
  };

  const remove = async () => {
    if (!rule) return;
    if (
      await confirmDialog(t("rec_confirmDelete"), {
        detail: t("rec_deleteKept"),
        confirmLabel: t("delete"),
        danger: true,
      })
    ) {
      await db.recurring.delete(rule.id!);
      onClose();
    }
  };

  return (
    <Overlay onClose={onClose} label={rule ? t("rec_edit") : t("rec_new")}>
      <h2 className="pb-4 font-zen text-lg font-bold">
        {rule ? t("rec_edit") : t("rec_new")}
      </h2>
      <div className="space-y-4">
        <div className="flex rounded-2xl bg-surface2 p-1">
          {(["OUT", "IN"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setType(d)}
              className="pressable flex-1 rounded-xl py-2 text-sm font-medium"
              style={
                type === d
                  ? {
                      background: "var(--surface)",
                      color: d === "IN" ? "var(--income)" : "var(--expense)",
                      boxShadow: "0 1px 4px rgb(0 0 0 / 0.12)",
                    }
                  : { color: "var(--faint)" }
              }
            >
              {d === "OUT" ? t("qa_expense") : t("qa_income")}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("amountBaht")}>
            <input
              className={inputCls}
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              autoFocus={!rule}
            />
          </Field>
          <Field label={t("rec_freq")}>
            <select
              className={inputCls}
              value={freq}
              onChange={(e) => changeFreq(e.target.value as RecurringFreq)}
            >
              <option value="monthly">{t("freq_monthly")}</option>
              <option value="weekly">{t("freq_weekly")}</option>
              <option value="yearly">{t("freq_yearly")}</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {freq === "weekly" ? (
            <Field label={t("rec_everyWeekdayField")}>
              <select
                className={inputCls}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Array.from({ length: 7 }, (_, i) => i).map((i) => (
                  <option key={i} value={i}>
                    {t("rec_weekdayOpt", { w: weekday(i) })}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t("rec_onDay")}>
              <select
                className={inputCls}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t("rec_dayN", { d })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {freq === "yearly" && (
            <Field label={t("rec_month")}>
              <select
                className={inputCls}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i).map((i) => (
                  <option key={i} value={i + 1}>
                    {shortMonth(i)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("category")}>
            <select
              className={inputCls}
              value={effectiveCatId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {tName(c.name)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("pocket")}>
            <select
              className={inputCls}
              value={effectivePocketId}
              onChange={(e) => setPocketId(Number(e.target.value))}
            >
              {pockets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {tName(p.name)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("rec_name")}>
          <input
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("rec_namePlaceholder")}
          />
        </Field>
        {error && (
          <p className="text-sm" style={{ color: "var(--expense)" }}>
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-1">
          {rule && (
            <button
              onClick={remove}
              className="pressable rounded-2xl px-4 py-3 text-sm"
              style={{ color: "var(--expense)" }}
            >
              {t("delete")}
            </button>
          )}
          <button
            onClick={save}
            className="pressable flex-1 rounded-2xl py-3 font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
