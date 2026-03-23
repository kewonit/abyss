import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "dist",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    target: "esnext",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    cssMinify: "esbuild",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          globe: ["globe.gl", "three"],
          vendor: ["preact", "zustand"],
        },
      },
    },
  },
});
