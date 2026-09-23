/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// O painel é servido pelo próprio servidor RPG Play em /mestre (mesma origem da API e do WebSocket).
// Em desenvolvimento, `npm run dev` repassa /api, /ws e /media para o servidor local.
const server = process.env.RPG_SERVER ?? "http://localhost:8080";

export default defineConfig({
  base: "/mestre/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/media": server,
      "/ws": { target: server.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
    pool: "vmThreads",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
