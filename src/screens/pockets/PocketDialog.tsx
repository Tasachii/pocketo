import { useState } from "react";
import { useT } from "../../i18n";
import { confirmDialog } from "../../components/Feedback";
import { Field, inputCls, Overlay } from "../../components/Modal";
import { fmt, parseAmount } from "../../core/money";
import type { Pocket } from "../../core/types";
import { todayStr } from "../../db/data";
import { db } from "../../db/db";

const POCKET_ICONS = ["💰", "🏦", "📈", "✈️", "🎓", "🏠", "🚗", "💍", "🎮", "🧧", "🌱", "🛡️"];

export function PocketDialog({
  pocket,
  pockets,
  txCount,
  onClose,
}: {
  pocket: Pocket | null;
  pockets: Pocket[];
  txCount: (id: number) => number;
  onClose: () => void;
}) {
  const { t, name: tName } = useT();
  const [name, setName] = useState(pocket ? tName(pocket.name) : "");
  const [icon, setIcon] = useState(pocket?.icon ?? POCKET_ICONS[0]);
  const [goalStr, setGoalStr] = useState(
    pocket?.goal ? fmt(pocket.goal) : "",
  );
  const [allocStr, setAllocStr] = useState(
    pocket?.allocPercent ? String(pocket.allocPercent) : "",
  );
  const [initStr, setInitStr] = useState("");
  const [error, setError] = useState("");

  const isMain = pocket?.isMain === 1;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError(t("pk_errName"));
    const goal = goalStr ? parseAmount(goalStr) : null;
    if (goalStr && goal === null) return setError(t("pk_errGoal"));
    const alloc = allocStr ? Number(allocStr) : 0;
    if (!Number.isFinite(alloc) || alloc < 0 || alloc > 100)
      return setError(t("pk_errPct"));
    const otherAlloc = pockets
      .filter((p) => p.id !== pocket?.id)
      .reduce((s, p) => s + (p.allocPercent ?? 0), 0);
    if (otherAlloc + alloc > 100)
      return setError(
        t("pk_errPctTotal", { other: otherAlloc }),
      );

    const fields = {
      name: trimmed,
      icon,
      goal: goal ?? undefined,
      allocPercent: isMain ? undefined : alloc || undefined,
    };
    if (pocket) {
      await db.pockets.update(pocket.id!, fields);
    } else {
      const id = await db.pockets.add({
        ...fields,
        isMain: 0,
        sortOrder: pockets.length,
      } as Pocket);
      const init = initStr ? parseAmount(initStr) : null;
      if (init && init > 0) {
        await db.tx.add({
          type: "INIT",
          amount: init,
          pocketId: id as number,
          date: todayStr(),
          createdAt: Date.now(),
        });
      }
    }
    onClose();
  };

  const remove = async () => {
    if (!pocket || isMain) return;
    if (txCount(pocket.id!) > 0) {
      setError(t("pk_errHasTx"));
      return;
    }
    if (
      await confirmDialog(t("pk_confirmDelete", { name: tName(pocket.name) }), {
        confirmLabel: t("delete"),
        danger: true,
      })
    ) {
      await db.pockets.delete(pocket.id!);
      onClose();
    }
  };

  return (
    <Overlay onClose={onClose} label={pocket ? t("pk_edit") : t("pk_new")}>
      <h2 className="pb-4 font-zen text-lg font-bold">
        {pocket ? t("pk_edit") : t("pk_new")}
      </h2>
      <div className="space-y-4">
        <Field label={t("pk_name")}>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("pk_namePlaceholder")}
          />
        </Field>
        <Field label={t("pk_icon")}>
          <div className="flex flex-wrap gap-1.5">
            {POCKET_ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className="pressable flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                style={
                  icon === ic
                    ? {
                        background:
                          "color-mix(in srgb, var(--accent) 12%, transparent)",
                        outline: "1.5px solid var(--accent)",
                      }
                    : { background: "var(--surface)" }
                }
              >
                {ic}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("pk_goalBaht")}>
            <input
              className={inputCls}
              inputMode="decimal"
              value={goalStr}
              onChange={(e) => setGoalStr(e.target.value)}
              placeholder={t("optional")}
            />
          </Field>
          {!isMain && (
            <Field label={t("pk_splitPct")}>
              <input
                className={inputCls}
                inputMode="numeric"
                value={allocStr}
                onChange={(e) => setAllocStr(e.target.value)}
                placeholder="0"
              />
            </Field>
          )}
        </div>
        {!pocket && (
          <Field label={t("pk_initBaht")}>
            <input
              className={inputCls}
              inputMode="decimal"
              value={initStr}
              onChange={(e) => setInitStr(e.target.value)}
              placeholder={t("optional")}
            />
          </Field>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--expense)" }}>
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-1">
          {pocket && !isMain && (
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
