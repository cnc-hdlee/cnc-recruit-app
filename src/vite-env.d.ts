/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_GOOGLE_CLIENT_ID?: string;
  readonly VITE_DEFAULT_GOOGLE_CLIENT_SECRET?: string;
  readonly VITE_DEFAULT_SHEETS_CONFIG?: string;
  readonly VITE_VIEWER_MODE?: string;
  readonly VITE_SNAPSHOT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
