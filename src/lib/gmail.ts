// Build Gmail web URLs that open the right thread/search.
// Electron's windowOpenHandler already routes external links to the system browser.

export function gmailSearchUrl(opts: { subject?: string; from?: string; to?: string; query?: string }): string {
  const parts: string[] = [];
  if (opts.query) parts.push(opts.query);
  if (opts.subject) parts.push(`subject:"${escapeQuoted(opts.subject)}"`);
  if (opts.from) parts.push(`from:${escapeBareValue(opts.from)}`);
  if (opts.to) parts.push(`to:${escapeBareValue(opts.to)}`);
  const q = parts.join(' ');
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
}

export function gmailMessageUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

function escapeQuoted(s: string): string {
  return s.replace(/"/g, '');
}

function escapeBareValue(s: string): string {
  // Gmail search supports unquoted values when they contain no spaces/special chars.
  // For Korean names (without spaces) this works; otherwise quote it.
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '')}"`;
  return s;
}
