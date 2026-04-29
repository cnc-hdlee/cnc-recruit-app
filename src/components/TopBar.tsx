import { useEffect, useState } from 'react';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function TopBar({ title }: { title: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <header className="h-14 shrink-0 px-6 flex items-center justify-between border-b border-bg-line bg-bg-deep/40 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="text-slate-300">
          <span className="font-medium">
            {y}.{mo}.{dd}
          </span>{' '}
          <span className="text-slate-500">({DAYS[now.getDay()]})</span>
        </div>
        <div className="font-mono tabular-nums text-accent-blue">
          {hh}:{mm}:{ss}
        </div>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-purple to-accent-pink grid place-items-center text-xs font-semibold">
          HD
        </div>
      </div>
    </header>
  );
}
