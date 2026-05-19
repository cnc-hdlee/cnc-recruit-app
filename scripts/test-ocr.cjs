// OCR 자체 시연 — 더미 이력서 이미지 PDF 생성 후 이메일 추출 검증.
// 10가지 케이스 (해상도/배경/폰트/노이즈) 돌려서 추출 성공률 측정.
//
// 실행: node scripts/test-ocr.cjs

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('node:fs');
const path = require('node:path');

// 시스템 한글 폰트 등록 (있으면)
try { GlobalFonts.registerFromPath?.('C:/Windows/Fonts/malgun.ttf', 'Malgun Gothic'); } catch {}

// PNG에 텍스트 그리기 — 이미지 PDF 시뮬레이션
function createResumeImage(opts) {
  const {
    width = 800,
    height = 1100,
    bgColor = '#ffffff',
    textColor = '#000000',
    fontSize = 18,
    name = '김정환',
    email = 'kimjh@example.com',
    noise = false,
  } = opts;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // 노이즈 (스캔본 시뮬레이션)
  if (noise) {
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  ctx.fillStyle = textColor;
  ctx.font = `bold ${fontSize + 8}px Arial`;
  ctx.fillText('Resume / Curriculum Vitae', 50, 60);

  ctx.font = `${fontSize}px Arial`;
  let y = 120;
  const lines = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: 010-1234-5678`,
    `Address: Seoul, Korea`,
    ``,
    `Career Summary`,
    `2020-2024 ABC Company - Marketing`,
    `2018-2020 XYZ Corp - Sales`,
    ``,
    `Education`,
    `2014-2018 Seoul National University`,
  ];
  for (const line of lines) {
    ctx.fillText(line, 50, y);
    y += fontSize + 8;
  }

  return canvas.toBuffer('image/png');
}

// 이미지를 단일 페이지 PDF로 감싸기 — 최소 PDF 구조
// PNG buffer를 그대로 박은 1페이지 PDF 생성.
function pngToPdfBuffer(pngBuffer, width, height) {
  // PDF는 복잡하므로 PDFKit이나 pdf-lib 같은 라이브러리 필요.
  // 여기선 pdf-lib 미설치라 가정하고, OCR 테스트는 PNG 자체로 진행 (ocrImageBuffer 사용)
  return null;
}

const TEST_CASES = [
  { label: '01. 표준 영문 이메일', name: 'John Smith', email: 'john.smith@gmail.com' },
  { label: '02. 한글 이름 + 영문 이메일', name: '김정환', email: 'kim.jh@naver.com' },
  { label: '03. 작은 폰트', name: 'Park', email: 'park2024@example.com', fontSize: 12 },
  { label: '04. 큰 폰트', name: 'Lee', email: 'lee@yahoo.com', fontSize: 28 },
  { label: '05. 회색 배경 (스캔본 풍)', name: 'Choi', email: 'choi@daum.net', bgColor: '#f0f0f0' },
  { label: '06. 어두운 글씨 + 노이즈', name: '한지수', email: 'hanjisoo@kakao.com', noise: true },
  { label: '07. 숫자 포함 이메일', name: '이영호', email: 'yhlee2026@gmail.com' },
  { label: '08. 점·하이픈 포함', name: '박세영', email: 'park.s-y@company.co.kr' },
  { label: '09. 회사 도메인', name: '최지혜', email: 'choi@somesvc.io' },
  { label: '10. 긴 이메일', name: '윤상민', email: 'sangmin.yoon.dev@longdomain.co.kr' },
];

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

async function main() {
  const ocr = require('../electron/integrations/ocr.cjs');
  const results = [];
  const outDir = path.join(__dirname, '..', '__ocr_test_out');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

  console.log(`=== OCR 자체 시연 ${TEST_CASES.length}회 시작 ===\n`);

  for (const tc of TEST_CASES) {
    const t0 = Date.now();
    const png = createResumeImage(tc);
    fs.writeFileSync(path.join(outDir, `${tc.label.replace(/[^a-zA-Z0-9가-힣_\-.]/g, '_')}.png`), png);

    let extracted = '';
    let err = null;
    try {
      extracted = await ocr.ocrImageBuffer(png);
    } catch (e) {
      err = e.message;
    }
    const elapsed = Date.now() - t0;
    const foundEmails = (extracted.match(EMAIL_RE) || []);
    const correct = foundEmails.some((e) => e.toLowerCase() === tc.email.toLowerCase());
    results.push({
      label: tc.label,
      expected: tc.email,
      found: foundEmails,
      correct,
      err,
      elapsedMs: elapsed,
      textHead: extracted.replace(/\s+/g, ' ').slice(0, 120),
    });
    console.log(
      `${correct ? '✅' : '❌'} ${tc.label}\n` +
      `   기대: ${tc.email}\n` +
      `   추출: ${foundEmails.join(', ') || '(없음)'}\n` +
      `   ${elapsed}ms · 텍스트 앞부분: ${extracted.replace(/\s+/g, ' ').slice(0, 80)}\n`
    );
  }

  await ocr.shutdownWorker();

  const ok = results.filter((r) => r.correct).length;
  console.log(`\n=== 결과: ${ok}/${results.length} 성공 (${Math.round((ok / results.length) * 100)}%) ===`);

  // 실패한 케이스 상세
  const failed = results.filter((r) => !r.correct);
  if (failed.length > 0) {
    console.log(`\n실패 케이스 상세:`);
    for (const f of failed) {
      console.log(`  ${f.label}: 기대=${f.expected}, 추출=${f.found.join(',') || '(없음)'}, err=${f.err || '-'}`);
      console.log(`    텍스트: ${f.textHead}`);
    }
  }

  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('치명적 에러:', e);
  process.exit(2);
});
