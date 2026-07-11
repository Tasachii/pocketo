// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Category, Pocket } from "../core/types";

// mock ชั้น data: saveQuickTx เป็น spy, todayStr คงที่ ให้ assert payload ได้
const saveQuickTxMock = vi.fn(async () => {});
vi.mock("../db/data", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../db/data")>();
  return { ...mod, saveQuickTx: saveQuickTxMock, todayStr: () => "2026-06-15" };
});

const { QuickAdd } = await import("./QuickAdd");

const pockets: Pocket[] = [
  { id: 1, name: "ใช้จ่าย", icon: "👛", isMain: 1, sortOrder: 0 },
];
const categories: Category[] = [
  { id: 10, name: "อาหาร", icon: "🍜", type: "expense", group: "needs", sortOrder: 1 },
  { id: 11, name: "กาแฟ", icon: "☕", type: "expense", group: "wants", sortOrder: 0 },
  { id: 20, name: "เงินเดือน", icon: "💼", type: "income", sortOrder: 0 },
];

const onClose = vi.fn();
const onSaved = vi.fn();

function renderQA(open = true) {
  return render(
    <QuickAdd
      open={open}
      categories={categories}
      pockets={pockets}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
}

const key = (k: string) => screen.getByRole("button", { name: k });
const nextBtn = () => screen.getByRole("button", { name: "ถัดไป" });

beforeEach(() => {
  saveQuickTxMock.mockClear();
  onClose.mockClear();
  onSaved.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe("QuickAdd — แป้นและสถานะ", () => {
  it("เป็น keyboard-modal และ Escape ปิดได้", () => {
    renderQA();
    const dialog = screen.getByRole("dialog", { name: "จดรายการใหม่" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ปุ่มถัดไป disabled ตอนยังไม่มีจำนวน, enabled เมื่อกรอกถูก", () => {
    renderQA();
    expect(nextBtn()).toBeDisabled();
    fireEvent.click(key("5"));
    expect(nextBtn()).toBeEnabled();
  });

  it("ไม่มี main pocket → แจ้งวิธีกู้คืนและปิด flow ก่อนบันทึก", () => {
    render(
      <QuickAdd
        open
        categories={categories}
        pockets={[]}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(key("5"));
    expect(nextBtn()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("ยังไม่มีกล่องหลัก");
    expect(saveQuickTxMock).not.toHaveBeenCalled();
  });

  it("กด 0 ตัวแรกไม่ขึ้น แล้ว 5 → แสดง 5 (wiring pressKey)", () => {
    renderQA();
    fireEvent.click(key("0"));
    expect(screen.getByText("฿0")).toBeInTheDocument();
    fireEvent.click(key("5"));
    expect(screen.getByText("฿5")).toBeInTheDocument();
  });

  it("สลับทิศ OUT/IN กรองหมวดตาม type", () => {
    renderQA();
    fireEvent.click(key("9"));
    fireEvent.click(nextBtn());
    // OUT: เห็นหมวดรายจ่าย ไม่เห็นรายรับ
    expect(screen.getByText("อาหาร")).toBeInTheDocument();
    expect(screen.queryByText("เงินเดือน")).not.toBeInTheDocument();
  });

  it("รายรับ: หมวดรายรับปรากฏ", () => {
    renderQA();
    fireEvent.click(screen.getByRole("button", { name: "รายรับ" }));
    fireEvent.click(key("9"));
    fireEvent.click(nextBtn());
    expect(screen.getByText("เงินเดือน")).toBeInTheDocument();
    expect(screen.queryByText("อาหาร")).not.toBeInTheDocument();
  });

  it("แตะหมวด → saveQuickTx ด้วย payload ถูกต้อง + onSaved", async () => {
    renderQA();
    for (const d of "150") fireEvent.click(key(d));
    fireEvent.click(nextBtn());
    fireEvent.click(screen.getByText("อาหาร"));
    expect(saveQuickTxMock).toHaveBeenCalledWith({
      type: "OUT",
      amount: 15_000, // 150 บาท
      pocketId: 1,
      categoryId: 10,
      note: undefined,
      date: "2026-06-15",
    });
    // save() เป็น async — onSaved ถูกเรียกหลัง saveQuickTx resolve (microtask)
    await Promise.resolve();
    await Promise.resolve();
    expect(onSaved).toHaveBeenCalled();
  });

  it("แตะซ้ำถูกกันด้วย saving — saveQuickTx ครั้งเดียว", () => {
    renderQA();
    fireEvent.click(key("5"));
    fireEvent.click(nextBtn());
    const cat = screen.getByText("อาหาร");
    fireEvent.click(cat);
    fireEvent.click(cat);
    expect(saveQuickTxMock).toHaveBeenCalledTimes(1);
  });

  it("บันทึกล้มเหลว → แจ้งผู้ใช้และปลด saving ให้ลองใหม่ได้", async () => {
    saveQuickTxMock.mockRejectedValueOnce(new Error("quota"));
    renderQA();
    fireEvent.click(key("5"));
    fireEvent.click(nextBtn());
    fireEvent.click(screen.getByText("อาหาร"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("บันทึกไม่สำเร็จ");
    fireEvent.click(screen.getByText("อาหาร"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveQuickTxMock).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("ปิดแล้วเปิดใหม่ → ล้างจำนวน/step (reset on reopen)", () => {
    const { rerender } = renderQA(true);
    fireEvent.click(key("7"));
    expect(screen.getByText("฿7")).toBeInTheDocument();
    rerender(
      <QuickAdd
        open={false}
        categories={categories}
        pockets={pockets}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    rerender(
      <QuickAdd
        open
        categories={categories}
        pockets={pockets}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText("฿0")).toBeInTheDocument();
  });
});
