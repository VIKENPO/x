import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Redirige las llamadas /api al backend en desarrollo.
      "/api": "http://localhost:4000",
      // WebSocket de tiempo real.
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
});
