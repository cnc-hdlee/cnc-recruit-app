import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

interface MobileInfo {
  port: number;
  listening: boolean;
  viewerBuilt: boolean;
  ips: { name: string; address: string }[];
  token: string | null;
  cloudUrl: string | null;
  externalUrl: string | null;
  lanUrls: string[];
  tunnel: { running: boolean; url: string | null; error: string | null };
}

export function MobileAccessCard() {
  const [info, setInfo] = useState<MobileInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.mobile.getInfo();
      if (r.ok && r.data) setInfo(r.data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    const off = api.mobile.onTunnelUrl(() => refresh());
    return () => { clearInterval(id); off(); };
  }, [refresh]);

  if (!info) return null;

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleRotate = async () => {
    if (!confirm('새 토큰을 발급할까요?\n\n기존 폰에서는 다시 새 URL로 접속해야 해요.')) return;
    await api.mobile.rotateToken();
    await refresh();
  };

  const lanPrimary = info.lanUrls[0] || null;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">📱</span> 폰에서 보기
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            아래 URL 한 번 클릭하면 폰에서 자동 인증되고 앱처럼 설치할 수 있어요. <b className="text-accent-green">읽기 전용</b>.
          </p>
        </div>
        <span className={`chip ${info.tunnel.running && info.externalUrl ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
          {info.tunnel.running && info.externalUrl ? '✓ 외부 접속 가능' : '⏳ 터널 시작 중'}
        </span>
      </div>

      {/* 클라우드 URL (영구) */}
      {info.cloudUrl && (
        <div className="rounded-xl border-2 border-emerald-400 p-3 mb-3 bg-emerald-50">
          <div className="text-[11px] uppercase tracking-wider text-emerald-800 font-bold mb-1 flex items-center gap-2">
            ⭐ 영구 URL (PC 꺼져도 동작 · 5분마다 자동 갱신)
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono break-all bg-white px-2 py-1.5 rounded">
              {info.cloudUrl}
            </code>
            <button className="btn text-xs shrink-0" onClick={() => copy('cloud', info.cloudUrl!)}>
              {copied === 'cloud' ? '✓' : '복사'}
            </button>
          </div>
        </div>
      )}

      {/* 외부 URL (임시 터널) */}
      <div className="rounded-xl border border-bg-line p-3 mb-3 bg-amber-50/40">
        <div className="text-[11px] uppercase tracking-wider text-amber-800 font-bold mb-1">⚡ 임시 외부 URL (PC 켜져 있을 때만, 매번 바뀜)</div>
        {info.externalUrl ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono break-all bg-white/80 px-2 py-1.5 rounded">
              {info.externalUrl}
            </code>
            <button className="btn text-xs shrink-0" onClick={() => copy('ext', info.externalUrl!)}>
              {copied === 'ext' ? '✓' : '복사'}
            </button>
          </div>
        ) : info.tunnel.error ? (
          <div className="text-xs text-rose-700">⚠ {info.tunnel.error}</div>
        ) : (
          <div className="text-xs text-slate-500">Cloudflare 터널 연결 중...</div>
        )}
      </div>

      {/* LAN URL */}
      {lanPrimary && (
        <div className="rounded-xl border border-bg-line p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-600 font-bold mb-1">🏠 사내망 접속 (같은 WiFi에서, 더 빠름)</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono break-all bg-white/80 px-2 py-1.5 rounded">
              {lanPrimary}
            </code>
            <button className="btn text-xs shrink-0" onClick={() => copy('lan', lanPrimary)}>
              {copied === 'lan' ? '✓' : '복사'}
            </button>
          </div>
        </div>
      )}

      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer hover:text-slate-700">🔧 고급 — 토큰 회전 / 모든 IP</summary>
        <div className="mt-2 space-y-2 pl-3 border-l-2 border-slate-200">
          <button className="btn text-xs" onClick={handleRotate}>🔄 새 토큰 발급</button>
          {info.lanUrls.length > 1 && (
            <div>
              <div className="font-semibold text-slate-600 mt-1">기타 LAN URL:</div>
              {info.lanUrls.slice(1).map((u, i) => (
                <code key={i} className="block text-[10px] font-mono break-all">{u}</code>
              ))}
            </div>
          )}
          <div className="text-[10px] text-slate-400">
            서버: 0.0.0.0:{info.port} · 뷰어 빌드: {info.viewerBuilt ? '✓' : '없음 (npm run build:viewer)'}
          </div>
        </div>
      </details>

      <div className="mt-3 text-[11px] text-slate-500 leading-relaxed">
        💡 <b>폰 사용법:</b> URL을 카카오톡 "나에게 보내기"로 보내고 폰에서 클릭 → 자동 로그인 → 화면 하단 "앱 설치" 배너로 홈 화면 추가. iOS는 공유 → "홈 화면에 추가".
      </div>
    </section>
  );
}
