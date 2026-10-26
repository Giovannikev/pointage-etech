import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

// Separate from vite.config.ts: tests need neither React nor the PWA plugin.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // Dates are local: pin the zone so results don't depend on the machine.
    env: { TZ: "Indian/Antananarivo" },
  },
})
