import type { PageId } from '../types';
import { useData } from '../store';
import { useLiveData } from '../store/liveData';

interface NavItem {
  id: PageId;
  icon: string;
  label: string;
  badgeKey?: 'urgent' | 'todayIntv' | 'pipeline';
}

const NAV: NavItem[] = [
  { id: 'dashboard', icon: '🏠', label: '대시보드', badgeKey: 'urgent' },
  { id: 'headcount', icon: '👥', label: '인원현황' },
  { id: 'pipeline', icon: '🎯', label: '채용 파이프라인', badgeKey: 'pipeline' },
  { id: 'calendar', icon: '📅', label: '면접 캘린더', badgeKey: 'todayIntv' },
  { id: 'mail', icon: '✉️', label: '메일 / 커뮤니케이션' },
  { id: 'slack', icon: '💬', label: 'Slack 피드' },
  { id: 'auto', icon: '🔗', label: '자동 분석' },
  { id: 'settings', icon: '⚙️', label: '설정 / 연동' },
  { id: 'usage', icon: '📖', label: '사용법 (필독)' },
];

export function Sidebar({ active, onChange }: { active: PageId; onChange: (p: PageId) => void }) {
  const D = useData();
  const live = useLiveData();
  const today = '2026-04-29';
  const todayIntv = D.calIntv.filter((e) => e.dt === today && !e.done).length;
  const urgent = D.missingAlerts.filter((a) => a.priority === 'high').length;
  const pipeline = D.screeningTasks.filter((t) => t.stage !== '합격' && t.stage !== '불합격' && t.stage !== '취소').length;
  const counts = { urgent, todayIntv, pipeline };

  return (
    <aside className="w-64 shrink-0 bg-bg-deep/80 border-r border-bg-line flex flex-col">
      <div className="px-5 py-5 border-b border-bg-line">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue grid place-items-center font-bold text-white shadow-glow">
            C
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">CNC 채용</div>
            <div className="text-[11px] text-slate-400 leading-tight">커맨드센터 v2.0</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => {
          const isActive = item.id === active;
          const badge = item.badgeKey ? counts[item.badgeKey] : 0;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-accent-purple/15 text-white border border-accent-purple/40 shadow-glow'
                  : 'text-slate-300 hover:bg-bg-hover/50 border border-transparent'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span
                  className={`chip ${
                    item.badgeKey === 'urgent'
                      ? 'bg-accent-red/20 text-accent-red'
                      : item.badgeKey === 'todayIntv'
                      ? 'bg-accent-blue/20 text-accent-blue'
                      : 'bg-accent-green/20 text-accent-green'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-bg-line text-[11px] text-slate-500">
        {(() => {
          const pollers = live.pollStatus.length;
          const cached = live.pollStatus.filter((p) => p.hasCache).length;
          if (live.hasLive) {
            return (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse"></span>
                시트 연동 중 · {cached}/{pollers}
              </div>
            );
          }
          if (pollers > 0) {
            return (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent-yellow animate-pulse"></span>
                {pollers}개 시트 연결 중...
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              연결 대기 — 시트 추가 필요
            </div>
          );
        })()}
        {live.lastTickAt && (
          <div className="mt-1 text-[10px]">
            마지막 체크 {Math.round((Date.now() - live.lastTickAt) / 1000)}초 전
          </div>
        )}
        {live.lastError && (
          <div className="mt-1 text-[10px] text-accent-red truncate" title={live.lastError}>
            ⚠ {live.lastError}
          </div>
        )}
      </div>
      <div className="px-3 pb-3 pt-2 border-t border-bg-line/60">
        <div className="rounded-md px-2.5 py-1.5 bg-gradient-to-r from-accent-purple/10 via-accent-blue/10 to-transparent border border-bg-line/60">
          <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 leading-tight">
            Crafted by
          </div>
          <div className="text-[11px] font-semibold leading-tight bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
            이형도 사원
          </div>
          <div className="text-[9px] text-slate-500 leading-tight tracking-wide">
            Talent Acquisition Team
          </div>
        </div>
      </div>
    </aside>
  );
}
