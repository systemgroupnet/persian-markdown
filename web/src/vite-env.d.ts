/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected at build time; surfaced in the About dialog. */
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
