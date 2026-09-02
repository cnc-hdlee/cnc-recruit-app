// 구글 메시지 웹을 앱 안에 띄워서 문자를 직접 발송한다.
//
// 왜 이렇게 하나 —
//   sms: 딥링크는 Windows가 브라우저로 넘겨버려서 보내기 버튼이 없는 화면만 뜬다.
//   유료 문자 API는 발신번호 사전등록·계약이 선행돼야 한다.
//   그 사이를 메우는 유일한 방법이 "내 폰에 연결된 구글 메시지 웹"을 앱이 대신 조작하는 것이다.
//   내 계정·내 폰·내 문자라서 추가 비용이 없고, 사람이 손으로 하던 동작을 그대로 대신할 뿐이다.
//
// 로그인(QR 스캔)은 최초 한 번만. 세션은 persist:gmessages 파티션에 남아 재실행해도 유지된다.
const path = require('node:path');
const { BrowserWindow } = require('electron');

const URL = 'https://messages.google.com/web';
const PARTITION = 'persist:gmessages';

let win = null;

function alive() {
  return win && !win.isDestroyed();
}

/** 창을 만들거나 이미 있는 창을 돌려준다. show=false면 화면에 띄우지 않고 뒤에서 준비만 한다. */
function ensureWindow({ show = true } = {}) {
  if (alive()) {
    if (show) {
      win.show();
      win.focus();
    }
    return win;
  }
  win = new BrowserWindow({
    width: 1040,
    height: 780,
    show,
    title: '구글 메시지 — 문자 발송',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      // 구글 메시지는 최신 크롬만 받아준다 — Electron 기본 UA에서 Electron 표식을 뺀다
      backgroundThrottling: false,
    },
  });
  const ua = win.webContents.getUserAgent().replace(/\s*(Electron|cnc-recruit-app)\/[\d.]+/g, '');
  win.webContents.setUserAgent(ua);
  win.on('closed', () => {
    win = null;
  });
  win.loadURL(URL);
  return win;
}

function waitLoad(w, ms = 30000) {
  return new Promise((resolve) => {
    if (!w.webContents.isLoading()) return resolve(true);
    const done = () => resolve(true);
    w.webContents.once('did-finish-load', done);
    setTimeout(done, ms);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 페이지 안에서 실행되는 스크립트.
 * 구글 메시지 웹은 Angular 커스텀 엘리먼트라 선택자가 자주 바뀐다.
 * 그래서 후보를 여러 개 두고, 하나라도 걸리면 진행한다.
 * 실패해도 창은 열어둔 채 어디서 멈췄는지 돌려줘서 사람이 이어서 끝낼 수 있게 한다.
 */
function composeScript(to, text) {
  const payload = JSON.stringify({ to, text });
  return `
(async () => {
  const { to, text } = ${payload};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const deep = (root, sel) => {
    // shadow DOM 안까지 훑는다 (구글 메시지는 커스텀 엘리먼트 트리가 깊다)
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.querySelectorAll) out.push(...node.querySelectorAll(sel));
      const kids = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const k of kids) if (k.shadowRoot) walk(k.shadowRoot);
    };
    walk(root || document);
    return out.filter(el => el.offsetParent !== null || el.getClientRects().length);
  };
  const findOne = (sels) => { for (const s of sels) { const f = deep(document, s); if (f.length) return f[0]; } return null; };
  const waitFor = async (sels, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const el = findOne(sels); if (el) return el; await sleep(200); }
    return null;
  };
  const setValue = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const key = (el, k, code) => el.dispatchEvent(new KeyboardEvent(k, { key: code, code, keyCode: code === 'Enter' ? 13 : 0, which: 13, bubbles: true }));

  // 0) 로그인 확인 — QR 화면이면 여기서 멈춘다
  const qr = findOne(['mw-qr-code', '[data-e2e-qr-code]', 'img[alt*="QR"]']);
  if (qr) return { ok: false, step: 'login', message: 'QR 로그인이 필요합니다' };

  // 1) 새 대화 시작
  const start = await waitFor([
    '[data-e2e-start-chat]',
    'button[aria-label*="Start chat"]',
    'button[aria-label*="새 대화"]',
    'button[aria-label*="채팅 시작"]',
    'mw-fab-link a', 'mw-fab-link button',
  ], 15000);
  if (!start) return { ok: false, step: 'start', message: '새 대화 버튼을 찾지 못했습니다' };
  start.click();
  await sleep(900);

  // 2) 번호 입력
  const rcpt = await waitFor([
    'input[data-e2e-contact-input]',
    'mw-contact-chips-input input',
    'input[aria-label*="recipient" i]',
    'input[aria-label*="받는" ]',
    'input[type="text"]',
  ], 12000);
  if (!rcpt) return { ok: false, step: 'recipient', message: '번호 입력칸을 찾지 못했습니다' };
  rcpt.focus();
  setValue(rcpt, to);
  await sleep(1200);
  key(rcpt, 'keydown', 'Enter'); key(rcpt, 'keyup', 'Enter');
  await sleep(1200);

  // 3) 문구 입력
  const box = await waitFor([
    'textarea[data-e2e-message-input-box]',
    'mws-message-compose textarea',
    'textarea[aria-label*="message" i]',
    'textarea[aria-label*="메시지"]',
    'textarea',
  ], 12000);
  if (!box) return { ok: false, step: 'compose', message: '문구 입력칸을 찾지 못했습니다 (번호가 인식되지 않았을 수 있습니다)' };
  box.focus();
  setValue(box, text);
  await sleep(700);

  // 4) 보내기
  const send = await waitFor([
    'button[data-e2e-send-text-button]',
    'mws-message-send-button button',
    'button[aria-label*="Send" i]',
    'button[aria-label*="보내기"]',
    'button[aria-label*="전송"]',
  ], 8000);
  if (!send) return { ok: false, step: 'send', message: '보내기 버튼을 찾지 못했습니다' };
  if (send.disabled || send.getAttribute('aria-disabled') === 'true') {
    return { ok: false, step: 'send', message: '보내기 버튼이 비활성입니다 (번호가 인식되지 않았을 수 있습니다)' };
  }
  send.click();
  await sleep(1200);
  return { ok: true, step: 'sent' };
})();
`;
}

/** 로그인 상태 확인 — QR 화면이면 아직 연결 전 */
async function status() {
  const w = ensureWindow({ show: false });
  await waitLoad(w);
  await sleep(1500);
  try {
    const r = await w.webContents.executeJavaScript(`
      (() => {
        const has = (s) => !!document.querySelector(s);
        if (has('mw-qr-code') || has('[data-e2e-qr-code]')) return 'qr';
        if (has('mws-conversations-list') || has('mw-main-nav') || has('[data-e2e-conversation-list]')) return 'ready';
        return 'unknown';
      })();
    `);
    return { state: r, url: w.webContents.getURL() };
  } catch (e) {
    return { state: 'error', message: (e.message || '').slice(0, 200) };
  }
}

/** 창을 띄워 QR을 스캔하게 한다 (최초 1회) */
async function connect() {
  const w = ensureWindow({ show: true });
  await waitLoad(w);
  w.show();
  w.focus();
  return { opened: true };
}

/**
 * 문자 한 통 발송.
 * 자동 조작이 어디선가 막히면 창을 띄운 채 어느 단계에서 멈췄는지 돌려준다 —
 * 사람이 이어서 끝낼 수 있게. (조용히 실패하지 않는다)
 */
async function send({ to, text }) {
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) throw new Error('휴대폰 번호가 없습니다');
  if (!String(text || '').trim()) throw new Error('문구가 비어 있습니다');

  const w = ensureWindow({ show: true });
  await waitLoad(w);
  await sleep(800);

  let r;
  try {
    r = await w.webContents.executeJavaScript(composeScript(num, text), true);
  } catch (e) {
    w.show();
    throw new Error('구글 메시지 조작 실패: ' + (e.message || '').slice(0, 160));
  }

  if (r && r.ok) {
    return { sent: true, to: num, via: 'gmessages' };
  }
  w.show();
  w.focus();
  if (r && r.step === 'login') {
    throw new Error('구글 메시지에 아직 폰이 연결되지 않았습니다 — 열린 창에서 QR을 스캔해주세요 (최초 1회).');
  }
  throw new Error(
    (r && r.message ? r.message : '자동 발송이 막혔습니다') +
      ' — 열린 창에서 직접 마무리해주세요. 번호와 문구는 복사돼 있습니다.'
  );
}

function close() {
  if (alive()) win.close();
  win = null;
  return { closed: true };
}

module.exports = { status, connect, send, close };
