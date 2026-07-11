import { useState } from "react";
import { useT } from "../../i18n";
import { Field, inputCls, Overlay } from "../../components/Modal";
import { fmt, parseAmount } from "../../core/money";
import type { Pocket } from "../../core/types";
import { todayStr, transfer } from "../../db/data";

export function TransferDialog({
  pockets,
  balances,
  onClose,
}: {
  pockets: Pocket[];
  balances: Map<number, number>;
  onClose: () => void;
}) {
  const { t, name: tName } = useT();
  const [fromId, setFromId] = useState(pockets[0]?.id);
  const [toId, setToId] = useState(pockets[1]?.id);
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    const amount = parseAmount(amountStr);
    if (fromId == null || toId == null) return;
    if (fromId === toId) return setError(t("tf_errDiffer"));
    if (amount === null || amount <= 0) return setError(t("tf_errAmount"));
    if (amount > (balances.get(fromId) ?? 0))
      return setError(t("tf_errInsufficient"));
    await transfer(fromId, toId, amount, todayStr());
    onClose();
  };

  const selectCls = inputCls + " appearance-none";

  return (
    <Overlay onClose={onClose} label={t("tf_title")}>
      <h2 className="pb-4 font-zen text-lg font-bold">{t("tf_title")}</h2>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("from")}>
            <select
              className={selectCls}
              value={fromId}
              onChange={(e) => setFromId(Number(e.target.value))}
            >
              {pockets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {tName(p.name)} ({fmt(balances.get(p.id!) ?? 0)})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("to")}>
            <select
              className={selectCls}
              value={toId}
              onChange={(e) => setToId(Number(e.target.value))}
            >
              {pockets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {tName(p.name)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("amountBaht")}>
          <input
            className={inputCls}
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>
        {error && (
          <p className="text-sm" style={{ color: "var(--expense)" }}>
            {error}
          </p>
        )}
        <button
          onClick={submit}
          className="pressable w-full rounded-2xl py-3 font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          {t("tf_action")}
        </button>
      </div>
    </Overlay>
  );
}
