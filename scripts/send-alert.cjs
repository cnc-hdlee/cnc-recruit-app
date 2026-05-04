#!/usr/bin/env node
/**
 * send-alert.cjs
 *
 * Reads alerts.json (output of detect-anomalies.cjs) and notifies the user.
 * Sends ONLY to the user themselves — never to candidates, hiring managers,
 * or external parties (per user's standing instruction).
 *
 * Channels (in priority order):
 *   1. Gmail self-mail to hdlee@cnccosmetic.com (requires gmail.send scope)
 *   2. Slack DM to SLACK_DM_USER_ID (optional, requires SLACK_TOKEN)
 *
 * Inputs:
 *   IN_PATH            alerts.json (default ./alerts.json)
 *   ALERT_RECIPIENT    email recipient (default hdlee@cnccosmetic.com)
 *   SLACK_DM_USER_ID   Slack user ID for DM (optional, e.g. "U01ABC...")
 *
 * Required env (Gmail send):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   The refresh token MUST have been issued with `gmail.send` scope, otherwise
 *   the send will fail with insufficient scope. Re-authorize in the desktop app
 *   after pulling the latest electron/integrations/google.cjs.
 *
 * Optional env (Slack):
 *   SLACK_TOKEN   xoxp-... or xoxb-... (needs chat:write scope)
 *
 * Exit code 0 always (best-effort delivery; failure should not break workflow).
 */

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { WebClient: SlackWebClient } = require('@slack/web-api');

const IN_PATH = process.env.IN_PATH || path.join(process.cwd(), 'alerts.json');
const RECIPIENT = process.env.ALERT_RECIPIENT || 'hdlee@cnccosmetic.com';

function loadAlerts() {
  if (!fs.existsSync(IN_PATH)) {
    console.log('[alert] no alerts.json — nothing to send');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  } catch (e) {
    console.error(`[alert] could not parse ${IN_PATH}: ${e.message}`);
    return null;
  }
}

function summarize(alerts) {
  const byType = {};
  for (const a of alerts) {
    byType[a.type] = byType[a.type] || [];
    byType[a.type].push(a);
  }

  const TYPE_LABELS = {
    ORPHAN_GMAIL: '📧 Gmail에 후보자 같은데 시트에 없음',
    ORPHAN_CALENDAR: '📅 캘린더에 면접/입사 일정인데 시트에 없음',
    ORPHAN_SLACK: '💬 슬랙에 후보자 언급인데 시트에 없음',
    MISSING_CAL: '⚠️ 시트엔 면접/입사 단계인데 캘린더에 일정 없음',
  };

  const lines = [];
  lines.push(`CNC 채용 통합 모니터 — 누락 ${alerts.length}건 감지\n`);
  lines.push(`생성 시각: ${new Date().toISOString()}\n`);

  for (const [type, items] of Object.entries(byType)) {
    lines.push(`\n━━━ ${TYPE_LABELS[type] || type} (${items.length}건) ━━━\n`);
    for (const a of items.slice(0, 20)) {
      lines.push(`• ${a.title}`);
      if (a.unknownNames?.length) lines.push(`  미등록 이름: ${a.unknownNames.join(', ')}`);
      if (a.candidateName) lines.push(`  후보자: ${a.candidateName} / 단계: ${a.stage} / 출처: ${a.sheetSource}`);
      if (a.from) lines.push(`  발신/사용자: ${a.from}`);
      if (a.date) lines.push(`  일시: ${a.date}`);
      if (a.snippet) lines.push(`  내용: ${a.snippet}`);
      if (a.link) lines.push(`  링크: ${a.link}`);
      lines.push('');
    }
    if (items.length > 20) lines.push(`...외 ${items.length - 20}건 생략\n`);
  }

  lines.push('\n---');
  lines.push('이 알림은 GitHub Actions cron (5분 주기)에서 자동 생성되었습니다.');
  lines.push('동일 항목은 30일간 재알림되지 않습니다.');
  return lines.join('\n');
}

function buildHtml(alerts) {
  const safe = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const byType = {};
  for (const a of alerts) {
    byType[a.type] = byType[a.type] || [];
    byType[a.type].push(a);
  }

  const TYPE_LABELS = {
    ORPHAN_GMAIL: '📧 Gmail에 후보자 같은데 시트에 없음',
    ORPHAN_CALENDAR: '📅 캘린더에 면접/입사 일정인데 시트에 없음',
    ORPHAN_SLACK: '💬 슬랙에 후보자 언급인데 시트에 없음',
    MISSING_CAL: '⚠️ 시트엔 면접/입사 단계인데 캘린더에 일정 없음',
  };

  let html = `<!doctype html><html><body style="font-family:Pretendard,system-ui,sans-serif;background:#f5f5f7;padding:20px;color:#1d1d1f">`;
  html += `<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px;box-shadow:0 2px 8px rgba(0,0,0,.04)">`;
  html += `<h2 style="margin:0 0 6px;font-size:18px">CNC 채용 통합 모니터</h2>`;
  html += `<p style="margin:0 0 24px;color:#86868b;font-size:13px">누락 <b style="color:#d70015">${alerts.length}건</b> 감지 · ${new Date().toLocaleString('ko-KR')}</p>`;

  for (const [type, items] of Object.entries(byType)) {
    html += `<h3 style="margin:24px 0 8px;font-size:15px;border-bottom:1px solid #e5e5ea;padding-bottom:6px">${TYPE_LABELS[type] || type} <span style="color:#86868b;font-weight:400">(${items.length}건)</span></h3>`;
    for (const a of items.slice(0, 20)) {
      html += `<div style="margin:12px 0;padding:12px 14px;background:#f5f5f7;border-radius:8px;font-size:13.5px">`;
      html += `<div style="font-weight:600;margin-bottom:4px">${safe(a.title)}</div>`;
      if (a.unknownNames?.length) html += `<div style="color:#d70015">미등록 이름: ${safe(a.unknownNames.join(', '))}</div>`;
      if (a.candidateName) html += `<div>후보자: <b>${safe(a.candidateName)}</b> · 단계: ${safe(a.stage)} · 출처: ${safe(a.sheetSource)}</div>`;
      if (a.from) html += `<div style="color:#6e6e73">발신: ${safe(a.from)}</div>`;
      if (a.date) html += `<div style="color:#6e6e73">일시: ${safe(a.date)}</div>`;
      if (a.snippet) html += `<div style="color:#3a3a3c;margin-top:4px">${safe(a.snippet)}</div>`;
      if (a.link) html += `<div style="margin-top:6px"><a href="${safe(a.link)}" style="color:#0071e3;text-decoration:none">바로 가기 →</a></div>`;
      html += `</div>`;
    }
    if (items.length > 20) html += `<p style="color:#86868b;font-size:12px">외 ${items.length - 20}건 생략</p>`;
  }

  html += `<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5ea;color:#86868b;font-size:11.5px">GitHub Actions cron (5분 주기) 자동 생성 · 동일 항목 30일 재알림 차단</p>`;
  html += `</div></body></html>`;
  return html;
}

function encodeRfc2047(s) {
  // For non-ASCII subject lines (Korean) — base64 encode per RFC 2047
  return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

async function sendGmail(alerts) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.error('[alert] gmail send skipped: GOOGLE_* env vars missing');
    return false;
  }
  const auth = new OAuth2Client(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const subject = `[CNC 채용] 누락 ${alerts.length}건 감지`;
  const text = summarize(alerts);
  const html = buildHtml(alerts);
  const boundary = `cnc-alert-${Date.now()}`;

  const raw = [
    `To: ${RECIPIENT}`,
    `From: ${RECIPIENT}`,
    `Subject: ${encodeRfc2047(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const encoded = Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
    console.log(`[alert] ✓ gmail sent to ${RECIPIENT}`);
    return true;
  } catch (e) {
    console.error(`[alert] ✗ gmail send failed: ${e.message}`);
    if (e.message?.includes('insufficient') || e.message?.includes('scope')) {
      console.error('[alert]   → re-authorize OAuth with gmail.send scope (see electron/integrations/google.cjs)');
    }
    return false;
  }
}

async function sendSlackDM(alerts) {
  const token = process.env.SLACK_TOKEN;
  const userId = process.env.SLACK_DM_USER_ID;
  if (!token || !userId) {
    console.log('[alert] slack DM skipped: SLACK_TOKEN or SLACK_DM_USER_ID not set');
    return false;
  }
  const client = new SlackWebClient(token);
  const text = summarize(alerts);
  try {
    // Open IM channel with user, then post
    const im = await client.conversations.open({ users: userId });
    if (!im.ok || !im.channel?.id) throw new Error('conversations.open failed');
    await client.chat.postMessage({
      channel: im.channel.id,
      text: text.slice(0, 35000), // Slack message limit safety
    });
    console.log(`[alert] ✓ slack DM sent to ${userId}`);
    return true;
  } catch (e) {
    console.error(`[alert] ✗ slack DM failed: ${e.message}`);
    return false;
  }
}

async function main() {
  const data = loadAlerts();
  if (!data) {
    console.log('[alert] no alerts file — exit');
    return;
  }
  if (!data.alerts || data.alerts.length === 0) {
    console.log('[alert] 0 new alerts — nothing to send');
    return;
  }

  console.log(`[alert] sending ${data.alerts.length} new alert(s)`);

  // Try Gmail first, then Slack as best-effort fallback / additional channel
  const gmailOk = await sendGmail(data.alerts);
  const slackOk = await sendSlackDM(data.alerts);

  if (!gmailOk && !slackOk) {
    console.error('[alert] WARNING: no channel succeeded — alerts NOT delivered');
  }
}

main().catch((e) => {
  console.error('[alert] FATAL:', e?.stack || e?.message || e);
  // exit 0 — don't break the workflow
});
