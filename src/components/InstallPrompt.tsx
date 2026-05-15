import { useEffect, useState } from 'react';
import { IS_VIEWER } from '../lib/mode';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'cnc_install_dismissed_v2';
const SHOW_AFTER_DISMISS_DAYS = 14;
const DISMISS_TTL_MS = SHOW_AFTER_DISMISS_DAYS * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if ((window.navigator as any).standalone) return true;
  return false;
}
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}
function isMobile(): boolean {
  return isIOS() || isAndroid();
}
function recentlyDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const t = Number(v);
    return Number.isFinite(t) && Date.now() - t < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!IS_VIEWER) return;
    if (isStandalone() || recentlyDismissed()) return;
    if (!isMobile()) return;

    // Show modal after a tiny delay so the page paint comes first.
    const t = setTimeout(() => setOpen(true), 600);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setOpen(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!IS_VIEWER) return null;
  if (!open) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setOpen(false);
  };

  const install = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') {
          setDeferred(null);
          setOpen(false);
        }
      } catch {
        /* ignore */
      }
    } else if (isAndroid()) {
      // beforeinstallprompt가 아직 안 떴거나 PWA 기준 미충족 — 메뉴 안내
      alert('Chrome 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"를 누르세요.');
    }
  };

  const ios = isIOS();

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden">
        <button
          onClick={close}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 grid place-items-center text-slate-500"
          aria-label="닫기"
        >
          ✕
        </button>

        <div
          className="px-6 pt-8 pb-5 text-center text-white"
          style={{ background: 'linear-gradient(135deg, #2a2640 0%, #5e8eff 100%)' }}
        >
          <div className="w-20 h-20 mx-auto rounded-2xl bg-white/95 grid place-items-center mb-3 shadow-xl">
            <img src="./icon-192.png" alt="CNC 채용" className="w-16 h-16 object-contain" />
          </div>
          <div className="text-xl font-bold">CNC 채용</div>
          <div className="text-sm opacity-90 mt-1">홈 화면에 추가하면 앱처럼 열려요</div>
        </div>

        <div className="px-6 py-5 space-y-3 text-sm text-slate-700">
          {ios ? (
            <>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 grid place-items-center font-bold shrink-0">1</div>
                <div className="leading-relaxed pt-1">
                  Safari 하단 <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono">⬆︎ 공유</span> 버튼 누르기
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 grid place-items-center font-bold shrink-0">2</div>
                <div className="leading-relaxed pt-1">
                  목록 내려서 <b className="text-blue-700">"홈 화면에 추가"</b> 누르기
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 grid place-items-center font-bold shrink-0">3</div>
                <div className="leading-relaxed pt-1">
                  오른쪽 위 <b className="text-blue-700">"추가"</b> 탭 → 홈 화면에 아이콘 생김
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="text-2xl">⚡</div>
                <div className="leading-relaxed">
                  <b>한 번만 설치하면</b> 홈 화면 아이콘으로 매번 빠르게 열려요. 데이터 사용량 거의 없음, 별도 앱스토어 불필요.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 pt-0 space-y-2">
          {!ios && (
            <button
              onClick={install}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 text-base shadow-lg active:scale-[0.98] transition"
            >
              📲 앱 설치하기
            </button>
          )}
          <button
            onClick={close}
            className="w-full rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 text-sm"
          >
            {ios ? '확인했어요' : '나중에'}
          </button>
        </div>
      </div>
    </div>
  );
}
