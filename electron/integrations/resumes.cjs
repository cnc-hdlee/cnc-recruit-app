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
const store = require('./store.cjs');

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

/**
 * 이력서를 함께 보는 TA팀 명단 (이형도 · 김범준 · 임한결).
 * 누가 올리든 "자기를 뺀 나머지 전원"에게 읽기 권한을 준다.
 * 그래야 내가 넣은 것도 팀원이 보고, 팀원이 넣은 것도 내가 본다.
 */
const RESUME_TEAM = [
  'hdlee@cnccosmetic.com',
  'bjkim4@cnccosmetic.com',
  'hglim@cnccosmetic.com',
];

function readTeamShare() {
  const v = store.get('resumeTeamShare');
  const team = Array.isArray(v) && v.length ? v : RESUME_TEAM;
  const me = ((store.get('googleProfile') || {}).email || '').toLowerCase();
  return team.filter((e) => String(e).toLowerCase() !== me);
}

// 팀이 아직 확인 안 된 이력서가 들어가는 폴더 — "미분류"가 아니라 처리해야 할 할 일 목록이다.
const PENDING_FOLDER = '_확인필요';

function teamFolder(entry) {
  const t = (entry.team || '').trim();
  return t ? safeName(t) : PENDING_FOLDER;
}

// 파일명 규칙: "○○팀_지원자이름.pdf" (2026-09-01 사용자 지정 — 폴더에서 한눈에 보이게 통일)
// 같은 팀에 같은 이름이 여러 건이면 uniqueIn()이 " (2)"를 붙인다.
function canonicalName(entry) {
  const ext = path.extname(entry.storedName || entry.filename || '') || '.bin';
  const name = (entry.candidate || '').trim();
  // 이름을 못 읽었으면 원본 파일명을 그대로 쓴다 (엉뚱한 이름을 지어내지 않는다)
  if (!name) return safeName(entry.filename);
  const team = (entry.team || '').trim();
  return `${safeName(team ? `${team}_${name}` : name)}${ext.toLowerCase()}`;
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

  // 같은 내용의 파일이 이미 있으면 새로 만들지 않고 기존 항목을 돌려준다.
  // 단, 등록은 돼 있는데 파일이 사라졌으면 원본을 다시 써넣어 되살린다(분류·연락처는 그대로 유지).
  const dup = list.find((r) => r.hash === hash);
  if (dup) {
    const dupAbs = dup.storedName ? path.join(filesDir(), dup.storedName) : '';
    if (!dupAbs || !fs.existsSync(dupAbs)) {
      const folderR = teamFolder(dup);
      const dirR = path.join(filesDir(), folderR);
      fs.mkdirSync(dirR, { recursive: true });
      const nameR = uniqueIn(
        dirR,
        canonicalName({ ...dup, storedName: dup.storedName || filename }),
        ''
      );
      fs.writeFileSync(path.join(dirR, nameR), buf);
      dup.storedName = path.posix.join(folderR, nameR);
      writeIndex(list);
      return { entry: dup, duplicate: true, restored: true };
    }
    return { entry: dup, duplicate: true };
  }
  // 사용자가 지웠던 파일은 다시 넣지 않는다 (스캔을 다시 돌려도 되살아나지 않게)
  if (readIgnored().has(hash)) return { entry: null, duplicate: true, ignored: true };

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

// 삭제한 이력서의 내용 해시 목록.
// 이게 없으면 "내 PC 이력서 찾기"를 다시 돌릴 때 지웠던 파일이 그대로 되살아난다.
function ignorePath() {
  return path.join(rootDir(), 'ignored.json');
}
function readIgnored() {
  try {
    const v = JSON.parse(fs.readFileSync(ignorePath(), 'utf8'));
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch {
    return new Set();
  }
}
function writeIgnored(set) {
  ensureDirs();
  fs.writeFileSync(ignorePath(), JSON.stringify([...set], null, 2), 'utf8');
}

/** 여러 건 한 번에 삭제. ignore=true면 같은 파일이 다시 편입되지 않게 제외 목록에 넣는다. */
async function deleteResumes(ids, { ignore = true } = {}) {
  const list = readIndex();
  const targets = list.filter((r) => ids.includes(r.id));
  if (!targets.length) return { deleted: 0, ignored: 0 };
  // 지우기 전에 인덱스 백업 (되돌릴 근거는 남긴다)
  try {
    fs.copyFileSync(indexPath(), path.join(rootDir(), `index.backup-${Date.now()}.json`));
  } catch {
    /* 백업 실패해도 삭제는 진행 */
  }
  const ignored = readIgnored();
  let driveFailed = 0;
  for (const r of targets) {
    try {
      fs.unlinkSync(path.join(filesDir(), r.storedName));
    } catch {
      /* 파일이 이미 없어도 인덱스는 정리 */
    }
    if (r.driveFileId) {
      try {
        await gapi().deleteDriveFile(r.driveFileId);
      } catch {
        driveFailed += 1;
      }
    }
    if (ignore && r.hash) ignored.add(r.hash);
  }
  writeIndex(list.filter((r) => !ids.includes(r.id)));
  if (ignore) writeIgnored(ignored);
  // 빈 팀 폴더 정리
  try {
    for (const d of fs.readdirSync(filesDir(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(filesDir(), d.name);
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    }
  } catch {
    /* noop */
  }
  return { deleted: targets.length, ignored: ignore ? targets.length : 0, driveFailed };
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

// ── 내 PC에서 이력서 찾기 ───────────────────────────────────────────────────
// 메일 보낼 때 주소가 비어 있는 지원자를 없애려면 이력서가 보관함에 있어야 한다.
// 바탕화면·다운로드·문서·OneDrive를 훑어 이력서로 보이는 파일을 모아온다(읽기만 한다).
const SCAN_EXT = /\.(pdf|docx?|hwpx?|zip)$/i;
const RESUME_NAME_RE =
  /(이력서|경력기술서|자기소개서|자소서|입사지원|지원자|지원정보|잡코리아지원|잡코지원|사람인|그리팅지원|포트폴리오|resume|curriculum ?vitae|(^|[^a-z])cv([^a-z]|$))/i;
// 이력서가 아닌 게 확실한 것들 — 사내 문서·양식이 딸려오지 않게
const SCAN_EXCLUDE_FILE = /(사전질문|평가표|면접표|안내문|양식|가이드|매뉴얼|공고|템플릿|기안|품의)/i;
const SCAN_SKIP_DIR =
  /(^|[\\/])(node_modules|\.git|AppData|Windows|Program Files|Program Files \(x86\)|\$Recycle\.Bin|OneDriveTemp|Temp|\.cache|dist|build|out)([\\/]|$)/i;

// 입사확정자가 낸 제출서류 — 이력서가 아니므로 보관함에 넣지 않는다
const NOT_RESUME_DOC =
  /(주민등록|등본|초본|통장|계좌|증명사진|성적증명|졸업증명|수료증명|재직증명|경력증명서|건강검진|채용검진|신체검사|검진|영수증|자격득실|건강보험|병적|급여명세|버스노선|명함)/;

// ── ZIP 안의 이력서 읽기 ────────────────────────────────────────────────────
// 현업/채용사이트가 여러 명 이력서를 zip으로 묶어 보내는 경우가 많다.
// 중앙 디렉터리만 읽어 목록을 만들고, 필요한 항목만 풀어서 편입한다(원본 zip은 그대로 둔다).
function zipEntries(filePath) {
  return zipEntriesFromBuffer(fs.readFileSync(filePath));
}

function zipEntriesFromBuffer(buf) {
  // End of Central Directory 찾기 (뒤에서부터)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && off + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const rawName = buf.subarray(off + 46, off + 46 + nameLen);
    // 비트 11 = UTF-8 파일명. 아니면 한국어 zip은 대개 CP949(EUC-KR)다.
    // (예전엔 latin1로 읽어 "±èÀç¿µ"처럼 깨져서 지원자 이름을 못 뽑았다)
    let name = rawName.toString('utf8');
    if (!(flags & 0x800) || name.includes('�')) {
      try {
        name = new TextDecoder('euc-kr').decode(rawName);
      } catch {
        name = rawName.toString('latin1');
      }
    }
    out.push({
      name,
      method,
      crc,
      compSize,
      localOff,
      dir: name.endsWith('/'),
      // 비트 0 = 비밀번호 암호화. 채용사이트가 내려주는 zip이 대체로 여기 해당한다.
      encrypted: !!(flags & 0x1),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out.map((e) => ({ ...e, buf }));
}

// ZipCrypto(전통 PKWARE 암호) 해제 — 채용사이트가 내려주는 비밀번호 zip이 이 방식이다.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crcByte = (crc, b) => (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;

/**
 * @param {Buffer} data 암호화된 원본(앞 12바이트는 암호 헤더)
 * @param {string} password
 * @param {number|null} checkByte 헤더 마지막 바이트와 비교할 값 (비밀번호 검증용)
 * @returns {Buffer|null} 비밀번호가 틀리면 null
 */
function zipDecrypt(data, password, checkByte) {
  let k0 = 305419896;
  let k1 = 591751049;
  let k2 = 878082192;
  const upd = (b) => {
    k0 = crcByte(k0, b);
    k1 = (k1 + (k0 & 0xff)) >>> 0;
    k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
    k2 = crcByte(k2, (k1 >>> 24) & 0xff);
  };
  for (const ch of Buffer.from(password, 'latin1')) upd(ch);
  const nextByte = () => {
    const t = (k2 | 2) & 0xffff;
    return ((t * (t ^ 1)) >>> 8) & 0xff;
  };
  const hdr = Buffer.alloc(12);
  for (let i = 0; i < 12; i += 1) {
    const c = data[i] ^ nextByte();
    upd(c);
    hdr[i] = c;
  }
  if (checkByte != null && hdr[11] !== checkByte) return null; // 비밀번호 불일치
  const out = Buffer.alloc(Math.max(0, data.length - 12));
  for (let i = 12; i < data.length; i += 1) {
    const c = data[i] ^ nextByte();
    upd(c);
    out[i - 12] = c;
  }
  return out;
}

function zipRead(entry, password) {
  const { buf, localOff, method, compSize, encrypted } = entry;
  if (buf.readUInt32LE(localOff) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(localOff + 26);
  const extraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + nameLen + extraLen;
  let data = buf.subarray(start, start + compSize);
  if (encrypted) {
    if (!password) return null;
    // 데이터 디스크립터(bit 3)를 쓰면 CRC 대신 수정시각 상위 바이트로 비밀번호를 검증한다
    const flags = buf.readUInt16LE(localOff + 6);
    const check =
      flags & 0x8 ? (buf.readUInt16LE(localOff + 10) >> 8) & 0xff : (entry.crc >>> 24) & 0xff;
    const dec = zipDecrypt(data, password, check);
    if (!dec) return null;
    data = dec;
  }
  if (method === 0) return Buffer.from(data);
  if (method === 8) {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
}

/** zip 안에서 "이력서로 보이는" 항목만 고른다 */
function resumeEntriesInZip(filePath) {
  const zipName = path.basename(filePath);
  const zipLooksResume = RESUME_NAME_RE.test(zipName) && !NOT_RESUME_DOC.test(zipName);
  let entries;
  try {
    entries = zipEntries(filePath);
  } catch {
    return [];
  }
  return entries.filter((e) => {
    if (e.dir) return false;
    const base = e.name.split('/').pop() || e.name;
    if (!/\.(pdf|docx?|hwpx?)$/i.test(base)) return false;
    if (NOT_RESUME_DOC.test(base) || SCAN_EXCLUDE_FILE.test(base)) return false;
    return zipLooksResume || RESUME_NAME_RE.test(base);
  });
}

function defaultScanRoots() {
  const home = app.getPath('home');
  const cands = [
    app.getPath('desktop'),
    app.getPath('downloads'),
    app.getPath('documents'),
    path.join(home, 'OneDrive'),
    path.join(home, 'OneDrive - CNC'),
  ];
  return [...new Set(cands.filter((p) => p && fs.existsSync(p)))];
}

/**
 * 이력서로 보이는 파일 목록을 돌려준다 (파일을 옮기거나 고치지 않는다).
 * @param {{roots?:string[], names?:string[], maxDepth?:number, limit?:number}} opt
 *   names: 후보자 이름 목록 — 파일명에 이름이 들어 있으면 "이력서" 단어가 없어도 잡는다.
 */
function scanForResumes(opt = {}) {
  const roots = (opt.roots && opt.roots.length ? opt.roots : defaultScanRoots()).filter((p) =>
    fs.existsSync(p)
  );
  const names = (opt.names || []).filter((n) => n && n.length >= 2);
  const maxDepth = opt.maxDepth ?? 6;
  const limit = opt.limit ?? 4000;
  const vault = filesDir().toLowerCase();
  const out = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > maxDepth) return;
    if (SCAN_SKIP_DIR.test(dir) || dir.toLowerCase().startsWith(vault)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 없는 폴더는 조용히 건너뛴다
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SCAN_SKIP_DIR.test(e.name)) continue;
        walk(p, depth + 1);
        continue;
      }
      if (!SCAN_EXT.test(e.name)) continue;
      if (SCAN_EXCLUDE_FILE.test(e.name)) continue;
      const isZip = /\.zip$/i.test(e.name);
      let zipCount = 0;
      let zipLocked = false;
      if (isZip) {
        // zip은 안을 들여다보고 이력서가 들어 있을 때만 목록에 올린다 (입사서류 zip 제외)
        try {
          const zes = resumeEntriesInZip(p);
          zipCount = zes.length;
          zipLocked = zes.some((z) => z.encrypted);
        } catch {
          zipCount = 0;
        }
        if (!zipCount) continue;
      } else {
        if (NOT_RESUME_DOC.test(e.name)) continue;
        const byKeyword = RESUME_NAME_RE.test(e.name);
        const byName = names.some((n) => e.name.includes(n));
        if (!byKeyword && !byName) continue;
      }
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.size || st.size > 40 * 1024 * 1024) continue;
      out.push({
        path: p,
        filename: e.name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        matchedBy: isZip ? 'zip' : 'file',
        zipCount,
        encrypted: zipLocked,
      });
    }
  };
  for (const r of roots) walk(r, 0);
  return { roots, files: out };
}

/**
 * 스캔으로 찾은 파일을 보관함에 넣는다 (내용 해시가 같으면 건너뜀 — 원본 파일은 그대로 둔다).
 * zip이면 안의 이력서 항목만 각각 별도 이력서로 편입한다.
 */
function importPath(filePath, meta, password) {
  if (!fs.existsSync(filePath)) throw new Error('파일이 없습니다');
  if (/\.zip$/i.test(filePath)) {
    const entries = resumeEntriesInZip(filePath);
    const results = [];
    for (const e of entries) {
      const data = zipRead(e, password);
      if (!data || !data.length) continue;
      const base = (e.name.split('/').pop() || e.name).trim();
      try {
        results.push(
          saveResume({
            filename: base,
            base64: data.toString('base64'),
            // 팀/직무는 zip 파일명에서 넘어온 값을 기본값으로 쓰되, 이름은 항목마다 다르므로 비워 둔다
            meta: { ...(meta || {}), candidate: '', source: 'zip' },
          })
        );
      } catch {
        // 개별 항목 실패는 건너뛴다
      }
    }
    return {
      zip: true,
      count: results.length,
      added: results.filter((r) => !r.duplicate).length,
      duplicate: results.length > 0 && results.every((r) => r.duplicate),
      entries: results.map((r) => r.entry),
    };
  }
  const base64 = fs.readFileSync(filePath).toString('base64');
  return saveResume({
    filename: path.basename(filePath),
    base64,
    meta: { ...(meta || {}), source: 'scan' },
  });
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

// 이력서 본문에서 이름 뽑기 — 파일명이 깨졌거나(암호 zip은 파일명이 CP949라 깨진다)
// 이름이 안 들어간 파일에 쓴다. "성 명  황 상 현" 처럼 글자 사이에 공백이 끼는 경우가 흔하다.
const NAME_LABEL_RE =
  /(?:성\s*명|이\s*름|지원자\s*명|성명\/생년월일)\s*[:：]?\s*((?:[가-힣]\s*){2,5})/;
const NOT_PERSON = /(주민|등록|번호|사항|기본|지원|경력|학력|자격|사진|정보|담당|부서|회사)/;

function nameFromResumeText(text) {
  if (!text) return '';
  const m = text.match(NAME_LABEL_RE);
  if (m) {
    const n = m[1].replace(/\s+/g, '');
    if (n.length >= 2 && n.length <= 4 && !NOT_PERSON.test(n)) return n;
  }
  return '';
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
  // 파일명으로 이름을 못 읽은 항목은 본문에서 이름을 찾아 채운다
  let nameFilled = '';
  if (!(r.candidate || '').trim()) {
    nameFilled = nameFromResumeText(parsed.layer.join('\n'));
    if (nameFilled) {
      r.candidate = nameFilled;
      r.matchedBy = '이력서 본문';
    }
  }
  // 인덱스에 캐시 — 같은 이력서를 다시 파싱하지 않게 (메일 화면에서 즉시 뜬다)
  if (out.email !== r.contactEmail || out.phone !== r.contactPhone || nameFilled) {
    r.contactEmail = out.email;
    r.contactPhone = out.phone;
    r.contactAt = new Date().toISOString();
    writeIndex(list);
  }
  out.candidate = r.candidate;
  return out;
}

/**
 * 파일을 저장하지 않고 버퍼에서만 연락처를 뽑는다.
 * 보관함에 없는 지원자(현업이 메일로 보낸 이력서 등)의 주소를 채울 때 쓴다 — 보관함은 건드리지 않는다.
 */
/**
 * .docx 본문 텍스트 — docx는 zip이고 본문이 word/document.xml에 들어 있다.
 * 현업이 보내는 이력서에 docx가 섞여 있어(윤수민 건) PDF만 읽으면 연락처를 놓친다.
 */
function docxText(buf) {
  try {
    const entries = zipEntriesFromBuffer(buf);
    const doc = entries.find((e) => e.name === 'word/document.xml');
    if (!doc) return '';
    const xml = zipRead(doc)?.toString('utf8') || '';
    return xml
      .replace(/<w:p[ >][^]*?<\/w:p>|<w:p\/>/g, (m) => m + '\n') // 문단 구분 유지
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t]+/g, ' ');
  } catch {
    return '';
  }
}

async function extractContactsFromData(base64, mimeType) {
  const buf = Buffer.from(base64 || '', 'base64');
  if (!buf.length) return { email: '', emails: [], phone: '', phones: [] };
  const isPdf = (mimeType || '').includes('pdf') || buf.subarray(0, 4).toString() === '%PDF';
  const isDocx =
    /officedocument\.wordprocessingml/.test(mimeType || '') ||
    (buf[0] === 0x50 && buf[1] === 0x4b && !isPdf);
  const text = isPdf ? await pdfText(buf) : isDocx ? docxText(buf) : buf.toString('utf8');
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
/**
 * 보관함 전체의 연락처를 한 번에 돌려준다 — {이름: {email, phone}}.
 * 후보자 40명을 한 명씩 조회하면 왕복이 40번이라 화면이 느렸다.
 * 이건 로컬 인덱스만 읽으므로 즉시 끝난다. 못 찾은 사람만 메일·드라이브를 뒤진다.
 */
function contactsAll() {
  const out = {};
  for (const r of readIndex()) {
    const n = (r.candidate || '').trim();
    if (!n) continue;
    const cur = out[n] || (out[n] = { email: '', phone: '' });
    if (r.contactEmail && !cur.email) cur.email = r.contactEmail;
    if (r.contactPhone && !cur.phone) cur.phone = r.contactPhone;
    // 공백 있는 이름도 찾히게 별칭 하나 더
    const k = n.replace(/s+/g, '');
    if (k !== n && !out[k]) out[k] = cur;
  }
  return out;
}

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
  const out = { duplicatesRemoved: 0, recovered: 0, relinked: 0 };
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
      const owner = byHash.get(hash);
      if (owner) {
        // 같은 내용이 이미 등록돼 있다.
        // ※ 등록된 쪽 파일이 실제로 있을 때만 중복본으로 보고 지운다.
        //   (인덱스가 옛 이름을 가리키는 상태에서 지워버려 이력서 274건이 통째로 날아간 사고가 있었다.
        //    2026-09-02) 등록된 파일이 없으면 지우지 말고 이 파일로 다시 연결한다.
        const ownerAbs = path.join(filesDir(), owner.storedName || '');
        if (owner.storedName && fs.existsSync(ownerAbs)) {
          fs.unlinkSync(abs);
          out.duplicatesRemoved += 1;
        } else {
          owner.storedName = relPath;
          known.add(relPath);
          out.relinked += 1;
        }
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
  if (out.duplicatesRemoved || out.recovered || out.relinked) writeIndex(list);
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

/**
 * 팀 공유 누락 점검 — 이력서 표식이 붙은 내 드라이브 파일 전부에 팀 권한을 보장한다.
 * 업로드 때 공유가 실패했거나, 팀 명단이 바뀐 경우를 자동으로 메운다.
 */
async function syncTeamShare() {
  const team = readTeamShare();
  if (!team.length) return { checked: 0, fixed: 0, tagged: 0, team };

  // ① 내 보관함 목록에 있는 드라이브 파일 — 옛 버전으로 올려 표식이 없는 것까지 확실히 처리한다.
  //    (표식 검색만 쓰면 구버전 업로드분이 통째로 누락된다 — 2026-09-02)
  const list = readIndex();
  let checked = 0;
  let fixed = 0;
  let tagged = 0;
  for (const r of list) {
    if (!r.driveFileId) continue;
    checked += 1;
    try {
      const res = await gapi().ensureFileShared(r.driveFileId, team);
      if (res.added.length) {
        fixed += 1;
        r.sharedWith = team;
      }
    } catch {
      continue; // 다음 점검에서 재시도
    }
    // 팀원이 검색으로 찾을 수 있도록 표식도 함께 붙인다
    if (!r.driveTagged) {
      try {
        await gapi().tagResumeFile(r.driveFileId, { team: r.team || '', candidate: r.candidate || '' });
        r.driveTagged = true;
        tagged += 1;
      } catch {
        /* 다음에 다시 */
      }
    }
  }
  writeIndex(list);

  // ② 표식이 붙은 내 파일 전체 — 목록에 없는 것까지 훑는다
  try {
    const res = await gapi().ensureAllShared(team);
    checked += res.checked;
    fixed += res.fixed;
  } catch {
    /* 검색 실패는 무시 — ①로 대부분 커버된다 */
  }
  return { checked, fixed, tagged, team };
}

// ── 드라이브 백업 ───────────────────────────────────────────────────────────
// drive.file 스코프 = 앱이 만든 파일만 접근. 기존 드라이브 문서는 건드릴 수 없다.
/**
 * 면접 일정에 후보자 이력서를 자동으로 첨부한다.
 *
 * 흐름: 이름으로 보관함 조회 → (드라이브에 없으면) 업로드 → 면접관들에게 읽기 공유 → 일정에 첨부.
 * 공유를 먼저 하는 이유는, 첨부는 링크일 뿐이라 권한이 없으면 면접관 화면에서 안 열리기 때문이다.
 * 이력서가 없으면 조용히 넘어간다 — 예약 자체를 실패시키지 않는다.
 */
async function attachToEvent({ calendarId, eventId, candidate, shareWith }) {
  const key = String(candidate || '').replace(/\s+/g, '');
  if (!key || !eventId) return { attached: false, reason: '이름 또는 일정이 없습니다' };

  const list = readIndex();
  const hit = list
    .filter((r) => (r.candidate || '').replace(/\s+/g, '') === key)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))[0];
  if (!hit) return { attached: false, reason: '보관함에 이력서가 없습니다' };

  // 아직 드라이브에 없으면 지금 올린다
  if (!hit.driveFileId) {
    const abs = path.join(filesDir(), hit.storedName);
    if (!fs.existsSync(abs)) return { attached: false, reason: '이력서 파일을 찾을 수 없습니다' };
    const res = await gapi().uploadResumeFile({
      name: path.basename(hit.storedName),
      mimeType: hit.mimeType,
      filePath: abs,
      team: hit.team?.trim() || PENDING_FOLDER,
      shareWith: readTeamShare(),
      candidate: hit.candidate,
    });
    hit.driveFileId = res.id;
    hit.driveLink = res.webViewLink || null;
    hit.driveError = null;
    writeIndex(list);
  }

  // 면접관에게 읽기 권한 — 회의실 같은 리소스 계정과 내 주소는 뺀다
  const me = (store.get('googleProfile') || {}).email || '';
  const people = (shareWith || [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e && !/@resource\.calendar\.google\.com$/i.test(e) && e !== me.toLowerCase());
  let shared = [];
  if (people.length) {
    try {
      const r = await gapi().ensureFileShared(hit.driveFileId, people);
      shared = r.added || [];
    } catch {
      /* 공유가 막혀도 첨부는 붙인다 — 최소한 나와 TA팀은 볼 수 있다 */
    }
  }

  const title = path.basename(hit.storedName);
  const res = await gapi().addEventAttachment(
    calendarId || 'primary',
    eventId,
    {
      fileId: hit.driveFileId,
      title,
      mimeType: hit.mimeType || 'application/pdf',
      fileUrl: hit.driveLink || `https://drive.google.com/file/d/${hit.driveFileId}/view`,
    },
    hit.candidate // 같은 사람 이력서가 이미 붙어 있으면 중복으로 붙이지 않는다
  );
  return { attached: true, already: !!res.already, dedupedByName: !!res.dedupedByName, title, candidate: hit.candidate, shared };
}

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
        // 새로 올리는 이력서도 팀원이 바로 볼 수 있게 파일 단위로 공유한다
        // (폴더 통째 공유는 drive.file 권한 범위에서 막힌다)
        shareWith: readTeamShare(),
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

/**
 * 팀원이 올린 이력서를 내 보관함으로 가져온다.
 *
 * 팀원이 드래그앤드랍하면 파일은 그 사람 드라이브에 저장되고 나에게 읽기 공유만 된다.
 * 그러면 내 화면의 팀→직무 트리에는 안 나온다 — 형도님이 "팀원이 아카이빙해도 내 화면엔 안 잡힌다"고
 * 한 게 이것이다. 공유된 파일을 실제로 내려받아 내 보관함에 넣어야 한 목록에서 보인다.
 *
 * 이미 가져온 것은 driveFileId와 내용 해시로 걸러 다시 받지 않는다.
 */
async function pullTeamResumes(limit = 60) {
  const meEmail = ((store.get('googleProfile') || {}).email || '').toLowerCase();
  let listed;
  try {
    listed = await gapi().listDriveVault();
  } catch (e) {
    return { pulled: 0, skipped: 0, failed: 0, error: (e.message || '').slice(0, 200) };
  }
  const files = (listed && listed.files) || [];

  const list = readIndex();
  const haveDrive = new Set(list.map((r) => r.driveFileId).filter(Boolean));
  const haveName = new Set(list.map((r) => (r.filename || '').replace(/\s+/g, '')));

  // 남이 올린 것만, 아직 안 가져온 것만
  const targets = files.filter((f) => {
    const owner = String(f.ownerEmail || '').toLowerCase();
    if (!owner || owner === meEmail) return false;
    if (haveDrive.has(f.driveFileId)) return false;
    if (haveName.has((f.filename || '').replace(/\s+/g, ''))) return false;
    return true;
  });

  let pulled = 0;
  let skipped = 0;
  let failed = 0;
  for (const f of targets.slice(0, limit)) {
    try {
      const got = await gapi().downloadDriveFile(f.driveFileId);
      // 표식에 이름이 없으면 파일명에서 뽑는다 — 우리 규칙이 '팀_이름.pdf' 라 마지막 토막이 이름이다
      const fromName = () => {
        const base = String(f.filename || '').replace(/.[^.]+$/, '');
        const last = base.split(/[_-—–]/).pop() || '';
        const m = last.match(/[가-힣]{2,4}/);
        return m ? m[0] : '';
      };
      const res = saveResume({
        filename: f.filename,
        base64: got.base64,
        meta: {
          candidate: f.candidate || fromName(),
          team: f.team || '',
          source: 'team',
          note: f.owner ? `${f.owner} 님이 올림` : '팀 공유',
        },
      });
      if (res.duplicate) {
        skipped += 1;
        continue;
      }
      // 원본 드라이브 파일을 그대로 가리키게 한다 — 같은 파일을 또 올리지 않게
      const cur = readIndex();
      const i = cur.findIndex((r) => r.id === res.entry.id);
      if (i >= 0) {
        cur[i].driveFileId = f.driveFileId;
        cur[i].driveTeam = f.team || '';
        cur[i].sharedFrom = f.ownerEmail || '';
        writeIndex(cur);
      }
      pulled += 1;
    } catch {
      failed += 1;
    }
  }
  return { pulled, skipped, failed, candidates: targets.length };
}

/**
 * 이름으로 보관함 이력서를 찾아 처우산정표용 인적사항을 뽑는다.
 * 출생연도·성별·학교·전공·학위·총경력·경력 3줄까지. 못 읽으면 null.
 */
async function profileByName(name) {
  const key = String(name || '').replace(/s+/g, '');
  if (!key) return null;
  const hit = readIndex()
    .filter((r) => (r.candidate || '').replace(/s+/g, '') === key)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))[0];
  if (!hit) return null;
  const abs = path.join(filesDir(), hit.storedName);
  if (!fs.existsSync(abs)) return null;
  const buf = fs.readFileSync(abs);
  const isPdf = (hit.mimeType || '').includes('pdf') || buf.subarray(0, 4).toString() === '%PDF';
  const isDocx =
    /officedocument.wordprocessingml/.test(hit.mimeType || '') || (buf[0] === 0x50 && buf[1] === 0x4b && !isPdf);
  let text = '';
  try {
    text = isPdf ? await pdfText(buf) : isDocx ? docxText(buf) : buf.toString('utf8');
  } catch {
    return null;
  }
  const p = require('./resumeProfile.cjs').profileFromText(text, hit.candidate || name);
  return {
    ...p,
    candidate: hit.candidate,
    team: hit.team,
    job: hit.job,
    email: hit.contactEmail || '',
    phone: hit.contactPhone || '',
    filename: hit.filename,
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
  deleteResumes,
  backupToDrive,
  applyClassification,
  organizeVault,
  scanForResumes,
  importPath,
  extractContacts,
  extractContactsFromData,
  contactsByName,
  contactsAll,
  attachToEvent,
  pullTeamResumes,
  profileByName,
  stats,
};
