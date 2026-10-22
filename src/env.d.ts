interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * The deployment the bundle was built from (public/version.json), set by
 * vite.config.ts; null in the dev server and when the build wrote none.
 */
declare const __APP_VERSION__: string | null
