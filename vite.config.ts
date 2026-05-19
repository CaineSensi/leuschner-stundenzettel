import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Auf GitHub Pages liegt die App unter https://<user>.github.io/<repo>/
// Setze VITE_BASE_PATH im GitHub-Action-Secret, z.B. "/leuschner-app/"
// Bei Custom-Domain (z.B. app.galabauleuschner.de) bleibt es "/".
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.svg", "icon-512.svg"],
      manifest: {
        name: "Leuschner · Stundenzettel",
        short_name: "Leuschner",
        description: "Wochen-Stundenerfassung für Pflaster · Garten · Zaun",
        theme_color: "#1A1C1E",
        background_color: "#C4C8CC",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        lang: "de",
        icons: [
          { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
          { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "/index.html",
        // Statische Erklär-Seite NICHT in die SPA-Navigationsfalle ziehen,
        // sonst zeigt der Service-Worker dort die Mitarbeiter-App.
        navigateFallbackDenylist: [/^\/cheff-flow/],
        // Neue Service-Worker-Version sofort übernehmen — User sieht den
        // neuen Build beim ERSTEN Öffnen statt beim zweiten
        skipWaiting: true,
        clientsClaim: true,
        // Cleanup alter Caches automatisch
        cleanupOutdatedCaches: true
      }
    })
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", "localhost"]
  }
});
