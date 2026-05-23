/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const appBasePath = "/online_code_test/";

function stripDevBasePath(): Plugin {
  return {
    name: "strip-dev-base-path",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const basePathWithoutTrailingSlash = appBasePath.slice(0, -1);

        if (req.url === basePathWithoutTrailingSlash) {
          req.url = "/";
        } else if (req.url?.startsWith(appBasePath)) {
          req.url = req.url.slice(basePathWithoutTrailingSlash.length) || "/";
        }

        next();
      });
    },
  };
}

export default defineConfig({
  base: appBasePath,
  plugins: [stripDevBasePath(), react()],
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        // Required: without a URL jsdom uses a "null" (opaque) origin and
        // throws SecurityError on localStorage/sessionStorage access.
        url: "http://localhost",
      },
    },
    setupFiles: ["./src/__test__/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/__test__/**", "src/main.tsx", "node_modules/**"],
      reporter: ["text", "lcov"],
    },
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
        ws: true,
      },
    },
  },
});
