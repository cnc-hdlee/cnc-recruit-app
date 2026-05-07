// 채용 교육 / 세미나 / 컨퍼런스 일정 모음 페이지.
// 캘린더 등록 안 함 — 정보 조회 전용. 외부 링크 클릭 시 브라우저로 열림.
// 데이터는 마지막 검색 시점의 정적 카드 (사용자가 신규 일정 알려주면 카드 추가).

interface SeminarCard {
  title: string;
  host: string;
  date: string; // 표시용 (예: "2026-05-13", "상시", "TBD")
  location: string; // 온라인/오프라인
  url: string;
  tag: 'report' | 'platform' | 'event';
  desc?: string;
}

// 2026-05-06 검색 기준 — 채용 한정 큐레이션
const CARDS: SeminarCard[] = [
  // 트렌드 리포트 (정기 발간)
  {
    title: '2026 HR Trend Report — 컬처핏을 넘어 팀핏으로',
    host: '원티드',
    date: '2026 발간',
    location: '온라인 PDF',
    url: 'https://blog.wantedlab.com/hr/report/hr-trend-report-2026',
    tag: 'report',
    desc: '팀핏(Team-Fit) 검증, 인재밀도 강조',
  },
  {
    title: '2026 채용 트렌드 리포트',
    host: '캐치 (CATCH)',
    date: '2026 발간',
    location: '온라인',
    url: 'https://www.catch.co.kr/News/RecruitNews/297121',
    tag: 'report',
    desc: '인재밀도·검증된 경험·타깃 기반 채용',
  },
  {
    title: '2026 AI 채용 전략 리포트',
    host: '그리팅 (Greeting HR)',
    date: '2026 발간',
    location: '온라인',
    url: 'https://www.greetinghr.com/guidebooks/2026-ai-ta-strategy-report',
    tag: 'report',
    desc: 'AI 도구를 활용한 채용 자동화 전략',
  },
  {
    title: '2026 HRD Trend Report',
    host: '한국생산성본부 (KPC)',
    date: '2026 발간',
    location: 'PDF 다운로드',
    url: 'https://www.kpc.or.kr/download/pt/KPC2026HRDTrendReport.pdf',
    tag: 'report',
    desc: '리스킬링·업스킬링, 스킬 기반 HRD, 생성형 AI',
  },
  // 정기 행사 플랫폼 (수시 갱신, 본인이 직접 확인)
  {
    title: '이벤터스 — 강연/세미나',
    host: 'event-us.kr',
    date: '상시',
    location: '온/오프라인',
    url: 'https://event-us.kr/search?eventtype=%EA%B0%95%EC%97%B0/%EC%84%B8%EB%AF%B8%EB%82%98',
    tag: 'platform',
    desc: 'HR/채용 키워드로 검색',
  },
  {
    title: '온오프믹스 — 컨퍼런스/포럼',
    host: 'onoffmix.com',
    date: '상시',
    location: '온/오프라인',
    url: 'https://onoffmix.com/event?c=104',
    tag: 'platform',
    desc: '실무자 모임 + 채용 트렌드 포럼',
  },
  {
    title: '코엑스 행사 일정',
    host: 'coex.co.kr',
    date: '상시',
    location: '서울 코엑스',
    url: 'https://www.coex.co.kr/event/full-schedules/',
    tag: 'platform',
    desc: '대형 채용박람회·HR Tech 컨퍼런스',
  },
  {
    title: '잡815 — 채용박람회',
    host: 'job815.com',
    date: '상시',
    location: '전국',
    url: 'https://www.job815.com/',
    tag: 'platform',
    desc: '지역별 채용박람회 일정',
  },
  {
    title: '컨퍼런스 — 전자신문',
    host: 'etnews.com',
    date: '상시',
    location: '주로 서울',
    url: 'https://conference.etnews.com/',
    tag: 'platform',
    desc: 'HR Tech / AI 채용 관련 컨퍼런스',
  },
  {
    title: '기업마당 — 행사정보',
    host: 'bizinfo.go.kr',
    date: '상시',
    location: '전국',
    url: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C127/AX/210/list.do',
    tag: 'platform',
    desc: '정부지원 채용 관련 행사',
  },
];

const TAG_META: Record<SeminarCard['tag'], { label: string; tone: string }> = {
  report: { label: '📄 리포트', tone: 'bg-violet-100 text-violet-700 border-violet-200' },
  platform: { label: '🌐 플랫폼', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  event: { label: '🎤 행사', tone: 'bg-amber-100 text-amber-800 border-amber-200' },
};

export function EducationPage() {
  const reports = CARDS.filter((c) => c.tag === 'report');
  const events = CARDS.filter((c) => c.tag === 'event');
  const platforms = CARDS.filter((c) => c.tag === 'platform');

  return (
    <div className="space-y-4">
      {/* 안내 */}
      <div className="card p-4 bg-gradient-to-r from-indigo-50 to-violet-50 border-indigo-200">
        <div className="text-sm font-bold text-indigo-900">📚 채용 교육 / 세미나 / 컨퍼런스</div>
        <div className="mt-1 text-xs text-indigo-800/80 leading-relaxed">
          채용 한정 큐레이션. 카드를 클릭하면 외부 사이트가 새 창으로 열립니다.
          <br />
          신규 일정을 발견하셨거나 추가하고 싶은 항목이 있으면 알려주세요 — 카드로 추가합니다.
        </div>
      </div>

      {/* 다가오는 행사 */}
      {events.length > 0 && (
        <Section title="🎤 다가오는 행사" cards={events} />
      )}

      {/* 트렌드 리포트 */}
      <Section title="📄 채용 트렌드 리포트 (2026)" cards={reports} />

      {/* 정기 플랫폼 */}
      <Section title="🌐 정기 행사 플랫폼" cards={platforms} />

      <div className="card p-3 bg-slate-50 border-slate-200">
        <div className="text-[11px] text-slate-600 leading-relaxed">
          <span className="font-bold">📌 데이터 출처</span> — 2026-05-06 검색 기준. 자동 갱신 X.
          채용 한정으로 노무사·HR 일반 교육은 포함하지 않음.
          <br />
          <span className="font-bold">캘린더 등록</span> — 본 페이지는 정보 조회 전용. 캘린더에 안 들어감.
        </div>
      </div>
    </div>
  );
}

function Section({ title, cards }: { title: string; cards: SeminarCard[] }) {
  return (
    <div>
      <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {cards.map((c) => (
          <Card key={c.url} card={c} />
        ))}
      </div>
    </div>
  );
}

function Card({ card }: { card: SeminarCard }) {
  const meta = TAG_META[card.tag];
  return (
    <a
      href={card.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-3 hover:shadow-md hover:border-indigo-300 transition-all block group"
    >
      <div className="flex items-start gap-2">
        <span className={`chip text-[10px] font-bold border ${meta.tone}`}>{meta.label}</span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono">{card.date}</span>
      </div>
      <div className="mt-2 text-sm font-bold text-slate-900 leading-snug group-hover:text-indigo-700">
        {card.title}
      </div>
      <div className="mt-1 text-[11px] text-slate-600">
        <span className="font-semibold">{card.host}</span>
        <span className="text-slate-400"> · {card.location}</span>
      </div>
      {card.desc && (
        <div className="mt-1.5 text-[11px] text-slate-500 line-clamp-2">{card.desc}</div>
      )}
      <div className="mt-2 text-[10px] text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
        외부 링크 열기 →
      </div>
    </a>
  );
}
