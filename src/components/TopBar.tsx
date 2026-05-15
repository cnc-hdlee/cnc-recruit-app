import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { api } from '../lib/api';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function emailToInitials(email: string | null): string {
  if (!email) return '··';
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (local.slice(0, 2) || '··').toUpperCase();
}

export function TopBar({ title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  // 항상 보이는 헤더 배지용 — autoUpdater 이벤트 push로 갱신
  const [bannerState, setBannerState] = useState<'idle' | 'available' | 'progress' | 'downloaded' | 'error'>('idle');
  const [bannerVersion, setBannerVersion] = useState('');
  const [bannerProgress, setBannerProgress] = useState(0);
  const [bannerError, setBannerError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 56, right: 16 });
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // autoUpdater 이벤트 구독 — 헤더 배지에 즉시 반영
  useEffect(() => {
    if (!api?.app) return;
    const u1 = api.app.onUpdateAvailable((p) => {
      setBannerState('available');
      setBannerVersion(p.version);
    });
    const u2 = api.app.onUpdateProgress((p) => {
      setBannerState('progress');
      setBannerProgress(Math.round(p.percent || 0));
    });
    const u3 = api.app.onUpdateDownloaded((p) => {
      setBannerState('downloaded');
      setBannerVersion(p.version);
    });
    const u4 = api.app.onUpdateError((p) => {
      setBannerState('error');
      setBannerError(p.message);
    });
    const u5 = api.app.onUpdateNotAvailable(() => {
      setBannerState('idle');
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // Google 로그인 이메일 + 앱 버전 — mount 시 즉시 fetch (버튼 이니셜이 항상 정확하도록)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.google.status();
        if (!cancelled && r.ok && r.data?.profile?.email) setProfileEmail(r.data.profile.email);
      } catch { /* ignore */ }
      try {
        const r = await api.app.getVersion();
        if (!cancelled && r.ok && r.data) setAppVersion(r.data);
      } catch { /* ignore */ }
    })();
    const id = setInterval(async () => {
      try {
        const r = await api.google.status();
        if (!cancelled && r.ok && r.data?.profile?.email) setProfileEmail(r.data.profile.email);
        else if (!cancelled && r.ok && !r.data?.profile?.email) setProfileEmail(null);
      } catch { /* ignore */ }
    }, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // popover 위치 계산 (버튼 기준)
  useLayoutEffect(() => {
    if (!menuOpen || !buttonRef.current) return;
    const compute = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      setPopoverPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [menuOpen]);

  // 외부 클릭 시 popover 닫기 — 버튼/popover 둘 다 예외 처리
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const handleSignOut = async () => {
    if (!confirm('Google 계정에서 로그아웃하시겠습니까?\n\n시트·캘린더·메일 동기화가 멈추고 다시 사용하려면 재로그인이 필요합니다.')) return;
    setSigningOut(true);
    try {
      await api.google.signOut();
      window.location.reload();
    } catch (e) {
      setSigningOut(false);
      alert('로그아웃 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    setUpdateReady(false);
    try {
      const r = await api.app.checkForUpdates();
      if (!r.ok || !r.data) {
        setUpdateMsg(`체크 실패: ${r.error || 'unknown'}`);
        return;
      }
      const { dev, currentVersion, latestVersion, updateAvailable } = r.data;
      if (dev) {
        setUpdateMsg(`개발 모드 (v${currentVersion}) — HMR로 즉시 반영 중. 자동 업데이트는 빌드본에서만 동작.`);
      } else if (updateAvailable) {
        setUpdateMsg(`🎉 새 버전 v${latestVersion} 다운로드 중! 잠시 후 재시작 안내가 떠요. (현재 v${currentVersion})`);
        setUpdateReady(true);
      } else {
        setUpdateMsg(`✓ 최신 버전입니다 (v${currentVersion})`);
      }
    } catch (e) {
      setUpdateMsg('체크 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleQuitAndInstall = async () => {
    if (!confirm('지금 재시작해서 새 버전을 적용할까요?\n\n진행 중인 작업은 모두 닫힙니다.')) return;
    try {
      await api.app.quitAndInstall();
    } catch (e) {
      alert('재시작 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const sheetCount =
    D.calIntv.filter((e) => e.dt === today && !e.done).length +
    D.calJoin.filter((e) => e.dt === today).length +
    D.calLeave.filter((e) => e.dt === today).length;
  const calCount = liveCalendarEventsNormalized().filter((e) => e.dt === today && e.kind !== '기타').length;
  const todayCount = Math.max(sheetCount, calCount);
  const urgent = D.missingAlerts.filter((a) => a.priority === 'high').length;

  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return (
    <header className="h-14 shrink-0 px-3 sm:px-4 md:px-6 flex items-center justify-between surface-glass gap-2">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden w-9 h-9 rounded grid place-items-center text-slate-700 hover:bg-slate-200/60 shrink-0"
            aria-label="메뉴 열기"
          >
            <span className="text-xl leading-none">☰</span>
          </button>
        )}
        <h1 className="text-base md:text-lg font-semibold tracking-tight text-brand truncate">{title}</h1>
        {(todayCount > 0 || urgent > 0 || live.lastError) && (
          <div className="flex items-center gap-2">
            {todayCount > 0 && (
              <span className="chip bg-cc-p9 text-cc-p2 border border-cc-p7">
                오늘 {todayCount}건
              </span>
            )}
            {urgent > 0 && (
              <span className="chip bg-rose-50 text-cc-red border border-rose-200 font-semibold animate-breathe">
                🚨 긴급 {urgent}
              </span>
            )}
            {live.lastError && (
              <span className="chip bg-amber-50 text-amber-700 border border-amber-200 truncate max-w-[200px]" title={live.lastError}>
                ⚠ 동기화 오류
              </span>
            )}
          </div>
        )}
        {/* 업데이트 상태 배지 — 항상 보임 (popover 안 열어도) */}
        {bannerState === 'downloaded' && (
          <button
            onClick={handleQuitAndInstall}
            className="chip bg-emerald-500 text-white border border-emerald-600 font-bold hover:bg-emerald-600 animate-pulse cursor-pointer"
            title="새 버전 다운로드 완료 — 클릭하여 재시작"
          >
            🎉 v{bannerVersion} 준비 완료 — 재시작
          </button>
        )}
        {bannerState === 'available' && (
          <span className="chip bg-amber-100 text-amber-900 border border-amber-200 font-semibold">
            📥 v{bannerVersion} 다운로드 시작...
          </span>
        )}
        {bannerState === 'progress' && (
          <span className="chip bg-amber-100 text-amber-900 border border-amber-200 font-semibold">
            📥 다운로드 {bannerProgress}%
          </span>
        )}
        {bannerState === 'error' && (
          <span
            className="chip bg-rose-50 text-rose-700 border border-rose-200 font-semibold"
            title={`업데이트 서버 연결 실패: ${bannerError}\n수동으로 GitHub Releases에서 받아 설치하세요.`}
          >
            ⚠ 업데이트 체크 실패
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 md:gap-4 text-sm shrink-0">
        <div className="hidden sm:block text-brand-mid">
          <span className="font-semibold">
            {y}.{mo}.{dd}
          </span>{' '}
          <span className="text-brand-soft">({DAYS[now.getDay()]})</span>
        </div>
        <div className="hidden md:block font-mono tabular-nums font-semibold tracking-wider" style={{ color: 'var(--cc-p2)' }}>
          {hh}:{mm}:{ss}
        </div>
        <div ref={menuRef} className="relative">
          <button
            ref={buttonRef}
            onClick={() => setMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white shadow-brand cursor-pointer hover:ring-2 hover:ring-white/40 transition-shadow"
            style={{ backgroundImage: 'linear-gradient(135deg, #2a2640 0%, #49445f 60%, #827a99 100%)' }}
            title={profileEmail ? `계정: ${profileEmail}` : '계정 메뉴'}
          >
            {emailToInitials(profileEmail)}
          </button>
          {menuOpen && createPortal(
            <div
              ref={popoverRef}
              className="fixed w-72 bg-white rounded-lg shadow-2xl border border-slate-200 py-1"
              style={{ top: popoverPos.top, right: popoverPos.right, zIndex: 99999 }}
            >
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="text-[11px] text-slate-500">로그인 계정</div>
                <div className="text-sm font-semibold text-slate-800 truncate" title={profileEmail || ''}>
                  {profileEmail || '(로그인 필요)'}
                </div>
              </div>
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">앱 버전</div>
                    <div className="text-sm font-semibold text-slate-800 font-mono">
                      v{appVersion || '…'}
                    </div>
                  </div>
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1"
                  >
                    <span className={checkingUpdate ? 'animate-spin' : ''}>🔄</span>
                    {checkingUpdate ? '확인 중...' : '업데이트 확인'}
                  </button>
                </div>
                {updateMsg && (
                  <div className={`mt-1.5 text-[11px] leading-snug rounded px-2 py-1.5 ${
                    updateReady
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : updateMsg.startsWith('체크 실패')
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-slate-50 text-slate-700 border border-slate-200'
                  }`}>
                    {updateMsg}
                    {updateReady && (
                      <button
                        onClick={handleQuitAndInstall}
                        className="mt-1 w-full px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700"
                      >
                        지금 재시작 + 설치
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                <span>🚪</span>
                {signingOut ? '로그아웃 중...' : 'Google 로그아웃'}
              </button>
              <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 leading-snug">
                자동 업데이트: 시작 시 + 4시간마다 GitHub Releases 체크
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </header>
  );
}
