import { type Plugin, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { BACKGROUND_COLOR, BRAND_COLOR, cssVariables } from "./src/theme.ts";

export function themePlugin(): Plugin {
  return {
    name: "dongjane-theme",
    transformIndexHtml: () => [
      { tag: "style", children: cssVariables(), injectTo: "head-prepend" },
      { tag: "meta", attrs: { name: "theme-color", content: BRAND_COLOR }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["dongjane.sslip.net"],
    // Same default port as packages/server/src/index.ts
    proxy: {
      "/__server": {
        target: `http://localhost:${process.env.PORT ?? 2567}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/__server/, ""),
      },
    },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("/node_modules/three/")) return "three";
          if (id.includes("/@colyseus/")) return "colyseus";
          return undefined;
        },
      },
    },
  },
  plugins: [
    themePlugin(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "동자네",
        short_name: "동자네",
        description: "갓바위 앞에서 함께 절하고 쉬어가는 포근한 월드",
        lang: "ko",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: BRAND_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,glb}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/matchmake\//, /^\/__/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
});
