// Build-time mode flag.
// Set via Vite: VITE_VIEWER_MODE=true → viewer build (no OAuth, reads snapshot.json from same origin).
// Default → maintainer build (full Electron app with live sync).

export const IS_VIEWER: boolean =
  ((import.meta as any).env?.VITE_VIEWER_MODE === 'true' ||
    (import.meta as any).env?.VITE_VIEWER_MODE === '1') ?? false;

// Where to fetch the snapshot from in viewer mode. Defaults to same-origin /snapshot.json.
export const SNAPSHOT_URL: string =
  (import.meta as any).env?.VITE_SNAPSHOT_URL || '/snapshot.json';

// Tag shown in title bar / sidebar so distributed copies are clearly read-only.
export const MODE_LABEL = IS_VIEWER ? '뷰어' : '본체';
