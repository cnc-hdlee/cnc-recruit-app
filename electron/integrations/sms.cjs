// 문자(SMS/LMS) 발송 — 두 갈래를 모두 지원한다.
//
// ① phone (무료·기본값) — 형도님 휴대폰으로 보낸다.
//    Windows "휴대폰과 연결"이 sms: 프로토콜 핸들러로 등록돼 있어서,
//    sms:01012345678?body=... 를 열면 번호와 문구가 채워진 채로 대화창이 뜬다.
//    거기서 엔터만 치면 발송. 통신 요금은 본인 요금제 안이라 추가 비용이 없고
//    발신번호 사전등록도 필요 없다(본인 번호로 나가므로).
//    다만 마지막 "보내기"는 사람이 눌러야 한다 — 앱이 남의 폰을 대신 조작할 수는 없다.
//
// ② aligo / solapi (유료) — 문자 사업자 API로 앱이 직접 쏜다. 진짜 원클릭.
//    발신번호 사전등록(전기통신사업법 의무)과 선불 충전이 선행돼야 한다.
//
// 자격증명은 store에 암호화 저장하고, 렌더러로는 절대 그대로 돌려주지 않는다(마스킹).
const crypto = require('node:crypto');
const { shell } = require('electron');
const store = require('./store.cjs');
const gmessages = require('./gmessages.cjs');
const phonelink = require('./phonelink.cjs');

const CFG_KEY = 'smsConfig';

/** 010-1234-5678 → 01012345678 */
function normalize(raw) {
  const d = String(raw || '')
    .replace(/[^0-9+]/g, '')
    .replace(/^\+82/, '0');
  return d.replace(/[^0-9]/g, '');
}

/** EUC-KR 기준 바이트 — 90바이트 이하 SMS, 초과하면 LMS */
function byteLen(text) {
  let n = 0;
  for (const ch of String(text || '')) n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

function getConfig() {
  // 기본값은 phonelink — Windows "휴대폰과 연결"에 번호·문구가 채워진 대화창을 띄운다.
  // 그냥 sms: 를 열면 Windows가 브라우저로 넘겨버려서(형도님 PC에서 실제로 그랬다)
  // WinRT Launcher에 패키지를 못박아 휴대폰과 연결이 반드시 받게 한다.
  const c = store.get(CFG_KEY) || {};
  return { provider: 'phonelink', sender: '', apiKey: '', apiSecret: '', userId: '', autoSend: true, ...c };
}

/** 화면에 돌려줄 안전한 형태 — 키는 뒤 4자리만 남긴다 */
function getConfigMasked() {
  const c = getConfig();
  const mask = (v) => (v ? `••••••${String(v).slice(-4)}` : '');
  return {
    provider: c.provider || 'phonelink',
    autoSend: c.autoSend !== false,
    sender: c.sender || '',
    userId: c.userId || '',
    apiKey: mask(c.apiKey),
    apiSecret: mask(c.apiSecret),
    ready: isReady(c),
  };
}

function isReady(c) {
  const cfg = c || getConfig();
  // 내 폰으로 보내는 경로들은 별도 설정이 없다
  if (cfg.provider === 'phonelink' || cfg.provider === 'phone' || cfg.provider === 'gmessages') return true;
  if (!cfg.sender) return false;
  if (cfg.provider === 'aligo') return !!(cfg.apiKey && cfg.userId);
  if (cfg.provider === 'solapi') return !!(cfg.apiKey && cfg.apiSecret);
  return false;
}

/** 빈 값으로 들어온 항목은 기존 값을 지우지 않는다 (마스킹된 값을 그대로 되돌려보내는 사고 방지) */
function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur };
  if (typeof patch?.autoSend === 'boolean') next.autoSend = patch.autoSend;
  for (const k of ['provider', 'sender', 'apiKey', 'apiSecret', 'userId']) {
    const v = patch?.[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && (v === '' || v.startsWith('••••'))) continue;
    next[k] = k === 'sender' ? normalize(v) : String(v).trim();
  }
  if (patch?.provider) next.provider = patch.provider;
  store.set(CFG_KEY, next, true); // 암호화 저장
  return getConfigMasked();
}

/**
 * ① 휴대폰과 연결 / 기본 문자 앱을 번호·문구가 채워진 상태로 연다.
 * 규격이 앱마다 조금씩 달라 세 가지를 순서대로 시도한다 —
 *   sms:번호?body=  (RFC 5724 표준, 휴대폰과 연결·macOS 메시지)
 *   sms:번호&body=  (일부 구형 핸들러)
 *   sms:번호        (문구 없이 대화창만)
 * 전부 실패하면 무엇이 왜 막혔는지 그대로 올려보낸다(조용히 실패하지 않게).
 */
async function openPhoneCompose(to, text) {
  const num = normalize(to);
  if (!num) throw new Error('휴대폰 번호가 없습니다');
  const body = encodeURIComponent(text || '');
  const tries = [`sms:${num}?body=${body}`, `sms:${num}&body=${body}`, `sms:${num}`];
  const errs = [];
  for (const uri of tries) {
    try {
      await shell.openExternal(uri);
      return { opened: true, to: num, via: 'phone', uri: uri.slice(0, 40) };
    } catch (e) {
      errs.push((e && e.message) || String(e));
    }
  }
  // 문자 앱 자체를 여는 것까지 시도 — 번호는 사람이 붙여넣게 된다
  try {
    await shell.openExternal('ms-phone:');
    return { opened: true, to: num, via: 'phone', partial: true };
  } catch (e) {
    errs.push((e && e.message) || String(e));
  }
  throw new Error(
    'Windows에서 문자 앱을 열지 못했습니다. "휴대폰과 연결"이 설치·로그인돼 있는지 확인해주세요. (' +
      errs.join(' / ').slice(0, 200) +
      ')'
  );
}

/** ② 알리고 — form-urlencoded, 가장 단순한 국내 문자 API */
async function sendAligo(cfg, to, text, title) {
  const body = new URLSearchParams({
    key: cfg.apiKey,
    user_id: cfg.userId,
    sender: cfg.sender,
    receiver: normalize(to),
    msg: text,
    msg_type: byteLen(text) <= 90 ? 'SMS' : 'LMS',
  });
  if (title && byteLen(text) > 90) body.set('title', title.slice(0, 40));
  const r = await fetch('https://apis.aligo.in/send/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  // result_code 1 이상이 성공, 음수는 실패
  if (Number(j.result_code) < 1) throw new Error(j.message || '알리고 발송 실패');
  return { sent: true, to: normalize(to), via: 'aligo', id: String(j.msg_id || ''), count: Number(j.success_cnt || 1) };
}

/** ② 솔라피(구 쿨SMS) — HMAC-SHA256 서명 */
async function sendSolapi(cfg, to, text) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', cfg.apiSecret).update(date + salt).digest('hex');
  const r = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `HMAC-SHA256 apiKey=${cfg.apiKey}, date=${date}, salt=${salt}, signature=${sig}`,
    },
    body: JSON.stringify({
      message: { to: normalize(to), from: cfg.sender, text, type: byteLen(text) <= 90 ? 'SMS' : 'LMS' },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errorCode) throw new Error(j.errorMessage || j.message || '솔라피 발송 실패');
  return { sent: true, to: normalize(to), via: 'solapi', id: String(j.messageId || j.groupId || '') };
}

/**
 * 문자 한 통 발송.
 * provider=phone 이면 실제 발송이 아니라 "문자 앱을 채워서 열기"까지 — 결과의 opened로 구분한다.
 */
async function send({ to, text, title }) {
  if (!normalize(to)) throw new Error('휴대폰 번호가 없습니다');
  if (!String(text || '').trim()) throw new Error('문구가 비어 있습니다');
  const cfg = getConfig();
  const provider = cfg.provider || 'phonelink';
  // 휴대폰과 연결 — 번호·문구가 채워진 대화창을 띄운다 (보내기만 누르면 끝)
  if (provider === 'phonelink') return phonelink.compose(normalize(to), text, { autoSend: cfg.autoSend !== false });
  // 구글 메시지 웹 — 앱 안 창에서 번호·문구를 채우고 보내기까지 누른다
  if (provider === 'gmessages') return gmessages.send({ to: normalize(to), text });
  if (provider === 'phone') return openPhoneCompose(to, text);
  if (!isReady(cfg)) throw new Error('문자 API 설정이 끝나지 않았습니다 (발신번호·키 확인)');
  if (provider === 'aligo') return sendAligo(cfg, to, text, title);
  if (provider === 'solapi') return sendSolapi(cfg, to, text);
  throw new Error(`알 수 없는 발송 방식: ${provider}`);
}

/** 여러 명 순차 발송 — 한 건이 실패해도 나머지는 계속 보낸다 */
async function sendMany(list) {
  const out = [];
  for (const item of list || []) {
    try {
      const r = await send(item);
      out.push({ name: item.name || '', to: item.to, ok: true, ...r });
    } catch (e) {
      out.push({ name: item.name || '', to: item.to, ok: false, error: (e.message || '').slice(0, 200) });
    }
  }
  return { results: out, sent: out.filter((r) => r.ok).length, failed: out.filter((r) => !r.ok).length };
}

/** 남은 충전금 조회 — 유료 API에서만 의미가 있다 */
async function balance() {
  const cfg = getConfig();
  if (cfg.provider === 'phonelink' || cfg.provider === 'phone' || cfg.provider === 'gmessages') {
    return { provider: cfg.provider, note: '내 휴대폰 요금제로 나갑니다 (앱 과금 없음)' };
  }
  if (!isReady(cfg)) throw new Error('문자 API 설정이 끝나지 않았습니다');
  if (cfg.provider === 'aligo') {
    const r = await fetch('https://apis.aligo.in/remain/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: cfg.apiKey, user_id: cfg.userId }),
    });
    const j = await r.json().catch(() => ({}));
    return { provider: 'aligo', sms: Number(j.SMS_CNT || 0), lms: Number(j.LMS_CNT || 0) };
  }
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', cfg.apiSecret).update(date + salt).digest('hex');
  const r = await fetch('https://api.solapi.com/cash/v1/balance', {
    headers: { Authorization: `HMAC-SHA256 apiKey=${cfg.apiKey}, date=${date}, salt=${salt}, signature=${sig}` },
  });
  const j = await r.json().catch(() => ({}));
  return { provider: 'solapi', balance: Number(j.balance || 0), point: Number(j.point || 0) };
}

/** 구글 메시지 웹 연결 상태 / QR 스캔 창 */
async function gmStatus() {
  return gmessages.status();
}
async function gmConnect() {
  return gmessages.connect();
}

/** 휴대폰과 연결 설치 여부 */
async function plStatus() {
  return phonelink.installed();
}

/**
 * 이미 떠 있는 대화창에서 보내기(엔터)만 다시 누른다.
 * 자동 발송이 포커스 싸움에 밀려 실패했을 때, 문구를 다시 만들지 않고 마무리만 하기 위한 것.
 */
async function plPressSend() {
  const r = await phonelink.pressSend();
  if (!r.pressed) throw new Error(r.message || '보내기를 누르지 못했습니다');
  return { sent: true, via: 'phonelink' };
}

module.exports = {
  getConfigMasked, setConfig, send, sendMany, balance, normalize, byteLen,
  gmStatus, gmConnect, plStatus, plPressSend,
};
