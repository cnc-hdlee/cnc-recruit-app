// Auto-linker: cross-references a candidate name across Gmail / Calendar / Slack / Sheets.
// Heuristic name matching — Korean names are 2~4 chars, so we look for whole-word matches with
// surrounding non-name punctuation/whitespace to avoid false hits inside other words.

import type { GmailMsg, GCalEvent, SlackMessage } from './api';

export interface CandidateRecord {
  name: string;
  dept?: string;
  job?: string;
  rank?: string;
  stage?: string;
  source: string; // which sheet/tab the candidate came from
}

export interface MentionRef {
  source: 'gmail' | 'calendar' | 'slack';
  id: string;
  date: string; // ISO or YYYY-MM-DD
  title: string;
  snippet?: string;
  link?: string;
  meta?: Record<string, string>;
}

export interface CandidateDossier extends CandidateRecord {
  mentions: MentionRef[];
  lastActivity: string | null; // ISO of most-recent mention
  unread?: number; // count of recent (last 14 days) mentions
}

// Korean honorific suffixes / titles that may follow a name in messages
const KOR_SUFFIX = '(?:\\s*(?:사원|주임|대리|과장|차장|부장|이사|상무|전무|팀장|매니저|님|씨|군|양|선생|책임|수석|선임)?)?';

function nameRegex(name: string): RegExp {
  // Escape special regex chars
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the name with word-boundary-ish guard. Korean syllables don't trigger \b, so we use lookaround.
  // Allow start/end of string, or a non-Korean-letter character around it.
  return new RegExp(`(?:^|[^A-Za-z0-9가-힣])${esc}${KOR_SUFFIX}(?=$|[^A-Za-z0-9가-힣])`, 'g');
}

export function matchesName(text: string, name: string): boolean {
  if (!text || !name || name.length < 2) return false;
  const t = String(text);
  // Quick reject: if substring not present at all, skip the regex.
  if (!t.includes(name)) return false;
  return nameRegex(name).test(t);
}

export function gmailMentions(msgs: GmailMsg[], name: string): MentionRef[] {
  return msgs
    .filter((m) => matchesName(`${m.subject} ${m.snippet} ${m.from} ${m.to}`, name))
    .map((m) => ({
      source: 'gmail' as const,
      id: m.id,
      date: m.date,
      title: m.subject || '(제목 없음)',
      snippet: m.snippet,
      link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
      meta: { from: m.from, to: m.to },
    }));
}

export function calendarMentions(events: GCalEvent[], name: string): MentionRef[] {
  return events
    .filter((e) => matchesName(`${e.summary} ${e.description} ${(e.attendees || []).map((a) => `${a.name} ${a.email}`).join(' ')}`, name))
    .map((e) => ({
      source: 'calendar' as const,
      id: e.id,
      date: e.start,
      title: e.summary || '(제목 없음)',
      snippet: e.location || e.description?.slice(0, 200),
      link: e.htmlLink,
    }));
}

export function slackMentions(msgs: (SlackMessage & { channelId?: string; userName?: string })[], name: string): MentionRef[] {
  return msgs
    .filter((m) => matchesName(m.text || '', name))
    .map((m) => ({
      source: 'slack' as const,
      id: `${m.channel || m.channelId}:${m.ts}`,
      date: new Date(parseFloat(m.ts) * 1000).toISOString(),
      title: m.text.length > 80 ? m.text.slice(0, 80) + '...' : m.text,
      snippet: m.text,
      link: m.permalink,
      meta: { user: m.userName || m.user, channel: m.channel || m.channelId || '' },
    }));
}

export function buildDossiers(input: {
  candidates: CandidateRecord[];
  gmail: GmailMsg[];
  calendar: GCalEvent[];
  slack: (SlackMessage & { channelId?: string; userName?: string })[];
  recentDays?: number;
}): CandidateDossier[] {
  const { candidates, gmail, calendar, slack, recentDays = 14 } = input;
  const cutoff = Date.now() - recentDays * 86400_000;

  return candidates.map((c) => {
    const mentions = [
      ...gmailMentions(gmail, c.name),
      ...calendarMentions(calendar, c.name),
      ...slackMentions(slack, c.name),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const lastActivity = mentions.length > 0 ? mentions[0].date : null;
    const unread = mentions.filter((m) => {
      const t = Date.parse(m.date);
      return !isNaN(t) && t >= cutoff;
    }).length;

    return { ...c, mentions, lastActivity, unread };
  });
}

// Identify mentions that don't match any known candidate — could be unknown candidates / typos
export function orphanMentions(input: {
  candidates: CandidateRecord[];
  gmail: GmailMsg[];
  calendar: GCalEvent[];
}): { source: 'gmail' | 'calendar'; title: string; date: string; reason: string }[] {
  const knownNames = new Set(input.candidates.map((c) => c.name));
  const out: { source: 'gmail' | 'calendar'; title: string; date: string; reason: string }[] = [];

  // Heuristic: subjects/event titles mentioning typical recruit keywords but no known name
  const RECRUIT_KW = ['면접', '입사', '채용', '지원자', '후보', '결재', '품의', 'CPI', '처우'];
  const looksRecruity = (t: string) => RECRUIT_KW.some((k) => t.includes(k));

  for (const m of input.gmail) {
    if (!looksRecruity(m.subject)) continue;
    let matched = false;
    for (const n of knownNames) {
      if (matchesName(m.subject + ' ' + m.snippet, n)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push({ source: 'gmail', title: m.subject, date: m.date, reason: '후보자 매칭 실패' });
    }
  }

  for (const e of input.calendar) {
    if (!looksRecruity(e.summary)) continue;
    let matched = false;
    for (const n of knownNames) {
      if (matchesName(`${e.summary} ${e.description}`, n)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push({ source: 'calendar', title: e.summary, date: e.start, reason: '후보자 매칭 실패' });
    }
  }

  return out;
}
