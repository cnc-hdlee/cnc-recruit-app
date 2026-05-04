import { useEffect, useState } from 'react';
import { initLiveSync } from './store/liveData';
import { initIntegrationsSync } from './store/integrations';
import { loadOverrides } from './store/columnOverrides';
import { applyFirstRunDefaultsIfNeeded, autoTriggerLoginIfNeeded } from './lib/firstRunDefaults';
import { refreshNow } from './store/liveData';
import { IS_VIEWER } from './lib/mode';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './pages/Dashboard';
import { Headcount } from './pages/Headcount';
import { IncomingHires } from './pages/IncomingHires';
import { RecruitAlerts } from './pages/RecruitAlerts';
import { CalendarPage } from './pages/CalendarPage';
import { JobCenters } from './pages/JobCenters';
import { CandidateLookup } from './pages/CandidateLookup';
import { MailLog } from './pages/MailLog';
import { Settings } from './pages/Settings';
import { Usage } from './pages/Usage';
import type { PageId } from './types';

const PAGE_TITLES: Record<PageId, string> = {
  dashboard: '대시보드',
  headcount: '인원현황',
  incoming: '입사예정자',
  alerts: '채용 알림',
  calendar: '면접 캘린더',
  jobcenters: '일자리센터',
  lookup: '후보자 검색',
  mail: '메일 / 커뮤니케이션',
  settings: '설정 / 연동',
  usage: '사용법 (필독)',
};

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard');

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar active={page} onChange={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={PAGE_TITLES[page]} />
        <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'headcount' && <Headcount />}
          {page === 'incoming' && <IncomingHires />}
          {page === 'alerts' && <RecruitAlerts />}
          {page === 'calendar' && <CalendarPage />}
          {page === 'jobcenters' && <JobCenters />}
          {page === 'lookup' && <CandidateLookup />}
          {page === 'mail' && <MailLog />}
          {page === 'settings' && <Settings />}
          {page === 'usage' && <Usage />}
        </main>
      </div>
    </div>
  );
}
