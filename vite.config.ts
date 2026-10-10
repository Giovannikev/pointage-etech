import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new deployment replaces the cached app on the next visit.
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Pointage — Git to Odoo timesheets",
        short_name: "Pointage",
        description: "Turn your GitHub commits into Odoo timesheets.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // Only the app shell is cached: Supabase, GitHub and Odoo calls always
      // go to the network, so data is never served stale.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      // Lets the app be installed and tested from `pnpm dev`.
      devOptions: {
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
