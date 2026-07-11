import { useState } from "react";
import { setLang, useT } from "../i18n";
import type { Dict } from "../i18n";
import { EnsoRing } from "./EnsoRing";
import { useDialogFocus } from "./useDialogFocus";

export const ONBOARDED_KEY = "pocketo-onboarded";

const CARDS: Array<{
  ring: string;
  emoji: string;
  titleKey: keyof Dict;
  bodyKey: keyof Dict;
}> = [
  { ring: "var(--accent)", emoji: "¥", titleKey: "ob_c1_title", bodyKey: "ob_c1_body" },
  { ring: "var(--income)", emoji: "🫙", titleKey: "ob_c2_title", bodyKey: "ob_c2_body" },
  { ring: "var(--neutral)", emoji: "📊", titleKey: "ob_c3_title", bodyKey: "ob_c3_body" },
];

/** หน้าแนะนำตอนเปิดแอพครั้งแรก — จบแล้วบันทึก flag ใน localStorage ไม่แสดงอีก */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT();
  const [step, setStep] = useState(0);
  const last = step === CARDS.length - 1;
  const card = CARDS[step];
  const dialogRef = useDialogFocus(true);

  const finish = () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    onDone();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t(card.titleKey)}
      tabIndex={-1}
      className="fade fixed inset-0 z-[90] flex flex-col bg-bg"
    >
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-7"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 24px)",
          paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
        }}
      >
        <div className="flex items-center justify-between pt-2">
          {/* สลับภาษาได้ตั้งแต่จอแรก — ไม่รบกวน คนต่างชาติเห็นแล้วกดได้ทันที */}
          <button
            onClick={() => setLang(lang === "th" ? "en" : "th")}
            className="pressable rounded-full border border-line px-3 py-1 text-xs text-sub"
            aria-label="Switch language / สลับภาษา"
          >
            {lang === "th" ? "EN" : "ไทย"}
          </button>
          {!last && (
            <button onClick={finish} className="pressable text-sm text-sub">
              {t("skip")}
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div key={step} className="rise flex flex-col items-center">
            <EnsoRing progress={(step + 1) / CARDS.length} size={120} stroke={6} color={card.ring}>
              <span className="text-4xl">{card.emoji}</span>
            </EnsoRing>
            <h2 className="pt-8 font-zen text-2xl font-bold">{t(card.titleKey)}</h2>
            <p className="max-w-xs pt-3 leading-relaxed text-sub">{t(card.bodyKey)}</p>
          </div>
        </div>

        {last && (
          <p className="pb-5 text-center text-xs leading-relaxed text-faint">
            {t("set_installHint")}
          </p>
        )}

        <div className="flex items-center justify-center gap-2 pb-6">
          {CARDS.map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 20 : 6,
                background: i === step ? "var(--accent)" : "var(--line)",
              }}
            />
          ))}
        </div>

        <button
          onClick={() => (last ? finish() : setStep((s) => s + 1))}
          className="pressable rounded-2xl py-4 font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          {last ? t("ob_start") : t("next")}
        </button>
      </div>
    </div>
  );
}
