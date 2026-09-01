// 이력서 보관함 (Resume Vault) — 앱에 드래그앤드랍한 이력서 원본을 로컬에 쌓고 구글 드라이브에 백업한다.
//
// 저장 구조 (userData = %APPDATA%/cnc-recruit-app)
//   userData/resumes/index.json      메타데이터 인덱스 (이름/팀/직무/등록일/해시/드라이브ID …)
//   userData/resumes/files/<id>.<ext> 원본 파일
//
// 설계 원칙
//   · 로컬이 원본(source of truth). 드라이브 업로드는 백업이며 실패해도 저장은 성공한다(나중에 재시도).
//   · 같은 파일(내용 해시 동일)은 두 번 저장하지 않는다 — 메모리 [데이터 넣을 때 중복 절대 금지].
//     단 "같은 사람의 다른 이력서"는 재지원 이력이므로 별도 항목으로 남긴다.
//   · 삭제는 사용자가 명시적으로 누를 때만. 인덱스와 파일을 함께 지운다(드라이브 사본도 함께).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, shell } = require('electron');

let google = null; // 순환 참조 방지를 위해 지연 로드
function gapi() {
  if (!google) google = require('./google.cjs');
  return google;
}

function rootDir() {
  return path.join(app.getPath('userData'), 'resumes');
}
function filesDir() {
  return path.join(rootDir(), 'files');
}
function indexPath() {
  return path.join(rootDir(), 'index.json');
}

function ensureDirs() {
  fs.mkdirSync(filesDir(), { recursive: true });
}

function readIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  ensureDirs();
  fs.writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf8');
}

const EXT_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.hwp': 'application/x-hwp',
  '.hwpx': 'application/hwp+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

function mimeFor(filename) {
  return EXT_MIME[path.extname(filename || '').toLowerCase()] || 'application/octet-stream';
}

function safeName(filename) {
  return (filename || 'resume').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
}

// 팀이 아직 확인 안 된 이력서가 들어가는 폴더 — "미분류"가 아니라 처리해야 할 할 일 목록이다.
const PENDING_FOLDER = '_확인필요';

function teamFolder(entry) {
  const t = (entry.team || '').trim();
  return t ? safeName(t) : PENDING_FOLDER;
}

// 사람 이름이 그대로 보이는 파일명: 이름_팀_직무_YYYYMMDD.pdf
function canonicalName(entry) {
  const ext = path.extname(entry.storedName || entry.filename || '') || '.bin';
  const d = (entry.appliedAt || entry.addedAt || '').replace(/[^0-9]/g, '').slice(0, 8);
  const parts = [entry.candidate?.trim(), entry.team?.trim(), entry.job?.trim(), d].filter(Boolean);
  // 이름을 못 읽었으면 원본 파일명을 그대로 쓴다 (엉뚱한 이름을 지어내지 않는다)
  if (!entry.candidate?.trim()) return safeName(entry.filename);
  return `${safeName(parts.join('_'))}${ext.toLowerCase()}`;
}

// 같은 폴더에 같은 이름이 있으면 (2), (3) … 을 붙인다
function uniqueIn(dirAbs, name, selfPath) {
  let out = name;
  let i = 2;
  while (fs.existsSync(path.join(dirAbs, out)) && path.join(dirAbs, out) !== selfPath) {
    const ext = path.extname(name);
    out = `${path.basename(name, ext)} (${i})${ext}`;
    i += 1;
  }
  return out;
}

// ── 저장 ────────────────────────────────────────────────────────────────────
/**
 * @param {{filename:string, base64:string, meta?:object}} payload
 * @returns {{entry:object, duplicate:boolean}}
 */
function saveResume({ filename, base64, meta }) {
  ensureDirs();
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('빈 파일입니다');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const list = readIndex();

  // 같은 내용의 파일이 이미 있으면 새로 만들지 않고 기존 항목을 돌려준다
  const dup = list.find((r) => r.hash === hash);
  if (dup) return { entry: dup, duplicate: true };

  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const ext = path.extname(filename || '') || '.bin';
  // 저장 경로는 처음부터 팀 폴더 + 사람 이름 파일명으로 — 나중에 정리할 필요가 없게.
  const draft = {
    storedName: `x${ext}`,
    filename: safeName(filename),
    candidate: meta?.candidate || '',
    team: meta?.team || '',
    job: meta?.job || '',
    appliedAt: meta?.appliedAt || '',
    addedAt: new Date().toISOString(),
  };
  const folder = teamFolder(draft);
  const dirAbs = path.join(filesDir(), folder);
  fs.mkdirSync(dirAbs, { recursive: true });
  const fname = uniqueIn(dirAbs, canonicalName(draft), '');
  const stored = path.posix.join(folder, fname);
  fs.writeFileSync(path.join(filesDir(), folder, fname), buf);

  const entry = {
    id,
    filename: safeName(filename),
    storedName: stored,
    mimeType: mimeFor(filename),
    size: buf.length,
    hash,
    addedAt: new Date().toISOString(),
    // 화면에서 편집 가능한 메타 — 파일명 파서가 채우고 사용자가 고친다
    candidate: meta?.candidate || '',
    team: meta?.team || '',
    job: meta?.job || '',
    channel: meta?.channel || '',
    appliedAt: meta?.appliedAt || '',
    note: meta?.note || '',
    tags: Array.isArray(meta?.tags) ? meta.tags : [],
    source: meta?.source || 'drop',
    driveFileId: null,
    driveError: null,
  };
  list.push(entry);
  writeIndex(list);
  return { entry, duplicate: false };
}

function listResumes() {
  return readIndex();
}

function updateResume(id, patch) {
  const list = readIndex();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('해당 이력서를 찾을 수 없습니다');
  const allowed = ['candidate', 'team', 'job', 'channel', 'appliedAt', 'note', 'tags', 'filename'];
  for (const k of allowed) {
    if (patch && k in patch) list[i][k] = patch[k];
  }
  list[i].updatedAt = new Date().toISOString();
  writeIndex(list);
  return list[i];
}

function readResumeBase64(id) {
  const list = readIndex();
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error('해당 이력서를 찾을 수 없습니다');
  const p = path.join(filesDir(), r.storedName);
  if (!fs.existsSync(p)) throw new Error('원본 파일이 로컬에 없습니다 (드라이브에서 복구 필요)');
  return {
    base64: fs.readFileSync(p).toString('base64'),
    mimeType: r.mimeType,
    filename: r.filename,
  };
}

// OS 기본 프로그램으로 열기 (hwp/docx 등 앱 내 미리보기가 안 되는 형식용)
async function openResume(id) {
  const list = readIndex();
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error('해당 이력서를 찾을 수 없습니다');
  const p = path.join(filesDir(), r.storedName);
  if (!fs.existsSync(p)) throw new Error('원본 파일이 로컬에 없습니다');
  const err = await shell.openPath(p);
  if (err) throw new Error(`파일 열기 실패: ${err}`);
  return { path: p };
}

function revealResumeFolder() {
  ensureDirs();
  shell.openPath(filesDir());
  return { path: filesDir() };
}

async function deleteResume(id) {
  const list = readIndex();
  const r = list.find((x) => x.id === id);
  if (!r) return { ok: true };
  try {
    fs.unlinkSync(path.join(filesDir(), r.storedName));
  } catch {
    // 파일이 이미 없어도 인덱스는 정리한다
  }
  if (r.driveFileId) {
    try {
      await gapi().deleteDriveFile(r.driveFileId);
    } catch {
      // 드라이브 삭제 실패는 치명적이지 않음 — 로컬 인덱스는 정리
    }
  }
  writeIndex(list.filter((x) => x.id !== id));
  return { ok: true };
}

// ── 이력서에서 연락처 뽑기 ──────────────────────────────────────────────────
// 후보자 안내 메일의 받는 사람을 손으로 치지 않게, 이력서 원본에서 이메일/전화를 읽어온다.
//
// PDF 본문은 대부분 FlateDecode로 압축돼 있고, 텍스트는 (…) 문자열 안에 들어 있다.
// 커닝 때문에 "hong"  "@"  "gmail.com" 처럼 쪼개지므로 괄호 문자열을 이어 붙인 뒤 정규식을 건다.
// (한글은 CID 폰트라 깨질 수 있지만 이메일·전화는 ASCII라 이 방식으로 잘 잡힌다)
const zlib = require('node:zlib');

function pdfParenStrings(s) {
  let out = '';
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (depth > 0 && ch === '\\') {
      cur += s[i + 1] || '';
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth === 1) cur = '';
      else cur += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        out += cur;
        cur = '';
      } else if (depth > 0) cur += ch;
      continue;
    }
    if (depth > 0) cur += ch;
  }
  return out;
}

// 텍스트 레이어(사람이 읽는 글자)와 raw(메타데이터·바이너리)를 분리해서 돌려준다.
// raw까지 뒤지면 XMP 메타데이터가 글자에 눌어붙어 "en-UStkdgus9114@naver.com" 같은 쓰레기가 나온다.
function pdfTextCandidates(buf) {
  const texts = [];
  const raw = buf.toString('latin1');
  texts.push(pdfParenStrings(raw));
  // FlateDecode 스트림 풀기
  let idx = 0;
  for (;;) {
    const s = raw.indexOf('stream', idx);
    if (s < 0) break;
    const e = raw.indexOf('endstream', s);
    if (e < 0) break;
    let start = s + 6;
    if (raw[start] === '\r') start += 1;
    if (raw[start] === '\n') start += 1;
    const chunk = buf.subarray(start, e);
    if (chunk.length > 8 && chunk.length < 8 * 1024 * 1024) {
      try {
        const inflated = zlib.inflateSync(chunk).toString('latin1');
        texts.push(pdfParenStrings(inflated));
      } catch {
        // 이미지·비압축 스트림 — 무시
      }
    }
    idx = e + 9;
  }
  return { layer: texts, raw };
}

// 실재하는 TLD만 인정 — "naver.en", "g4.Bj" 같은 PDF 내부 문자열 조각을 걸러낸다
const EMAIL_RE =
  /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|kr|co\.kr|ne\.kr|or\.kr|ac\.kr|pe\.kr|edu|io|me|biz|info)\b/gi;
// 휴대폰 — 앞뒤로 숫자가 더 붙지 않아야 하고, 구분자가 있거나 정확히 11자리
const PHONE_RE = /(?<!\d)01[016-9](?:[-. ]\d{3,4}[-. ]\d{4}|\d{7,8})(?!\d)/g;
// 메일 앞에 눌어붙는 흔한 메타데이터 조각 (언어코드·인코딩 표기 등)
const EMAIL_NOISE_PREFIX = /^(?:[a-z]{2}-[A-Z]{2}|utf-?8|xml|iso-?\d+|adobe|acrobat|word|hwp)/;
// 지원자 본인 주소가 아닐 가능성이 큰 도메인 (회사·채용플랫폼 알림)
const NOT_CANDIDATE_DOMAIN =
  /@(cnccosmetic\.com|jobkorea\.co\.kr|saramin\.co\.kr|greetinghr\.com|incruit\.com|wanted\.co\.kr|google\.com|gmail-noreply)/i;

// 1순위: pdf-parse(pdf.js)로 제대로 된 텍스트 추출 — 한글 CID 폰트까지 정확히 읽는다.
// 2순위: 위 라이브러리가 실패하면 zlib 자체 파서 (ASCII만 건짐).
let PDFParseCls;
function pdfLib() {
  if (PDFParseCls === undefined) {
    try {
      PDFParseCls = require('pdf-parse').PDFParse;
    } catch {
      PDFParseCls = null;
    }
  }
  return PDFParseCls;
}

async function pdfText(buf) {
  const P = pdfLib();
  if (P) {
    let parser = null;
    try {
      parser = new P({ data: new Uint8Array(buf) });
      const r = await parser.getText();
      if (r && r.text) return r.text;
    } catch {
      // 손상된 PDF·암호화 문서 → 아래 fallback
    } finally {
      try {
        await parser?.destroy?.();
      } catch {
        /* noop */
      }
    }
  }
  return pdfTextCandidates(buf).layer.join('\n');
}

async function extractContacts(id) {
  const list = readIndex();
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error('해당 이력서를 찾을 수 없습니다');
  const p = path.join(filesDir(), r.storedName);
  if (!fs.existsSync(p)) throw new Error('원본 파일이 로컬에 없습니다');
  const buf = fs.readFileSync(p);
  const parsed =
    r.mimeType === 'application/pdf'
      ? { layer: [await pdfText(buf)], raw: buf.toString('latin1') }
      : { layer: [buf.toString('utf8')], raw: '' };
  const emails = new Set();
  const phones = new Set();
  const addEmails = (t) => {
    for (const m of t.match(EMAIL_RE) || []) {
      let v = m.replace(/\.$/, '');
      if (v.length > 64) continue;
      // 앞에 눌어붙은 메타데이터 조각 제거 ("en-UStkdgus9114@…" → "tkdgus9114@…")
      const local = v.slice(0, v.indexOf('@'));
      const noise = local.match(EMAIL_NOISE_PREFIX);
      if (noise) v = v.slice(noise[0].length);
      if (v.startsWith('@')) continue;
      emails.add(v);
    }
  };
  // 1순위: 사람이 읽는 텍스트 레이어
  for (const t of parsed.layer) {
    addEmails(t);
    for (const m of t.match(PHONE_RE) || []) {
      phones.add(m.replace(/[.\s]/g, '-'));
    }
  }
  // 2순위: 텍스트 레이어에서 못 찾았을 때만 raw (메타데이터 포함이라 정확도가 떨어짐)
  if (emails.size === 0 && parsed.raw) addEmails(parsed.raw);
  const ranked = [...emails].sort((a, b) => {
    const an = NOT_CANDIDATE_DOMAIN.test(a) ? 1 : 0;
    const bn = NOT_CANDIDATE_DOMAIN.test(b) ? 1 : 0;
    return an - bn || a.length - b.length;
  });
  const out = {
    id,
    candidate: r.candidate,
    email: ranked.find((e) => !NOT_CANDIDATE_DOMAIN.test(e)) || '',
    emails: ranked,
    phone: [...phones][0] || '',
    phones: [...phones],
  };
  // 인덱스에 캐시 — 같은 이력서를 다시 파싱하지 않게 (메일 화면에서 즉시 뜬다)
  if (out.email !== r.contactEmail || out.phone !== r.contactPhone) {
    r.contactEmail = out.email;
    r.contactPhone = out.phone;
    r.contactAt = new Date().toISOString();
    writeIndex(list);
  }
  return out;
}

/**
 * 파일을 저장하지 않고 버퍼에서만 연락처를 뽑는다.
 * 보관함에 없는 지원자(현업이 메일로 보낸 이력서 등)의 주소를 채울 때 쓴다 — 보관함은 건드리지 않는다.
 */
async function extractContactsFromData(base64, mimeType) {
  const buf = Buffer.from(base64 || '', 'base64');
  if (!buf.length) return { email: '', emails: [], phone: '', phones: [] };
  const text =
    (mimeType || '').includes('pdf') || buf.subarray(0, 4).toString() === '%PDF'
      ? await pdfText(buf)
      : buf.toString('utf8');
  const emails = new Set();
  const phones = new Set();
  for (const m of text.match(EMAIL_RE) || []) {
    let v = m.replace(/\.$/, '');
    if (v.length > 64) continue;
    const local = v.slice(0, v.indexOf('@'));
    const noise = local.match(EMAIL_NOISE_PREFIX);
    if (noise) v = v.slice(noise[0].length);
    if (!v.startsWith('@')) emails.add(v);
  }
  for (const m of text.match(PHONE_RE) || []) phones.add(m.replace(/[.\s]/g, '-'));
  const ranked = [...emails].sort((a, b) => {
    const an = NOT_CANDIDATE_DOMAIN.test(a) ? 1 : 0;
    const bn = NOT_CANDIDATE_DOMAIN.test(b) ? 1 : 0;
    return an - bn || a.length - b.length;
  });
  return {
    email: ranked.find((e) => !NOT_CANDIDATE_DOMAIN.test(e)) || '',
    emails: ranked,
    phone: [...phones][0] || '',
    phones: [...phones],
  };
}

/** 이름으로 보관함을 찾아 연락처를 돌려준다 (가장 최근 이력서 우선, 캐시 있으면 즉시) */
async function contactsByName(name) {
  const key = (name || '').replace(/\s+/g, '');
  if (!key) return { email: '', phone: '', emails: [], phones: [], id: null };
  const hits = readIndex()
    .filter((r) => (r.candidate || '').replace(/\s+/g, '') === key)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  const cached = hits.find((h) => h.contactEmail || h.contactPhone);
  if (cached) {
    return {
      id: cached.id,
      candidate: cached.candidate,
      email: cached.contactEmail || '',
      phone: cached.contactPhone || '',
      emails: cached.contactEmail ? [cached.contactEmail] : [],
      phones: cached.contactPhone ? [cached.contactPhone] : [],
      cached: true,
    };
  }
  for (const h of hits) {
    try {
      const c = await extractContacts(h.id);
      if (c.email || c.phone) return c;
    } catch {
      // 다음 이력서로
    }
  }
  return { email: '', phone: '', emails: [], phones: [], id: hits[0]?.id || null };
}

// ── 분류 일괄 반영 ──────────────────────────────────────────────────────────
// 화면(면접 캘린더·시트 매칭)에서 찾아낸 팀/직무를 한 번에 적용한다.
// fill 모드(기본)에서는 비어 있는 칸만 채우고, 사용자가 직접 넣은 값은 덮어쓰지 않는다.
function applyClassification(updates, { overwrite = false } = {}) {
  const list = readIndex();
  let changed = 0;
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const u of updates || []) {
    const r = byId.get(u.id);
    if (!r) continue;
    let touched = false;
    for (const k of ['candidate', 'team', 'job']) {
      const v = (u[k] || '').trim();
      if (!v) continue;
      if (overwrite || !(r[k] || '').trim()) {
        if (r[k] !== v) {
          r[k] = v;
          touched = true;
        }
      }
    }
    if (u.matchedBy && touched) r.matchedBy = u.matchedBy;
    if (touched) {
      r.updatedAt = new Date().toISOString();
      changed += 1;
    }
  }
  if (changed) writeIndex(list);
  return { changed };
}

// ── 폴더 정리 ───────────────────────────────────────────────────────────────
// 로컬과 드라이브를 동일한 구조로 맞춘다: <팀>/이름_팀_직무_YYYYMMDD.pdf
// 팀을 아직 못 찾은 건은 _확인필요 폴더로 모아 눈에 띄게 남긴다.
// 디스크 ↔ 인덱스 정합성 복구.
// 저장 중 앱이 꺼지거나 인덱스 쓰기가 유실되면 "파일은 있는데 목록엔 없는" 고아 파일이 남는다.
//   · 내용 해시가 이미 등록된 이력서와 같으면 = 중복본 → 삭제 (메모리 [중복 절대 금지])
//   · 처음 보는 내용이면 = 유실된 이력서 → 인덱스에 되살린다 (파일은 절대 지우지 않는다)
function reconcileFiles() {
  ensureDirs();
  const list = readIndex();
  const known = new Set(list.map((r) => (r.storedName || '').replace(/\\/g, '/')));
  const byHash = new Map(list.map((r) => [r.hash, r]));
  const out = { duplicatesRemoved: 0, recovered: 0 };
  const walk = (absDir, rel) => {
    for (const d of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, d.name);
      const relPath = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      if (known.has(relPath)) continue;
      const buf = fs.readFileSync(abs);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (byHash.has(hash)) {
        fs.unlinkSync(abs); // 이미 보관 중인 이력서와 같은 파일 → 중복본 제거
        out.duplicatesRemoved += 1;
        continue;
      }
      const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      const entry = {
        id,
        filename: d.name,
        storedName: relPath,
        mimeType: mimeFor(d.name),
        size: buf.length,
        hash,
        addedAt: fs.statSync(abs).mtime.toISOString(),
        candidate: '',
        team: rel && rel !== PENDING_FOLDER ? rel : '',
        job: '',
        channel: '',
        appliedAt: '',
        note: '목록에서 유실됐다가 복구된 파일 — 이름/팀 확인 필요',
        tags: [],
        source: 'recovered',
        driveFileId: null,
        driveError: null,
      };
      list.push(entry);
      byHash.set(hash, entry);
      known.add(relPath);
      out.recovered += 1;
    }
  };
  walk(filesDir(), '');
  if (out.duplicatesRemoved || out.recovered) writeIndex(list);
  return out;
}

async function organizeVault({ skipDrive = false } = {}) {
  ensureDirs();
  const heal = reconcileFiles();
  const list = readIndex();
  const report = { localMoved: 0, driveMoved: 0, driveRenamed: 0, errors: [], pending: 0, ...heal };
  for (const r of list) {
    if (!r.team?.trim()) report.pending += 1;
    // 1) 로컬 이동/이름변경
    try {
      const curAbs = path.join(filesDir(), r.storedName);
      const folder = teamFolder(r);
      const dirAbs = path.join(filesDir(), folder);
      const want = canonicalName(r);
      const wantRel = path.posix.join(folder, want);
      if (fs.existsSync(curAbs) && r.storedName !== wantRel) {
        fs.mkdirSync(dirAbs, { recursive: true });
        const finalName = uniqueIn(dirAbs, want, curAbs);
        fs.renameSync(curAbs, path.join(dirAbs, finalName));
        r.storedName = path.posix.join(folder, finalName);
        report.localMoved += 1;
      }
    } catch (e) {
      report.errors.push(`${r.filename} (로컬) — ${e.message || e}`);
    }
    // 2) 드라이브 이동/이름변경 — 이미 같은 이름·같은 팀 폴더면 API를 부르지 않는다(불필요한 호출 방지)
    const wantName = path.basename(r.storedName);
    const wantTeam = r.team?.trim() || PENDING_FOLDER;
    const driveInSync = r.driveName === wantName && r.driveTeam === wantTeam;
    if (!skipDrive && r.driveFileId && !driveInSync) {
      try {
        const res = await gapi().moveResumeFile(r.driveFileId, { name: wantName, team: wantTeam });
        if (res.moved) report.driveMoved += 1;
        if (res.renamed) report.driveRenamed += 1;
        if (res.webViewLink) r.driveLink = res.webViewLink;
        r.driveName = wantName;
        r.driveTeam = wantTeam;
        r.driveError = null;
      } catch (e) {
        r.driveError = e.message || String(e);
        report.errors.push(`${r.filename} (드라이브) — ${r.driveError}`);
      }
    }
  }
  writeIndex(list);
  // 빈 폴더 정리
  try {
    for (const d of fs.readdirSync(filesDir(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(filesDir(), d.name);
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    }
  } catch {
    // 정리 실패는 무시
  }
  return report;
}

// ── 드라이브 백업 ───────────────────────────────────────────────────────────
// drive.file 스코프 = 앱이 만든 파일만 접근. 기존 드라이브 문서는 건드릴 수 없다.
async function backupToDrive(ids) {
  const list = readIndex();
  const targets = (ids && ids.length ? list.filter((r) => ids.includes(r.id)) : list).filter(
    (r) => !r.driveFileId
  );
  let uploaded = 0;
  const errors = [];
  for (const r of targets) {
    const p = path.join(filesDir(), r.storedName);
    if (!fs.existsSync(p)) continue;
    try {
      const res = await gapi().uploadResumeFile({
        name: path.basename(r.storedName),
        mimeType: r.mimeType,
        filePath: p,
        team: r.team?.trim() || PENDING_FOLDER,
      });
      r.driveFileId = res.id;
      r.driveLink = res.webViewLink || null;
      r.driveName = path.basename(r.storedName);
      r.driveTeam = r.team?.trim() || PENDING_FOLDER;
      r.driveError = null;
      uploaded += 1;
    } catch (e) {
      r.driveError = e.message || String(e);
      errors.push(`${r.filename}: ${r.driveError}`);
    }
  }
  writeIndex(list);
  return { uploaded, pending: targets.length - uploaded, errors };
}

function stats() {
  const list = readIndex();
  return {
    count: list.length,
    bytes: list.reduce((a, r) => a + (r.size || 0), 0),
    backedUp: list.filter((r) => r.driveFileId).length,
    dir: filesDir(),
  };
}

module.exports = {
  saveResume,
  listResumes,
  updateResume,
  readResumeBase64,
  openResume,
  revealResumeFolder,
  deleteResume,
  backupToDrive,
  applyClassification,
  organizeVault,
  extractContacts,
  extractContactsFromData,
  contactsByName,
  stats,
};
