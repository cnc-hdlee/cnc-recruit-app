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
  const stored = `${id}${ext.toLowerCase()}`;
  fs.writeFileSync(path.join(filesDir(), stored), buf);

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
        name: r.candidate ? `${r.candidate}__${r.filename}` : r.filename,
        mimeType: r.mimeType,
        filePath: p,
      });
      r.driveFileId = res.id;
      r.driveLink = res.webViewLink || null;
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
  stats,
};
