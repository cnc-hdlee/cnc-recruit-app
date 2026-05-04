import { useEffect, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function TopBar({ title }: { title: string }) {
  const [now, setNow] = useState(new Date());
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

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
    <header className="h-14 shrink-0 px-6 flex items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight text-slate-800">{title}</h1>
        {(todayCount > 0 || urgent > 0 || live.lastError) && (
          <div className="flex items-center gap-2">
            {todayCount > 0 && (
              <span className="chip bg-blue-50 text-blue-700 border border-blue-200">
                오늘 {todayCount}건
              </span>
            )}
            {urgent > 0 && (
              <span className="chip bg-red-100 text-red-700 border border-red-200 font-semibold animate-breathe">
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
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="text-slate-700">
          <span className="font-semibold">
            {y}.{mo}.{dd}
          </span>{' '}
          <span className="text-slate-500">({DAYS[now.getDay()]})</span>
        </div>
        <div className="font-mono tabular-nums text-indigo-600 font-semibold">
          {hh}:{mm}:{ss}
        </div>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 grid place-items-center text-xs font-bold text-white">
          HD
        </div>
      </div>
    </header>
  );
}
