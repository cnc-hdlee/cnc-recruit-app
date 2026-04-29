import { useData, getTodayStr } from '../store';
import { useLiveData } from '../store/liveData';
import { gmailSearchUrl } from '../lib/gmail';
import type { PageId, MissingAlert } from '../types';

export function Dashboard({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();

  const upcomingIntv = D.calIntv
    .filter((e) => e.dt >= today && !e.done)
    .sort((a, b) => (a.dt + a.tm).localeCompare(b.dt + b.tm))
    .slice(0, 8);

  const alertsByPrio: Record<string, MissingAlert[]> = { high: [], medium: [], low: [] };
  D.missingAlerts.forEach((a) => {
    (alertsByPrio[a.priority] || (alertsByPrio[a.priority] = [])).push(a);
  });
  const recentMail = D.teamMail.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {live.hasLive ? (
            <span className="text-accent-green">📊 라이브 시트 연동 중 — 시트 변경 시 자동 반영</span>
          ) : (
            <span className="text-accent-yellow">📦 정적 스냅샷 — 시트 연결 필요 (⚙️ 설정에서)</span>
          )}
        </div>
        {live.lastTickAt && (
          <div className="text-xs text-slate-500">
            마지막 동기화: {Math.round((Date.now() - live.lastTickAt) / 1000)}초 전
          </div>
        )}
      </div>

      {alertsByPrio.high.length > 0 && (
        <div className="card border-accent-red/40 bg-accent-red/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-accent-red flex items-center gap-2">🚨 긴급 알림 · High Priority</h3>
            <span className="chip bg-accent-red/20 text-accent-red">{alertsByPrio.high.length}건</span>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {alertsByPrio.high.slice(0, 6).map((a, i) => (
              <div key={i} className="flex gap-2 text-sm p-2 rounded-lg bg-bg-deep/40">
                <span className="text-base">{a.icon}</span>
                <div className="min-w-0">
                  <div className="font-medium text-slate-100 truncate">{a.title}</div>
                  <div className="text-xs text-slate-400 line-clamp-2">{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">📅 다가오는 면접 일정</h3>
            <button className="btn text-xs" onClick={() => onNavigate('calendar')}>전체 캘린더 →</button>
          </div>
          <div className="divide-y divide-bg-line">
            {upcomingIntv.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">예정된 면접 없음</div>}
            {upcomingIntv.map((e, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <div className="w-14 text-center">
                  <div className="text-[10px] text-slate-500">{e.dt.slice(5).replace('-', '/')}</div>
                  <div className="font-mono font-semibold text-accent-blue">{e.tm}</div>
                </div>
                <div className="flex-1 text-sm text-slate-200">{e.title}</div>
                <span className="chip bg-accent-blue/15 text-accent-blue">면접</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">✉️ 최근 TA팀 메일</h3>
            <button className="btn text-xs" onClick={() => onNavigate('mail')}>전체 →</button>
          </div>
          <div className="space-y-2">
            {recentMail.map((m, i) => (
              <a
                key={i}
                href={gmailSearchUrl({ subject: m.subj })}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2.5 rounded-lg bg-bg-deep/40 hover:bg-bg-hover/40 hover:border-accent-purple/40 border border-transparent transition-all cursor-pointer group"
                title="Gmail에서 이 메일 검색해서 열기"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                  <span>{m.dt}</span>
                  <span className="chip bg-accent-purple/15 text-accent-purple">{m.type}</span>
                </div>
                <div className="text-sm font-medium text-slate-100 truncate group-hover:text-accent-purple transition-colors">
                  {m.subj}
                  <span className="ml-1.5 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100">↗</span>
                </div>
                <div className="text-[11px] text-slate-400 truncate">{m.from} → {m.to}</div>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <AlertList title="📋 미처리 / 진행 알림 (Medium)" alerts={alertsByPrio.medium.slice(0, 8)} accent="yellow" />
        <AlertList title="✅ 완료 / 참고 (Low)" alerts={alertsByPrio.low.slice(0, 8)} accent="green" />
      </div>
    </div>
  );
}

function AlertList({ title, alerts, accent }: { title: string; alerts: MissingAlert[]; accent: 'yellow' | 'green' }) {
  const tone = accent === 'yellow' ? 'text-accent-yellow' : 'text-accent-green';
  return (
    <div className="card p-5">
      <h3 className={`font-semibold mb-3 ${tone}`}>{title}</h3>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className="flex gap-2 text-sm p-2 rounded-lg hover:bg-bg-hover/30">
            <span>{a.icon}</span>
            <div className="min-w-0">
              <div className="font-medium text-slate-100 truncate">{a.title}</div>
              <div className="text-xs text-slate-400 line-clamp-2">{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
