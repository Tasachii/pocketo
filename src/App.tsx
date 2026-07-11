import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import { Feedback } from "./components/Feedback";
import { IconPlus } from "./components/Icons";
import { Onboarding, ONBOARDED_KEY } from "./components/Onboarding";
import { QuickAdd } from "./components/QuickAdd";
import { Stamp } from "./components/Stamp";
import { TabBar, type TabId } from "./components/TabBar";
import { applyDueRecurring } from "./db/data";
import { db, seedIfEmpty } from "./db/db";
import { Home } from "./screens/Home";
import { Pockets } from "./screens/Pockets";
import { Reports } from "./screens/Reports";
import { Settings } from "./screens/Settings";
import { Tax } from "./screens/Tax";
import { useTheme } from "./state/useTheme";

export default function App() {
  const { t } = useT();
  const { mode, setMode, cycle } = useTheme();
  const [tab, setTab] = useState<TabId>("home");
  const [quickOpen, setQuickOpen] = useState(false);
  const [stamp, setStamp] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);

  useEffect(() => {
    // สร้างรายการประจำที่ครบกำหนดทันทีที่เปิดแอพ (ตามเก็บเดือนที่พลาดด้วย)
    let active = true;
    void seedIfEmpty()
      .then(() => applyDueRecurring())
      .catch(() => {
        if (active) setStartupError(true);
      });
    return () => {
      active = false;
    };
  }, [startupAttempt]);

  const pockets =
    useLiveQuery(() => db.pockets.orderBy("sortOrder").toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  // อ่าน localStorage แบบ sync ตั้งแต่ render แรก — ไม่มี race กับ IndexedDB
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem(ONBOARDED_KEY),
  );

  const onSaved = () => {
    setStamp(true);
    setTimeout(() => setStamp(false), 1150);
  };

  const showFab = !quickOpen && tab !== "settings" && tab !== "tax";

  return (
    <div
      className="mx-auto min-h-screen max-w-md px-5 pb-32"
      style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
    >
      {startupError && (
        <div
          role="alert"
          className="mb-3 rounded-2xl border border-expense/30 bg-surface p-4 text-sm"
        >
          <p>{t("storageUnavailable")}</p>
          <button
            type="button"
            onClick={() => {
              setStartupError(false);
              setStartupAttempt((n) => n + 1);
            }}
            className="pressable mt-2 font-medium text-accent"
          >
            {t("retry")}
          </button>
        </div>
      )}
      {tab === "home" && <Home themeMode={mode} onCycleTheme={cycle} />}
      {tab === "pockets" && <Pockets />}
      {tab === "reports" && <Reports />}
      {tab === "tax" && <Tax />}
      {tab === "settings" && <Settings mode={mode} setMode={setMode} />}

      {showFab && (
        <button
          onClick={() => setQuickOpen(true)}
          aria-label={t("aria_addNew")}
          className="pressable fixed z-40 flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{
            background: "var(--accent)",
            right: "max(calc(50vw - 13rem), 1.25rem)",
            bottom: "calc(76px + env(safe-area-inset-bottom))",
            boxShadow:
              "0 6px 20px color-mix(in srgb, var(--accent) 45%, transparent)",
          }}
        >
          <IconPlus size={26} />
        </button>
      )}

      <TabBar active={tab} onChange={setTab} />
      <QuickAdd
        open={quickOpen}
        categories={categories}
        pockets={pockets}
        onClose={() => setQuickOpen(false)}
        onSaved={onSaved}
      />
      <Stamp visible={stamp} />
      <Feedback />
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
    </div>
  );
}
