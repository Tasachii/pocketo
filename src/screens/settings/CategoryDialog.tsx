import { useState } from "react";
import { useT } from "../../i18n";
import { confirmDialog } from "../../components/Feedback";
import { Field, inputCls, Overlay } from "../../components/Modal";
import { fmt, parseAmount } from "../../core/money";
import type { Category, KakeiboGroup } from "../../core/types";
import { db } from "../../db/db";

const KAKEIBO_GROUPS: KakeiboGroup[] = ["needs", "wants", "culture", "extra"];

export function CategoryDialog({
  category,
  inUse,
  onClose,
}: {
  category: Category;
  inUse: boolean;
  onClose: () => void;
}) {
  const { t, name: tName } = useT();
  const [name, setName] = useState(tName(category.name));
  const [icon, setIcon] = useState(category.icon);
  const [group, setGroup] = useState<KakeiboGroup>(category.group ?? "wants");
  const [budgetStr, setBudgetStr] = useState(
    category.budget ? fmt(category.budget) : "",
  );
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) return setError(t("cat_errName"));
    const budget = budgetStr ? parseAmount(budgetStr) : null;
    if (budgetStr && budget === null) return setError(t("cat_errBudget"));
    await db.categories.update(category.id!, {
      name: name.trim(),
      icon: icon.trim() || "🏷️",
      group: category.type === "expense" ? group : undefined,
      budget: budget && budget > 0 ? budget : undefined,
    });
    onClose();
  };

  const remove = async () => {
    if (inUse) {
      setError(t("cat_inUse"));
      return;
    }
    if (
      await confirmDialog(t("cat_confirmDelete", { name: tName(category.name) }), {
        confirmLabel: t("delete"),
        danger: true,
      })
    ) {
      await db.categories.delete(category.id!);
      onClose();
    }
  };

  return (
    <Overlay onClose={onClose} label={t("cat_edit")}>
      <h2 className="pb-4 font-zen text-lg font-bold">{t("cat_edit")}</h2>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            className={`${inputCls} w-16 text-center`}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            aria-label={t("pk_icon")}
          />
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("cat_namePlaceholder")}
          />
        </div>
        {category.type === "expense" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("cat_pillar")}>
              <select
                className={inputCls}
                value={group}
                onChange={(e) => setGroup(e.target.value as KakeiboGroup)}
              >
                {KAKEIBO_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {t(`kakeibo_${g}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("cat_budget")}>
              <input
                className={inputCls}
                inputMode="decimal"
                value={budgetStr}
                onChange={(e) => setBudgetStr(e.target.value)}
                placeholder={t("cat_unlimited")}
              />
            </Field>
          </div>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--expense)" }}>
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <button
            onClick={remove}
            className="pressable rounded-2xl px-4 py-3 text-sm"
            style={{ color: "var(--expense)" }}
          >
            {t("delete")}
          </button>
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
