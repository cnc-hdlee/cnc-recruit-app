// Snapshot bundle: a self-contained JSON the maintainer exports for the viewer build to read.
// Keep this stable & versioned — viewer builds in the wild may be older.

import type { SheetMappings } from './sheetMapping';

export const SNAPSHOT_VERSION = 1 as const;

export interface SnapshotSheet {
  title: string;
  modifiedTime: string;
  tabs: Record<string, string[][]>;
}

export interface SnapshotCalendarAttendee {
  email?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
}

export interface SnapshotCalendarEvent {
  id: string;
  calendarId?: string; // 어느 캘린더에서 fetch 됐는지 — 삭제/업데이트 시 필요
  summary: string;
  description: string;
  location: string;
  colorId: string | null;
  allDay: boolean;
  start: string | null; // ISO dateTime or YYYY-MM-DD
  end: string | null;
  timeZone: string | null;
  htmlLink: string | null;
  attendees: SnapshotCalendarAttendee[];
  /** 일정에 붙은 파일 — 대부분 지원자 이력서. 파일명에 이름이 들어 있어 후보자 복구에 쓴다 */
  attachments?: { title: string; fileId: string | null; mimeType?: string; fileUrl?: string }[];
  conferenceUrl: string | null;
  status: string;
  updated: string | null;
  creator?: { email: string | null; self: boolean } | null;
  organizer?: { email: string | null; self: boolean } | null;
}

export interface SnapshotCalendar {
  events: SnapshotCalendarEvent[];
  fetchedAt: string;
  calendarId: string;
  range: { timeMin: string; timeMax: string };
}

export interface Snapshot {
  version: number;
  exportedAt: string; // ISO timestamp
  exportedBy?: string; // optional email/label of the person who exported
  appName: string;
  sheets: Record<string, SnapshotSheet>; // keyed by spreadsheetId
  mappings: SheetMappings;
  calendar?: SnapshotCalendar | null; // optional — older snapshots won't have it
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
