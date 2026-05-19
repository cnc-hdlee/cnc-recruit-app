// OCR 모듈 — 이미지 PDF/스캔본에서 텍스트 추출.
// pdf-parse가 텍스트 못 뽑은 경우 fallback으로 사용.
//
// 흐름:
//   PDF buffer
//     → pdfjs-dist 3.x (legacy CJS) 로 페이지 렌더
//     → @napi-rs/canvas로 PNG buffer 생성
//     → Tesseract.js 영어 OCR로 텍스트 추출
//
// 영어 OCR만 사용 — 이메일 주소가 영문 + 숫자 + @ 이라 한국어 데이터 불필요.
// 한국어 데이터를 추가하면 traineddata 두 배, 속도 느려짐, 영문 인식률 떨어짐.

const path = require('node:path');

let _pdfjs = null;
let _NodeCanvasFactory = null;
let _tesseractWorker = null;
let _tesseractInitInFlight = null;

function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

function getNodeCanvasFactory() {
  if (_NodeCanvasFactory) return _NodeCanvasFactory;
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  // 시스템 폰트 등록 (Windows) — 텍스트 PDF 렌더링 시 fallback 사용
  try {
    GlobalFonts.registerFromPath?.('C:/Windows/Fonts/malgun.ttf', 'Malgun Gothic');
  } catch {
    // optional
  }
  _NodeCanvasFactory = class {
    create(width, height) {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    }
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    }
  };
  return _NodeCanvasFactory;
}

// PDF buffer → 페이지별 PNG buffer 배열.
// 이력서 첫 2페이지만 (이메일은 보통 첫 페이지 상단 인적사항에 있음).
// scale=2.0 — OCR 정확도 높이기 위해 2배 확대 렌더.
async function renderPdfPagesToPng(pdfBuffer, opts = {}) {
  const { maxPages = 2, scale = 2.0 } = opts;
  const pdfjs = loadPdfjs();
  const CanvasFactory = getNodeCanvasFactory();
  const factory = new CanvasFactory();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    canvasFactory: factory,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pages = Math.min(doc.numPages, maxPages);
  const images = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const cAndC = factory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: cAndC.context,
      viewport,
      canvasFactory: factory,
    }).promise;
    const png = cAndC.canvas.toBuffer('image/png');
    images.push(png);
    factory.destroy(cAndC);
    page.cleanup();
  }
  await doc.cleanup();
  await doc.destroy();
  return images;
}

// Tesseract worker — 싱글톤. 첫 호출 시 영어 traineddata 자동 다운로드 (CDN, 캐시됨).
async function getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  if (_tesseractInitInFlight) return _tesseractInitInFlight;
  _tesseractInitInFlight = (async () => {
    const Tesseract = require('tesseract.js');
    // logger를 콘솔에 — 진행률 확인용
    const worker = await Tesseract.createWorker('eng', undefined, {
      logger: (m) => {
        if (m.status && m.status !== 'recognizing text') {
          console.log(`[ocr] ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
        }
      },
    });
    _tesseractWorker = worker;
    return worker;
  })();
  return _tesseractInitInFlight;
}

async function ocrImageBuffer(pngBuffer) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(pngBuffer);
  return data.text || '';
}

// 메인 API — PDF buffer 받아 OCR 텍스트 반환.
async function ocrPdfBuffer(pdfBuffer, opts = {}) {
  const t0 = Date.now();
  const images = await renderPdfPagesToPng(pdfBuffer, opts);
  let text = '';
  for (let i = 0; i < images.length; i++) {
    const t1 = Date.now();
    const pageText = await ocrImageBuffer(images[i]);
    console.log(`[ocr] page ${i + 1} done in ${Date.now() - t1}ms, ${pageText.length} chars`);
    text += pageText + '\n';
  }
  console.log(`[ocr] total ${Date.now() - t0}ms, ${images.length} pages, ${text.length} chars`);
  return text;
}

async function shutdownWorker() {
  if (_tesseractWorker) {
    try {
      await _tesseractWorker.terminate();
    } catch {
      // ignore
    }
    _tesseractWorker = null;
    _tesseractInitInFlight = null;
  }
}

module.exports = {
  ocrPdfBuffer,
  ocrImageBuffer,
  renderPdfPagesToPng,
  shutdownWorker,
};
