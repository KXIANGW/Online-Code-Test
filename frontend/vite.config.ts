/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__test__/setup.ts"],
    globals: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Local `npm run dev` proxies /api to the backend container so the
      // browser hits the same path as in production.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
