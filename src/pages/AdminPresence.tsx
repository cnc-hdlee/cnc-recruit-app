// 접속 현황 — 지금 이 앱을 누가 쓰고 있는지 실시간으로 본다. 관리자(이형도)에게만 보이는 화면.
//
// 구조: 배포된 앱들이 1분마다 Cloudflare Worker(/presence)로 하트비트를 보내고,
//       이 화면은 15초마다 그 목록을 읽는다. KV TTL 5분이라 앱을 끄면 자동으로 사라진다.
//       나가는 정보는 사내 계정·이름·버전·보고 있는 화면뿐 — 후보자 데이터는 포함되지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';

export interface PresenceUser {
  email: string;
  name?: string;
  page?: string;
  version?: string;
  platform?: string;
  host?: string;
  lastSeen: number;
}

const PAGE_LABEL: Record<string, string> = {
  headcount: '인원현황',
  orgcharts: '업무 편제표',
  incoming: '입사예정자',
  comms: '후보자 안내 메일',
  calendar: '면접 캘린더',
  agenda: '면접 일정표',
  rooms: '회의실 예약',
  jobcenters: '일자리센터',
  campus: '캠퍼스 리쿠르팅',
  lookup: '후보자 검색',
  resumes: '이력서',
  competitors: '경쟁사',
  settings: '설정 / 연동',
  admin: '접속 현황',
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초 전`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

export function AdminPresence() {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (IS_VIEWER || !api?.presence) {
      setLoading(false);
      return;
    }
    try {
      const r = await api.presence.list();
      if (!r.ok) {
        setErr(r.error || '조회 실패');
        return;
      }
      setConfigured(r.data?.configured !== false);
      setUsers(r.data?.users || []);
      setErr(null);
      setAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const { online, idle } = useMemo(() => {
    const now = Date.now();
    return {
      online: users.filter((u) => now - u.lastSeen < 3 * 60_000),
      idle: users.filter((u) => now - u.lastSeen >= 3 * 60_000),
    };
  }, [users]);

  if (!configured) {
    return <PresenceSetup onSaved={() => void load()} />;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="지금 사용 중" value={online.length} tone="text-emerald-600" />
        <Stat label="최근 접속 (3분 이상)" value={idle.length} tone="text-slate-900" />
        <Stat label="총 사용자" value={users.length} tone="text-indigo-700" />
        <div className="card px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">갱신</div>
          <div className="mt-1 text-[12px] text-slate-900">
            {at ? `${ago(Date.now() - at)} · 15초마다 자동` : '불러오는 중…'}
          </div>
        </div>
      </div>

      {err && <div className="card p-3 text-[12px] text-rose-700">⚠ {err}</div>}

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--cc-p8)' }}>
          <span className="text-sm font-bold text-slate-900">실시간 접속자</span>
          <span className="text-[11px] text-slate-500">앱을 켜두면 1분마다 갱신 · 끄면 5분 내 자동 사라짐</span>
          <div className="flex-1" />
          <button className="btn text-[11px]" onClick={() => void load()}>
            ↻ 새로고침
          </button>
        </div>
        {loading && <div className="p-6 text-center text-slate-500 text-sm">불러오는 중…</div>}
        {!loading && users.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">지금 앱을 쓰고 있는 사람이 없습니다.</div>
        )}
        {users.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#faf7ff] text-[11px] text-slate-600">
                {['상태', '사용자', '보고 있는 화면', '버전', 'PC', '마지막 신호'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const live = Date.now() - u.lastSeen < 3 * 60_000;
                return (
                  <tr key={u.email} className="border-b" style={{ borderColor: 'var(--cc-p8)' }}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`chip ${live ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {live ? '● 사용 중' : '○ 자리비움'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-900">{u.name || u.email.split('@')[0]}</div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {PAGE_LABEL[u.page || ''] || u.page || '-'}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-slate-600">{u.version || '-'}</td>
                    <td className="px-3 py-2 text-[12px] text-slate-600">{u.host || '-'}</td>
                    <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">
                      {ago(Date.now() - u.lastSeen)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-[11px] text-slate-500 px-1">
        수집 항목: 사내 계정 · 이름 · 앱 버전 · 보고 있는 화면 이름 · PC 이름. 후보자·이력서 데이터는
        전송되지 않습니다.
      </div>
    </div>
  );
}

/** 서버 주소·토큰 입력 — 배포 후 한 번만 넣으면 된다 */
function PresenceSetup({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const u = await api.cfg.get<string>('cloudWorkerUrl');
      const t = await api.cfg.get<string>('presenceToken');
      if (u.ok && u.data) setUrl(u.data);
      if (t.ok && t.data) setToken(t.data);
    })();
  }, []);

  return (
    <div className="card p-5 space-y-3 max-w-2xl">
      <div className="text-sm font-bold text-slate-900">접속 현황 서버 연결</div>
      <div className="text-[12px] text-slate-600 leading-relaxed">
        배포된 앱들이 "지금 쓰는 중"이라고 알려줄 공용 주소가 필요합니다. Cloudflare Worker를 배포한
        뒤 아래 두 값을 넣으면 이 화면이 살아납니다. 값이 비어 있으면 앱은 아무것도 보내지 않습니다.
      </div>
      <label className="block">
        <span className="text-[11px] font-bold text-slate-700">서버 주소</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cnc-recruit.<계정>.workers.dev"
          className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded text-[12px] text-slate-900"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-bold text-slate-700">보고 토큰 (Worker의 PRESENCE_TOKEN과 동일)</span>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded text-[12px] text-slate-900"
        />
      </label>
      <button
        className="btn btn-primary text-[12px]"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await api.cfg.set('cloudWorkerUrl', url.trim());
          await api.cfg.set('presenceToken', token.trim());
          setSaving(false);
          onSaved();
        }}
      >
        {saving ? '저장 중…' : '저장하고 연결'}
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 truncate">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
