// Snapshot bundle: a self-contained JSON the maintainer exports for the viewer build to read.
// Keep this stable & versioned — viewer builds in the wild may be older.

import type { SheetMappings } from './sheetMapping';

export const SNAPSHOT_VERSION = 1 as const;

export interface SnapshotSheet {
  title: string;
  modifiedTime: string;
  tabs: Record<string, string[][]>;
}

export interface Snapshot {
  version: number;
  exportedAt: string; // ISO timestamp
  exportedBy?: string; // optional email/label of the person who exported
  appName: string;
  sheets: Record<string, SnapshotSheet>; // keyed by spreadsheetId
  mappings: SheetMappings;
}

export function buildSnapshot(input: {
  sheets: Record<string, SnapshotSheet>;
  mappings: SheetMappings;
  exportedBy?: string;
}): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: input.exportedBy,
    appName: 'CNC 채용 커맨드센터',
    sheets: input.sheets,
    mappings: input.mappings,
  };
}

export function isSnapshot(x: unknown): x is Snapshot {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.version === 'number' &&
    typeof obj.exportedAt === 'string' &&
    typeof obj.sheets === 'object' &&
    typeof obj.mappings === 'object'
  );
}

// Trigger a browser download of the snapshot JSON. Works in any browser context.
export function downloadSnapshot(snap: Snapshot, filename = 'snapshot.json') {
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
