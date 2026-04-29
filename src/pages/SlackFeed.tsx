import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, type SlackChannel, type SlackMessage } from '../lib/api';

// Auto-pick on first load (case-insensitive substring matching)
const AUTO_CHANNEL_KEYWORDS = ['team_people-culture', 'team_talent-acquisition', '캔디드', '코공고'];
const AUTO_DM_NAMES = ['허필중', '임세현'];

interface FeedItem extends SlackMessage {
  channelId: string;
  userName: string;
  channelName?: string;
  channelKind?: 'channel' | 'dm';
}

export function SlackFeed() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [team, setTeam] = useState<string>('');
  const [allChannels, setAllChannels] = useState<SlackChannel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<'all' | 'channel' | 'dm'>('all');
  const [search, setSearch] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [showAllChannels, setShowAllChannels] = useState(false);
  const [showAllDms, setShowAllDms] = useState(false);
  const [autoSeeded, setAutoSeeded] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.cfg.get<string[]>('slackSelectedIds');
      if (r.ok && r.data) {
        setSelectedIds(new Set(r.data));
        setAutoSeeded(true); // saved selection exists, don't overwrite
      }
    })();
  }, []);

  const persistSelection = async (ids: Set<string>) => {
    await api.cfg.set('slackSelectedIds', [...ids]);
  };

  const loadStatus = useCallback(async () => {
    const s = await api.slack.status();
    if (!s.ok) {
      setAuthed(false);
      return;
    }
    setAuthed(s.data!.hasToken);
    if (s.data!.team) setTeam(s.data!.team.team);
  }, []);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    const r = await api.slack.listChannels('public_channel,private_channel,im,mpim');
    setLoading(false);
    if (!r.ok) {
      setError(r.error || 'Failed to list channels');
      return;
    }
    const channels = r.data || [];
    setAllChannels(channels);

    // Auto-select target channels/DMs on first load only
    if (!autoSeeded) {
      const auto = new Set<string>();
      channels.forEach((c) => {
        const lname = c.name.toLowerCase();
        if (c.isIM) {
          if (AUTO_DM_NAMES.some((n) => c.name.includes(n))) auto.add(c.id);
        } else {
          if (AUTO_CHANNEL_KEYWORDS.some((kw) => lname.includes(kw.toLowerCase()))) auto.add(c.id);
        }
      });
      if (auto.size > 0) {
        setSelectedIds(auto);
        persistSelection(auto);
      }
      setAutoSeeded(true);
    }
  }, [autoSeeded]);

  const loadFeed = useCallback(async () => {
    if (selectedIds.size === 0) {
      setFeed([]);
      return;
    }
    setLoading(true);
    const r = await api.slack.readMultiple([...selectedIds], 30);
    setLoading(false);
    if (!r.ok) {
      setError(r.error || 'Failed to read messages');
      return;
    }
    setError(null);
    const channelMap = new Map(allChannels.map((c) => [c.id, c]));
    const items: FeedItem[] = (r.data || []).map((m) => {
      const ch = channelMap.get(m.channelId);
      const kind: FeedItem['channelKind'] = ch?.isIM ? 'dm' : 'channel';
      return { ...m, channelName: ch?.name, channelKind: kind };
    });
    setFeed(items);
  }, [selectedIds, allChannels]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (authed) loadChannels();
  }, [authed, loadChannels]);

  useEffect(() => {
    if (authed && allChannels.length) loadFeed();
  }, [authed, allChannels, loadFeed]);

  useEffect(() => {
    if (!autoRefresh || !authed) return;
    const id = setInterval(loadFeed, 20000);
    return () => clearInterval(id);
  }, [autoRefresh, authed, loadFeed]);

  const toggleChannel = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    persistSelection(next);
  };

  const filtered = useMemo(() => {
    let f = feed;
    if (filter !== 'all') f = f.filter((m) => m.channelKind === filter);
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((m) => (m.text || '').toLowerCase().includes(q) || (m.userName || '').toLowerCase().includes(q));
    }
    return f;
  }, [feed, filter, search]);

  const counts = useMemo(() => ({
    all: feed.length,
    channel: feed.filter((m) => m.channelKind === 'channel').length,
    dm: feed.filter((m) => m.channelKind === 'dm').length,
  }), [feed]);

  const channelsAll = useMemo(() => allChannels.filter((c) => !c.isIM), [allChannels]);
  const dmsAll = useMemo(() => allChannels.filter((c) => c.isIM), [allChannels]);

  const matchesSearch = (name: string) => !channelSearch || name.toLowerCase().includes(channelSearch.toLowerCase());

  const memberChannels = useMemo(() => channelsAll.filter((c) => c.isMember && matchesSearch(c.name)), [channelsAll, channelSearch]);
  const otherChannels = useMemo(() => channelsAll.filter((c) => !c.isMember && matchesSearch(c.name)), [channelsAll, channelSearch]);
  const dmsFiltered = useMemo(() => dmsAll.filter((c) => matchesSearch(c.name)), [dmsAll, channelSearch]);

  if (authed === null) return <div className="p-6 text-slate-400">로딩 중...</div>;

  if (!authed) {
    return (
      <div className="card p-8 text-center max-w-2xl">
        <div className="text-4xl mb-3">💬</div>
        <h2 className="text-xl font-semibold mb-2">Slack이 아직 연결되지 않았습니다</h2>
        <p className="text-sm text-slate-400 mb-4">⚙️ 설정 / 연동 페이지에서 Slack User Token (xoxp-...)을 입력하세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3">
        <span className="chip bg-accent-green/15 text-accent-green">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
          {team || 'Slack'}
        </span>
        <div className="text-sm text-slate-400">
          모니터링 {selectedIds.size}개 · 메시지 {feed.length}건 · 전체 채널 {channelsAll.length}, DM {dmsAll.length}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            자동 새로고침 (20초)
          </label>
          <button className="btn text-xs" onClick={() => loadChannels()}>채널 재조회</button>
          <button className="btn text-xs" onClick={() => loadFeed()}>🔄 즉시</button>
        </div>
      </div>

      {error && (
        <div className="card border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          <span>⚠</span><span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-xs">닫기</button>
        </div>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Channel selector */}
        <div className="card p-3 max-h-[80vh] overflow-y-auto space-y-3">
          <div>
            <input
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              placeholder="🔍 채널/사람 이름 검색"
              className="input w-full text-xs"
            />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              채널 — 멤버십 ({memberChannels.length})
            </div>
            <div className="space-y-1">
              {(showAllChannels ? memberChannels : memberChannels.slice(0, 20)).map((c) => (
                <ChannelRow key={c.id} c={c} checked={selectedIds.has(c.id)} onToggle={() => toggleChannel(c.id)} />
              ))}
              {memberChannels.length === 0 && <div className="text-[11px] text-slate-600 px-2 py-1">없음</div>}
              {memberChannels.length > 20 && !showAllChannels && (
                <button onClick={() => setShowAllChannels(true)} className="text-[10px] text-accent-purple hover:underline px-2">
                  + {memberChannels.length - 20}개 더 보기
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">DM ({dmsFiltered.length})</div>
            <div className="space-y-1">
              {(showAllDms ? dmsFiltered : dmsFiltered.slice(0, 20)).map((c) => (
                <ChannelRow key={c.id} c={c} checked={selectedIds.has(c.id)} onToggle={() => toggleChannel(c.id)} />
              ))}
              {dmsFiltered.length === 0 && <div className="text-[11px] text-slate-600 px-2 py-1">없음 — `im:read`/`im:history` 권한 확인</div>}
              {dmsFiltered.length > 20 && !showAllDms && (
                <button onClick={() => setShowAllDms(true)} className="text-[10px] text-accent-purple hover:underline px-2">
                  + {dmsFiltered.length - 20}개 더 보기
                </button>
              )}
            </div>
          </div>

          {otherChannels.length > 0 && (
            <details>
              <summary className="text-[11px] uppercase tracking-wide text-slate-500 mb-1 cursor-pointer hover:text-slate-300">
                미참여 채널 ({otherChannels.length})
              </summary>
              <div className="space-y-1 mt-1">
                {otherChannels.slice(0, 30).map((c) => (
                  <ChannelRow key={c.id} c={c} checked={selectedIds.has(c.id)} onToggle={() => toggleChannel(c.id)} dim />
                ))}
                {otherChannels.length > 30 && (
                  <div className="text-[10px] text-slate-600 px-2">검색으로 좁히세요 ({otherChannels.length - 30}개 더)</div>
                )}
              </div>
            </details>
          )}
        </div>

        {/* Feed */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>전체 {counts.all}</FilterPill>
            <FilterPill active={filter === 'channel'} onClick={() => setFilter('channel')}>채널 {counts.channel}</FilterPill>
            <FilterPill active={filter === 'dm'} onClick={() => setFilter('dm')}>DM {counts.dm}</FilterPill>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 메시지·사용자 검색" className="ml-auto input w-64 text-xs" />
          </div>

          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {loading && feed.length === 0 && <div className="text-center text-slate-500 py-10 text-sm">메시지 불러오는 중...</div>}
            {!loading && filtered.length === 0 && <div className="text-center text-slate-500 py-10 text-sm">메시지 없음 — 좌측에서 채널/DM을 선택하세요</div>}
            {filtered.map((m, i) => <MessageCard key={`${m.channelId}-${m.ts}-${i}`} m={m} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({ c, checked, onToggle, dim }: { c: SlackChannel; checked: boolean; onToggle: () => void; dim?: boolean }) {
  return (
    <label className={`flex items-center gap-2 p-1.5 rounded hover:bg-bg-hover/40 cursor-pointer ${dim ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="w-3 h-3" />
      <span className="text-xs text-slate-200 truncate flex-1" title={c.name}>
        {c.isIM ? '' : c.isPrivate ? '🔒 ' : '# '}
        {c.name}
      </span>
    </label>
  );
}

function MessageCard({ m }: { m: FeedItem }) {
  const ts = parseFloat(m.ts) * 1000;
  const date = new Date(ts);
  const ago = Math.round((Date.now() - ts) / 1000);
  const timeStr = ago < 60 ? `${ago}초 전` : ago < 3600 ? `${Math.round(ago / 60)}분 전` : ago < 86400 ? `${Math.round(ago / 3600)}시간 전` : date.toLocaleDateString('ko-KR');
  const kindColor = m.channelKind === 'dm' ? 'bg-accent-pink/15 text-accent-pink' : 'bg-accent-blue/15 text-accent-blue';
  return (
    <div className="p-3 rounded-lg bg-bg-deep/40 hover:bg-bg-hover/30 border border-bg-line">
      <div className="flex items-center gap-2 mb-1.5 text-[11px]">
        <span className={`chip ${kindColor}`}>{m.channelName || m.channelId}</span>
        <span className="text-slate-300 font-medium">{m.userName}</span>
        <span className="text-slate-500 ml-auto">{timeStr}</span>
        {(m.replyCount || 0) > 0 && <span className="chip bg-bg-deep text-slate-400">💬 {m.replyCount}</span>}
      </div>
      <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
        {m.text || <span className="text-slate-500 italic">(텍스트 없음 — 첨부/이미지일 수 있음)</span>}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full text-xs border ${active ? 'bg-accent-purple text-white border-accent-purple' : 'border-bg-line text-slate-300 hover:bg-bg-hover'}`}>
      {children}
    </button>
  );
}
