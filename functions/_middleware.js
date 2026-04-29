// CNC 채용 커맨드센터 — 뷰어 비밀번호 게이트
// Cloudflare Pages Function (middleware): 모든 요청을 가로채서 인증 확인.
//
// 비밀번호 변경 시 PASSWORD 상수만 바꾸고 push → 자동 재배포.
// 쿠키 토큰은 매 비밀번호 변경마다 새로 생성됨 (이전 쿠키 자동 무효).

const PASSWORD = 'cnc@1600';

// 토큰 = SHA1(PASSWORD + 고정salt). 비번 바꾸면 토큰도 바뀌어서 기존 쿠키 무효화됨.
async function expectedToken() {
  const data = new TextEncoder().encode(PASSWORD + '::cnc-recruit-2026');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

const COOKIE_NAME = 'cnc-auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function loginPage(error) {
  const errHtml = error ? `<p class="err">${error}</p>` : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CNC 채용 커맨드센터 — 로그인</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;height:100%;font-family:'Pretendard',-apple-system,system-ui,sans-serif}
    body{
      display:flex;align-items:center;justify-content:center;
      background:
        radial-gradient(900px 600px at 80% -10%, rgba(94,142,255,.12), transparent 60%),
        radial-gradient(700px 500px at -10% 110%, rgba(139,109,255,.10), transparent 60%),
        #0b0d12;
      color:#e2e8f0;padding:24px;
    }
    .card{
      width:100%;max-width:420px;
      background:rgba(20,23,32,.75);backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.06);
      border-radius:18px;padding:40px 32px;
      box-shadow:0 20px 60px rgba(0,0,0,.4);
    }
    h1{margin:0 0 6px;font-size:20px;letter-spacing:-.02em;font-weight:700}
    .sub{margin:0 0 28px;color:#94a3b8;font-size:13.5px}
    label{display:block;font-size:12px;color:#94a3b8;margin:0 0 8px;letter-spacing:.02em}
    input{
      width:100%;padding:13px 14px;font-size:15px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.08);border-radius:10px;
      color:#e2e8f0;outline:none;transition:border-color .15s;
    }
    input:focus{border-color:#5e8eff}
    button{
      width:100%;margin-top:18px;padding:13px;font-size:15px;font-weight:600;
      border:0;border-radius:10px;cursor:pointer;color:#fff;
      background:linear-gradient(135deg,#8b6dff,#5e8eff);
      transition:transform .1s, box-shadow .15s;
    }
    button:hover{box-shadow:0 8px 24px rgba(94,142,255,.35)}
    button:active{transform:translateY(1px)}
    .err{margin:14px 0 0;color:#fca5a5;font-size:13px;text-align:center}
    .foot{margin-top:24px;text-align:center;color:#64748b;font-size:11.5px}
  </style>
</head>
<body>
  <form class="card" method="POST" action="/__auth">
    <h1>CNC 채용 커맨드센터</h1>
    <p class="sub">팀 전용 뷰어 — 비밀번호를 입력해주세요.</p>
    <label for="p">비밀번호</label>
    <input id="p" name="password" type="password" autofocus autocomplete="current-password" required>
    <button type="submit">로그인</button>
    ${errHtml}
    <p class="foot">Talent Acquisition Team</p>
  </form>
</body>
</html>`;
}

async function isAuthorized(req) {
  const cookie = getCookie(req, COOKIE_NAME);
  if (!cookie) return false;
  return cookie === (await expectedToken());
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 로그인 POST
  if (url.pathname === '/__auth' && request.method === 'POST') {
    const form = await request.formData();
    const pw = String(form.get('password') || '');
    if (pw === PASSWORD) {
      const token = await expectedToken();
      return new Response(null, {
        status: 303,
        headers: {
          'Location': '/',
          'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return new Response(loginPage('비밀번호가 올바르지 않습니다.'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // 로그아웃
  if (url.pathname === '/__logout') {
    return new Response(null, {
      status: 303,
      headers: {
        'Location': '/',
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // 그 외 모든 요청 — 쿠키 검사
  if (await isAuthorized(request)) {
    return next();
  }

  return new Response(loginPage(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
