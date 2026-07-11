import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { parseAmount } from "../core/money";
import { BACKSPACE, pressKey } from "../core/quickadd";
import type { Category, Pocket } from "../core/types";
import { saveQuickTx, todayStr } from "../db/data";
import { IconBack, IconClose } from "./Icons";
import { useDialogFocus } from "./useDialogFocus";

type TxDir = "OUT" | "IN";
type Step = "amount" | "category";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", BACKSPACE];

/** จดหนึ่งรายการ ≤ 3 แตะ: ตัวเลข → ถัดไป → แตะหมวด (บันทึกทันที) */
export function QuickAdd({
  open,
  categories,
  pockets,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: Category[];
  pockets: Pocket[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, name: tName } = useT();
  const main = pockets.find((p) => p.isMain);
  const [dir, setDir] = useState<TxDir>("OUT");
  const [amountStr, setAmountStr] = useState("");
  const [step, setStep] = useState<Step>("amount");
  const [pocketId, setPocketId] = useState<number | undefined>(main?.id);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const dialogRef = useDialogFocus(open, onClose);

  useEffect(() => {
    if (open) {
      setDir("OUT");
      setAmountStr("");
      setStep("amount");
      setPocketId(main?.id);
      setNote("");
      setDate(todayStr());
      setSaving(false);
      setSaveError(false);
    }
    // เปิดใหม่ทุกครั้งเริ่มจากศูนย์ — main?.id เปลี่ยนเฉพาะตอน seed ครั้งแรก
  }, [open]);

  const amount = parseAmount(amountStr || "0");
  const amountValid = amount !== null && amount > 0;
  const missingMainPocket = main?.id == null;
  const valid = amountValid && pocketId != null && !missingMainPocket;
  const cats = useMemo(
    () =>
      categories
        .filter((c) => (dir === "IN" ? c.type === "income" : c.type === "expense"))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, dir],
  );

  if (!open) return null;

  const press = (k: string) => {
    setAmountStr((s) => pressKey(s, k));
  };

  const save = async (categoryId: number) => {
    if (!amountValid || saving) return;
    if (pocketId == null || missingMainPocket) {
      setSaveError(true);
      return;
    }
    setSaving(true);
    setSaveError(false);
    try {
      await saveQuickTx({
        type: dir,
        amount: amount!,
        pocketId,
        categoryId,
        note: note.trim() || undefined,
        date,
      });
      onSaved();
      setTimeout(onClose, 650);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade fixed inset-0 z-50 bg-bg">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("aria_addNew")}
        tabIndex={-1}
        className="sheet mx-auto flex h-full max-w-md flex-col px-5"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
        }}
      >
        {/* แถวบน */}
        <div className="flex items-center justify-between py-2">
          <button
            onClick={() => (step === "category" ? setStep("amount") : onClose())}
            className="pressable -ml-2 p-2 text-sub"
            aria-label={step === "category" ? t("back") : t("close")}
          >
            {step === "category" ? <IconBack /> : <IconClose />}
          </button>
          <div className="flex rounded-full bg-surface2 p-1">
            {(["OUT", "IN"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDir(d)}
                className="pressable rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                style={
                  dir === d
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
          <div className="w-8" />
        </div>

        {/* จำนวนเงิน */}
        <div className="flex flex-col items-center pb-2 pt-6">
          <div
            className="tabular font-zen text-5xl font-medium tracking-tight"
            style={{ color: dir === "IN" ? "var(--income)" : "var(--ink)" }}
          >
            ฿{amountStr === "" ? "0" : amountStr}
          </div>
          <div className="mt-2 h-px w-24" style={{ background: "var(--line)" }} />
        </div>

        {missingMainPocket && (
          <p role="alert" className="pb-3 text-center text-sm text-expense">
            {t("qa_noMainPocket")}
          </p>
        )}

        {step === "amount" ? (
          <>
            <div className="mt-auto grid grid-cols-3 gap-2 pb-3">
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  className="pressable rounded-2xl bg-surface py-5 font-zen text-2xl font-medium"
                >
                  {k}
                </button>
              ))}
            </div>
            <button
              disabled={!valid}
              onClick={() => setStep("category")}
              className="pressable rounded-2xl py-4 font-thai text-lg font-semibold text-white disabled:opacity-30"
              style={{ background: "var(--accent)" }}
            >
              {t("next")}
            </button>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="pb-3 pt-1 text-center text-sm text-sub">
              {t("qa_tapToSave")}
            </p>
            {saveError && (
              <p role="alert" className="pb-3 text-center text-sm text-expense">
                {t("saveFailed")}
              </p>
            )}
            <div className="grid flex-1 grid-cols-4 content-start gap-2 overflow-y-auto">
              {cats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => save(c.id!)}
                  className="pressable flex flex-col items-center gap-1.5 rounded-2xl bg-surface px-1 py-3"
                >
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-[11px] leading-tight text-sub">
                    {tName(c.name)}
                  </span>
                </button>
              ))}
            </div>

            {/* ตัวเลือกเสริม — ไม่บังคับ */}
            <div className="space-y-2 pt-3">
              {pockets.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto">
                  {pockets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPocketId(p.id)}
                      className="pressable shrink-0 rounded-full border px-3 py-1.5 text-xs"
                      style={
                        pocketId === p.id
                          ? {
                              borderColor: "var(--accent)",
                              color: "var(--accent)",
                              background:
                                "color-mix(in srgb, var(--accent) 8%, transparent)",
                            }
                          : { borderColor: "var(--line)", color: "var(--sub)" }
                      }
                    >
                      {p.icon} {tName(p.name)}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("noteOptional")}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
                />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-sub"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
