import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

/**
 * The version written by `pnpm run prebuild` (scripts/write-version.mjs).
 * Baked into the bundle, it tells the running app which deployment its code
 * comes from; null when the file is missing (a bare `vite build`), which
 * turns the update check off rather than comparing with nothing.
 */
function readBuildVersion(): string | null {
  try {
    const info: unknown = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "public/version.json"), "utf8")
    )
    return typeof info === "object" &&
      info !== null &&
      "version" in info &&
      typeof info.version === "string"
      ? info.version
      : null
  } catch {
    return null
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: {
    // The dev server has no deployment to compare with.
    __APP_VERSION__: JSON.stringify(
      command === "build" ? readBuildVersion() : null
    ),
  },
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
        // version.json stays out (no "json" here): the update check must
        // always read the deployed copy, never one cached with the app.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      // Lets the app be installed and tested from `pnpm dev`.
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own chunks: they change less often than the
        // app's code, so browsers keep them cached across deployments.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](?:\.pnpm[\\/])?(?:react|react-dom|scheduler)[@\\/]/,
              priority: 30,
            },
            {
              name: "supabase",
              test: /node_modules[\\/](?:\.pnpm[\\/])?@supabase[+\\/]/,
              priority: 20,
            },
            {
              name: "i18n",
              test: /node_modules[\\/](?:\.pnpm[\\/])?(?:i18next|react-i18next|i18next-browser-languagedetector)[@\\/]/,
              priority: 20,
            },
            {
              name: "dates",
              test: /node_modules[\\/](?:\.pnpm[\\/])?(?:react-day-picker|date-fns|@date-fns[+\\/])/,
              priority: 20,
            },
            {
              name: "ui",
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
}))
