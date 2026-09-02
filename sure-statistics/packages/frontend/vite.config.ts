import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // El JSON de datos lo regenera el pipeline cada ciclo: nunca debe servirse desde caché.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        navigateFallbackDenylist: [/^\/data\//],
        runtimeCaching: [
          {
            urlPattern: /\/data\/latest\.json$/,
            handler: "NetworkFirst",
            options: { cacheName: "sure-statistics-data", networkTimeoutSeconds: 5 },
          },
        ],
      },
      manifest: {
        name: "SURE Statistics",
        short_name: "SureStats",
        description: "Probabilidad de sesgo alcista/bajista en la apertura de Wall Street, por ticker.",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
