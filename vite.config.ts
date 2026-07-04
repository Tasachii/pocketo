/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/Pocketo/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      workbox: {
        // cache ฟอนต์ Google Fonts ให้ใช้ offline ได้จริง (ไม่งั้นฟอนต์หายเมื่อไม่มีเน็ต)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "Pocketo — ポケット",
        short_name: "Pocketo",
        description:
          "จดรายรับรายจ่ายแบบ kakeibo พร้อมกล่องเงินและคำนวณภาษีไทย ข้อมูลอยู่ในเครื่องคุณเท่านั้น",
        lang: "th",
        theme_color: "#131316",
        background_color: "#131316",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  test: {
    // unit tests = src/**/*.test.{ts,tsx} (Vitest) · e2e = e2e/*.spec.ts (Playwright)
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // node เป็น default (เร็ว สำหรับ core/db math) — เทสต์ที่ต้องใช้ DOM
    // (component .test.tsx, share-card canvas, download path) ประกาศ jsdom เอง
    // ด้วย docblock // @vitest-environment jsdom บรรทัดบนสุดของไฟล์
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      // istanbul (ไม่ใช่ v8) — v8 remap ค้างบน Node 23 ในโปรเจกต์นี้
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/i18n/**",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "src/test/**",
        "src/components/Icons.tsx",
        "src/brand/**",
      ],
      thresholds: {
        // RATCHET floor (ไม่ใช่เป้าหมาย) — ตั้งต่ำกว่า coverage จริงปัจจุบันเล็กน้อย
        // เพื่อกันการถอยหลัง: ต่ำกว่านี้เมื่อไร CI แดงทันที. actual ตอนนี้ ~44 lines /
        // 34 branches / 27 funcs — ที่ยังต่ำคือ UI screens ที่ยังไม่มีเทสต์
        // TODO: ขยับ floor ขึ้นเป็นชุดเมื่อเพิ่มเทสต์ระดับ screen/component แล้ว
        lines: 42,
        branches: 32,
        functions: 25,
        // pure math: ไม่มี I/O — ควรเกือบเต็ม
        "src/core/{allocate,money,tax,recurring,crypto}.ts": {
          lines: 95,
          branches: 90,
          functions: 100,
        },
        // canvas: branch ของ layout — ไม่ assert ความเป๊ะระดับพิกเซล
        "src/core/share.ts": { lines: 80, branches: 70, functions: 100 },
        // ชั้นข้อมูล: money-moving + persistence — เดิมพันสูง
        "src/db/{data,db,backup}.ts": {
          lines: 90,
          branches: 85,
          functions: 100,
        },
      },
    },
  },
}));
