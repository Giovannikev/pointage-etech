// Writes public/version.json before each build: the version the deployed app
// was built from. The running app compares it with the copy baked into its
// bundle (vite.config.ts) to tell that a newer deployment is online.
//
// Netlify sets COMMIT_REF to the deployed commit; elsewhere the build time
// stands in, so every local build is a new version too.
import { mkdirSync, writeFileSync } from "node:fs"

const file = new URL("../public/version.json", import.meta.url)
const info = {
  version: process.env.COMMIT_REF || Date.now().toString(),
  buildTime: new Date().toISOString(),
}

mkdirSync(new URL(".", file), { recursive: true })
writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`)
console.log(`version.json: ${info.version}`)
