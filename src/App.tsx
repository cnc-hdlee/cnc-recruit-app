import { useEffect, useState } from 'react';
import { initLiveSync } from './store/liveData';
import { initIntegrationsSync } from './store/integrations';
import { loadOverrides } from './store/columnOverrides';
import { applyFirstRunDefaultsIfNeeded, autoTriggerLoginIfNeeded } from './lib/firstRunDefaults';
import { refreshNow } from './store/liveData';
import { IS_VIEWER } from './lib/mode';
import { useHiresSheetSync } from './lib/useHiresSheetSync';
import { useHireCalendarSync } from './lib/useHireCalendarSync';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { InstallPrompt } from './components/InstallPrompt';
import { Headcount } from './pages/Headcount';
import { IncomingHires } from './pages/IncomingHires';
import { CalendarPage } from './pages/CalendarPage';
import { InterviewInsights } from './pages/InterviewInsights';
import { RecruitFunnel } from './pages/RecruitFunnel';
import { MeetingRooms } from './pages/MeetingRooms';
import { JobCenters } from './pages/JobCenters';
import { CampusRecruiting } from './pages/CampusRecruiting';
import { CandidateLookup } from './pages/CandidateLookup';
import { EmailToolsPage } from './pages/EmailToolsPage';
import { CompetitorOrgPage, CompetitorsOverview } from './pages/Competitors';
import { OrgChartPage, OrgChartsOverview } from './pages/OrgCharts';
import { getOrgChart } from './data/orgCharts';
import { Settings } from './pages/Settings';
import { Usage } from './pages/Usage';
import type { PageId } from './types';

const PAGE_TITLES: Partial<Record<PageId, string>> = {
  headcount: '인원현황',
  orgcharts: '부서별 업무 편제표',
  incoming: '입사예정자',
  calendar: '면접 캘린더',
  insights: '면접 인사이트',
  funnel: '채용 Funnel (전형별 진행)',
  rooms: '회의실 예약',
  jobcenters: '일자리센터',
  campus: '캠퍼스 리쿠르팅',
  lookup: '후보자 검색',
  comms: '후보자 안내 메일',
  competitors: '경쟁사 조직도',
  comp_kolmar: '경쟁사 — 한국콜마',
  comp_cosmax: '경쟁사 — 코스맥스',
  settings: '설정 / 연동',
  usage: '사용법 (필독)',
};

const ORGCHART_PREFIX = 'orgchart:';

// 편제표는 부서가 계속 추가되므로 제목을 데이터에서 만든다
function pageTitle(page: PageId): string {
  if (page.startsWith(ORGCHART_PREFIX)) {
    const c = getOrgChart(page.slice(ORGCHART_PREFIX.length));
    return c ? `${c.dept} 업무 편제표` : '업무 편제표';
  }
  return PAGE_TITLES[page] || '';
}

export default function App() {
  const [page, setPage] = useState<PageId>('headcount');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 입사자 관리 시트 자동 동기화 — 어느 페이지에 있든 입사예정(정규직)DB 변경 시 자동 반영.
  useHiresSheetSync();
  // 입사예정자 → 입사 캘린더 자동 등록/취소 — 어느 페이지에 있든(입사예정자 페이지 미오픈 포함) 항상 실행.
  // 결재완료 자동 노란색 등록, 시트에서 사라지면 자동 삭제. 사용자 요청·버튼 클릭 불필요. (viewer는 내부에서 no-op)
  useHireCalendarSync();

  useEffect(() => {
    // 첫 실행: 빌드에 박힌 OAuth + 시트 기본값 자동 적용 → 로그인 필요하면 자동 OAuth → sync 시작
    (async () => {
      try {
        const { needsLogin } = await applyFirstRunDefaultsIfNeeded();
        await initLiveSync();
        if (needsLogin) {
          // 첫 실행이면 자동으로 OAuth 팝업 (브라우저 열림)
          const ok = await autoTriggerLoginIfNeeded(true);
          if (ok) {
            // 로그인 성공 → 시트 즉시 가져오기
            await refreshNow();
          }
        }
      } catch {
        // non-fatal — 사용자가 수동으로 ⚙️ 설정에서 로그인하면 됨
      }
    })();
    if (!IS_VIEWER) initIntegrationsSync().catch(() => {});
    loadOverrides().catch(() => {});
  }, []);

  const handlePageChange = (p: PageId) => {
    setPage(p);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar
        active={page}
        onChange={handlePageChange}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={pageTitle(page)} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-4 md:p-6 animate-fade-in">
          {page === 'headcount' && <Headcount />}
          {page === 'orgcharts' && (
            <OrgChartsOverview onOpen={(id) => setPage(`orgchart:${id}`)} />
          )}
          {page.startsWith(ORGCHART_PREFIX) && (
            <OrgChartPage deptId={page.slice(ORGCHART_PREFIX.length)} />
          )}
          {page === 'incoming' && <IncomingHires />}
          {page === 'calendar' && <CalendarPage />}
          {page === 'insights' && <InterviewInsights />}
          {page === 'funnel' && <RecruitFunnel />}
          {page === 'rooms' && <MeetingRooms />}
          {page === 'jobcenters' && <JobCenters />}
          {page === 'campus' && <CampusRecruiting />}
          {page === 'lookup' && <CandidateLookup />}
          {page === 'comms' && <EmailToolsPage />}
          {page === 'competitors' && <CompetitorsOverview onOpen={(id) => setPage(id === 'kolmar' ? 'comp_kolmar' : 'comp_cosmax')} />}
          {page === 'comp_kolmar' && <CompetitorOrgPage companyId="kolmar" />}
          {page === 'comp_cosmax' && <CompetitorOrgPage companyId="cosmax" />}
          {page === 'settings' && <Settings />}
          {page === 'usage' && <Usage />}
        </main>
      </div>
      <InstallPrompt />
    </div>
  );
}
