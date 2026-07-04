import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * กันทั้งแอพขาว (white screen) เมื่อ throw ระหว่าง render — แสดงหน้า fallback ที่กู้ได้
 * ข้อมูลอยู่ใน IndexedDB จึงไม่หายจากการรีโหลด ไม่ผูก i18n เพราะ layer นั้นอาจพังไปด้วย
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // breadcrumb ตอน dev/รายงานบั๊ก — อยู่ในเครื่อง ไม่ส่งออกนอก
    // eslint-disable-next-line no-console
    console.error("Pocketo crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
          background: "var(--bg, #131316)",
          color: "var(--ink, #e8e8ea)",
        }}
      >
        <div style={{ fontSize: 40 }} aria-hidden="true">
          😵‍💫
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>แอพมีปัญหาชั่วคราว</h1>
        <p style={{ fontSize: 14, opacity: 0.7, maxWidth: 320, lineHeight: 1.6 }}>
          ข้อมูลของคุณยังอยู่ในเครื่อง ไม่ได้หายไป ลองรีโหลดอีกครั้ง
          <br />
          Something went wrong — your data is safe on this device.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            borderRadius: 16,
            padding: "12px 24px",
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent, #d9402f)",
          }}
        >
          รีโหลด · Reload
        </button>
      </div>
    );
  }
}
