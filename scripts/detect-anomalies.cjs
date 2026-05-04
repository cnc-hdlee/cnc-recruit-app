#!/usr/bin/env node
/**
 * detect-anomalies.cjs
 *
 * Cross-monitors snapshot.json (Sheets + Calendar + Gmail + Slack) and emits
 * a list of "누락 / 불일치" anomalies that the user should be notified about.
 *
 * Inputs:
 *   IN_PATH    snapshot.json path (default ./snapshot.json)
 *   STATE_PATH alert-state.json path (default ./alert-state.json) — used for dedup
 *   OUT_PATH   alerts.json path (default ./alerts.json) — list of NEW alerts only
 *
 * State file shape:
 *   { sentKeys: { "<alert-key>": "<ISO timestamp>" }, lastRunAt: "..." }
 *
 * Anomaly types emitted:
 *   - ORPHAN_GMAIL    : recruit-keyword Gmail mentioning a Korean name not in any sheet
 *   - ORPHAN_CALENDAR : recruit-keyword Calendar event for a name not in any sheet
 *   - ORPHAN_SLACK    : recruit-keyword Slack message mentioning a name not in any sheet
 *   - MISSING_CAL     : sheet says "면접 확정/예정" but no Calendar event in ±7 days for that name
 *
 * Exit code 0 always (anomalies are data, not failure).
 */

const fs = require('node:fs');
const path = require('node:path');

const IN_PATH = process.env.IN_PATH || path.join(process.cwd(), 'snapshot.json');
const STATE_PATH = process.env.STATE_PATH || path.join(process.cwd(), 'alert-state.json');
const OUT_PATH = process.env.OUT_PATH || path.join(process.cwd(), 'alerts.json');

const RECRUIT_KEYWORDS = ['면접', '입사', '채용', '지원자', '후보', '결재', '품의', 'CPI', '처우', '이력서', '오퍼', '합격', '불합격'];
const STAGE_SCHEDULED_HINTS = ['면접확정', '면접 확정', '면접예정', '면접 예정', '1차면접', '2차면접', '입사예정', '입사 예정'];

// Korean honorific suffix (mirrors src/lib/autoLink.ts)
const KOR_SUFFIX = '(?:\\s*(?:사원|주임|대리|과장|차장|부장|이사|상무|전무|팀장|매니저|님|씨|군|양|선생|책임|수석|선임)?)?';

function nameRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9가-힣])${esc}${KOR_SUFFIX}(?=$|[^A-Za-z0-9가-힣])`);
}

function matchesName(text, name) {
  if (!text || !name || name.length < 2) return false;
  const t = String(text);
  if (!t.includes(name)) return false;
  return nameRegex(name).test(t);
}

// Heuristic: is this string a Korean person name? 2-4 한글 syllables.
function looksLikeKoreanName(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  return /^[가-힣]{2,4}$/.test(trimmed);
}

function looksRecruity(text) {
  if (!text) return false;
  return RECRUIT_KEYWORDS.some((k) => text.includes(k));
}

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[detect] could not parse ${p}: ${e.message}`);
    return fallback;
  }
}

// Build a Set of "known candidate names" by scanning every cell across all sheets.
// This is intentionally permissive (any 2-4 한글 cell) — we'd rather skip a real
// orphan than wake the user up at 3am for a false positive.
function buildKnownNames(snapshot) {
  const names = new Set();
  const sheets = snapshot.sheets || {};
  for (const sheet of Object.values(sheets)) {
    const tabs = sheet.tabs || {};
    for (const rows of Object.values(tabs)) {
      for (const row of rows || []) {
        for (const cell of row || []) {
          if (looksLikeKoreanName(cell)) names.add(String(cell).trim());
        }
      }
    }
  }
  return names;
}

// Find recruit-keyword + candidate-name cells with a stage suggesting an
// upcoming interview/onboarding. Returns list of { name, stage, source }.
function findScheduledCandidates(snapshot) {
  const out = [];
  const sheets = snapshot.sheets || {};
  for (const [sheetId, sheet] of Object.entries(sheets)) {
    const tabs = sheet.tabs || {};
    for (const [tabName, rows] of Object.entries(tabs)) {
      const r = rows || [];
      if (r.length < 2) continue;
      const header = r[0].map((c) => String(c || '').trim());
      // try to find "이름" column
      const nameIdx = header.findIndex((h) => h === '이름' || h === '성명' || h === '후보자');
      if (nameIdx < 0) continue;
      // any column containing stage hints
      for (let i = 1; i < r.length; i++) {
        const row = r[i] || [];
        const name = row[nameIdx];
        if (!looksLikeKoreanName(name)) continue;
        const rowText = row.join(' ');
        const matchedStage = STAGE_SCHEDULED_HINTS.find((h) => rowText.includes(h));
        if (matchedStage) {
          out.push({
            name: String(name).trim(),
            stage: matchedStage,
            source: `${sheet.title || sheetId}/${tabName}`,
          });
        }
      }
    }
  }
  return out;
}

function detectOrphans(snapshot, knownNames) {
  const alerts = [];

  // Gmail orphans
  const gmailMsgs = snapshot.gmail?.messages || [];
  for (const m of gmailMsgs) {
    const blob = `${m.subject || ''} ${m.snippet || ''}`;
    if (!looksRecruity(blob)) continue;
    const namesInText = [...blob.matchAll(/[가-힣]{2,4}/g)].map((x) => x[0]).filter(looksLikeKoreanName);
    const unknown = namesInText.filter((n) => !knownNames.has(n));
    if (unknown.length > 0) {
      alerts.push({
        key: `orphan:gmail:${m.id}`,
        type: 'ORPHAN_GMAIL',
        title: m.subject || '(제목 없음)',
        date: m.date,
        unknownNames: [...new Set(unknown)],
        link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
        snippet: (m.snippet || '').slice(0, 200),
        from: m.from,
      });
    }
  }

  // Calendar orphans
  const events = snapshot.calendar?.events || [];
  for (const e of events) {
    const blob = `${e.summary || ''} ${e.description || ''} ${(e.attendees || []).map((a) => `${a.name || ''} ${a.email || ''}`).join(' ')}`;
    if (!looksRecruity(blob)) continue;
    const namesInText = [...blob.matchAll(/[가-힣]{2,4}/g)].map((x) => x[0]).filter(looksLikeKoreanName);
    const unknown = namesInText.filter((n) => !knownNames.has(n));
    if (unknown.length > 0) {
      alerts.push({
        key: `orphan:calendar:${e.id}`,
        type: 'ORPHAN_CALENDAR',
        title: e.summary || '(제목 없음)',
        date: e.start,
        unknownNames: [...new Set(unknown)],
        link: e.htmlLink,
        snippet: (e.description || e.location || '').slice(0, 200),
      });
    }
  }

  // Slack orphans
  const slackMsgs = snapshot.slack?.messages || [];
  for (const m of slackMsgs) {
    if (!looksRecruity(m.text)) continue;
    const namesInText = [...m.text.matchAll(/[가-힣]{2,4}/g)].map((x) => x[0]).filter(looksLikeKoreanName);
    const unknown = namesInText.filter((n) => !knownNames.has(n));
    if (unknown.length > 0) {
      alerts.push({
        key: `orphan:slack:${m.channelId}:${m.ts}`,
        type: 'ORPHAN_SLACK',
        title: `[${m.channelName}] ${m.text.slice(0, 80)}${m.text.length > 80 ? '...' : ''}`,
        date: new Date(parseFloat(m.ts) * 1000).toISOString(),
        unknownNames: [...new Set(unknown)],
        link: null,
        snippet: m.text.slice(0, 200),
        from: m.userName || m.user,
      });
    }
  }

  return alerts;
}

function detectMissingCalendar(snapshot) {
  const alerts = [];
  const scheduled = findScheduledCandidates(snapshot);
  const events = snapshot.calendar?.events || [];
  const now = Date.now();
  const WINDOW_MS = 7 * 86400_000;

  for (const cand of scheduled) {
    // does any event in ±7 days mention this name?
    const found = events.some((e) => {
      if (!e.start) return false;
      const t = Date.parse(e.start);
      if (isNaN(t)) return false;
      if (Math.abs(t - now) > WINDOW_MS && t > now) {
        // allow future events further out for 입사
        if (cand.stage.includes('입사') && t - now < 60 * 86400_000) {
          // within 60 days for onboarding is fine
        } else if (Math.abs(t - now) > WINDOW_MS) {
          return false;
        }
      }
      const blob = `${e.summary || ''} ${e.description || ''} ${(e.attendees || []).map((a) => `${a.name || ''}`).join(' ')}`;
      return matchesName(blob, cand.name);
    });
    if (!found) {
      alerts.push({
        key: `missing-cal:${cand.name}:${cand.source}:${cand.stage}`,
        type: 'MISSING_CAL',
        title: `${cand.name} — 시트엔 "${cand.stage}"인데 캘린더에 일정 없음`,
        date: new Date().toISOString(),
        candidateName: cand.name,
        sheetSource: cand.source,
        stage: cand.stage,
      });
    }
  }
  return alerts;
}

function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`[detect] FATAL: snapshot not found at ${IN_PATH}`);
    process.exit(1);
  }
  const snapshot = loadJson(IN_PATH, null);
  if (!snapshot) {
    console.error('[detect] FATAL: snapshot unreadable');
    process.exit(1);
  }

  const state = loadJson(STATE_PATH, { sentKeys: {}, lastRunAt: null });
  const sentKeys = state.sentKeys || {};

  const knownNames = buildKnownNames(snapshot);
  console.log(`[detect] indexed ${knownNames.size} known names from sheets`);

  const allAlerts = [
    ...detectOrphans(snapshot, knownNames),
    ...detectMissingCalendar(snapshot),
  ];

  // Filter: only NEW alerts (not in sent state). Also skip alerts with key already sent
  // within the last 30 days (older keys age out automatically).
  const THIRTY_DAYS_MS = 30 * 86400_000;
  const now = Date.now();
  const newAlerts = allAlerts.filter((a) => {
    const ts = sentKeys[a.key];
    if (!ts) return true;
    return now - Date.parse(ts) > THIRTY_DAYS_MS;
  });

  // Update state — record every alert we're about to send as "sent now"
  for (const a of newAlerts) {
    sentKeys[a.key] = new Date().toISOString();
  }
  // Garbage collect: drop keys older than 60 days
  for (const k of Object.keys(sentKeys)) {
    if (now - Date.parse(sentKeys[k]) > 60 * 86400_000) delete sentKeys[k];
  }

  fs.writeFileSync(STATE_PATH, JSON.stringify({ sentKeys, lastRunAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalDetected: allAlerts.length,
    newCount: newAlerts.length,
    alerts: newAlerts,
  }, null, 2), 'utf8');

  console.log(`[detect] ${allAlerts.length} total, ${newAlerts.length} new (rest already notified)`);
}

main();
