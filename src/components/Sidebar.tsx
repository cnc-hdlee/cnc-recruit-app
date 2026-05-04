import type { PageId } from '../types';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { recruitAlertsBadgeCount } from '../pages/RecruitAlerts';
import { IS_VIEWER } from '../lib/mode';

interface NavItem {
  id: PageId;
  icon: string;
  label: string;
  badgeKey?: 'todayIntv' | 'incoming' | 'alerts';
  maintainerOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'dashboard', icon: '🏠', label: '대시보드' },
  { id: 'headcount', icon: '👥', label: '인원현황' },
  { id: 'incoming', icon: '🎉', label: '입사예정자', badgeKey: 'incoming' },
  { id: 'alerts', icon: '🚨', label: '채용 알림', badgeKey: 'alerts' },
  { id: 'calendar', icon: '📅', label: '면접 캘린더', badgeKey: 'todayIntv' },
  { id: 'jobcenters', icon: '🏢', label: '일자리센터' },
  { id: 'lookup', icon: '🔍', label: '후보자 검색' },
  { id: 'mail', icon: '✉️', label: '메일 / 커뮤니케이션' },
  { id: 'settings', icon: '⚙️', label: '설정 / 연동' },
  { id: 'usage', icon: '📖', label: '사용법 (필독)' },
];

export function Sidebar({ active, onChange }: { active: PageId; onChange: (p: PageId) => void }) {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();
  const todayIntv = D.calIntv.filter((e) => e.dt === today && !e.done).length;
  const incoming = live.hasLive
    ? liveByKindOrScan('incoming').filter((r) => {
        const nm = Object.entries(r).find(([k]) => k.replace(/\s+/g, '').includes('성명'))?.[1]?.trim();
        const dtRaw = Object.entries(r).find(([k]) => k.replace(/\s+/g, '').includes('입사'))?.[1]?.trim() || '';
        if (!nm) return false;
        const hasDate = /\d{4}/.test(dtRaw) || /^\d{5,6}/.test(dtRaw);
        return hasDate;
      }).length
    : 0;
  const alerts = live.hasLive ? recruitAlertsBadgeCount() : 0;
  const counts = { todayIntv, incoming, alerts };

  return (
    <aside className="w-60 shrink-0 flex flex-col text-slate-100" style={{ background: 'linear-gradient(180deg, #0b001f 0%, #130f29 50%, #2a2640 100%)' }}>
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/95 grid place-items-center shadow-lg overflow-hidden">
            <img src="/icon.png" alt="C&C" className="w-8 h-8 object-contain" />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight bg-gradient-to-r from-indigo-200 to-violet-200 bg-clip-text text-transparent">
              CNC 채용
            </div>
            <div className="text-[10px] text-indigo-300/80 leading-tight tracking-widest uppercase mt-0.5">
              Command v2.1
            </div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.filter((item) => !item.maintainerOnly || !IS_VIEWER).map((item) => {
          const isActive = item.id === active;
          const badge = item.badgeKey ? counts[item.badgeKey] : 0;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-white/12 text-white border-l-[3px] font-semibold'
                  : 'text-[#dfd7f9]/85 hover:bg-white/6 border-l-[3px] border-transparent'
              }`}
              style={isActive ? { borderLeftColor: '#cac3e4' } : undefined}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span
                  className={`chip ${
                    item.badgeKey === 'todayIntv'
                      ? 'bg-blue-400/90 text-white'
                      : item.badgeKey === 'alerts'
                      ? 'bg-rose-500/90 text-white animate-pulse'
                      : 'bg-amber-400/90 text-white'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10 text-[11px] text-indigo-200/70">
        {(() => {
          const pollers = live.pollStatus.length;
          const cached = live.pollStatus.filter((p) => p.hasCache).length;
          if (live.hasLive) {
            return (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                시트 연동 중 · {cached}/{pollers}
              </div>
            );
          }
          if (pollers > 0) {
            return (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                {pollers}개 시트 연결 중...
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
              연결 대기 — 시트 추가 필요
            </div>
          );
        })()}
        {live.lastTickAt && (
          <div className="mt-1 text-[10px] text-indigo-200/50">
            마지막 체크 {Math.round((Date.now() - live.lastTickAt) / 1000)}초 전
          </div>
        )}
        {live.lastError && (
          <div className="mt-1 text-[10px] text-rose-300 truncate" title={live.lastError}>
            ⚠ {live.lastError}
          </div>
        )}
      </div>
      <div className="px-3 pb-3 pt-2 border-t border-white/10">
        <div className="rounded-md px-2.5 py-1.5 bg-white/5 border border-white/10">
          <div className="text-[9px] uppercase tracking-[0.18em] text-indigo-200/60 leading-tight">
            Crafted by
          </div>
          <div className="text-[11px] font-semibold leading-tight bg-gradient-to-r from-indigo-200 to-violet-200 bg-clip-text text-transparent">
            이형도 사원
          </div>
          <div className="text-[9px] text-indigo-200/60 leading-tight tracking-wide">
            Talent Acquisition Team
          </div>
        </div>
      </div>
    </aside>
  );
}
