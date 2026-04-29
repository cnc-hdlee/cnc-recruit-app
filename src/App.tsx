import { useEffect, useState } from 'react';
import { initLiveSync } from './store/liveData';
import { initIntegrationsSync } from './store/integrations';
import { loadOverrides } from './store/columnOverrides';
import { IS_VIEWER } from './lib/mode';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './pages/Dashboard';
import { Headcount } from './pages/Headcount';
import { Pipeline } from './pages/Pipeline';
import { CalendarPage } from './pages/CalendarPage';
import { MailLog } from './pages/MailLog';
import { SlackFeed } from './pages/SlackFeed';
import { Settings } from './pages/Settings';
import { Usage } from './pages/Usage';
import { AutoAnalysis } from './pages/AutoAnalysis';
import { PrivateTracker } from './pages/PrivateTracker';
import type { PageId } from './types';

const PAGE_TITLES: Record<PageId, string> = {
  dashboard: '대시보드',
  headcount: '인원현황',
  pipeline: '채용 파이프라인',
  calendar: '면접 캘린더',
  mail: '메일 / 커뮤니케이션',
  slack: 'Slack 피드',
  auto: '🔗 자동 분석',
  private: '🔒 비공개 트래커',
  settings: '설정 / 연동',
  usage: '사용법 (필독)',
};

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard');

  useEffect(() => {
    initLiveSync().catch(() => {});
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
          {page === 'pipeline' && <Pipeline />}
          {page === 'calendar' && <CalendarPage />}
          {page === 'mail' && <MailLog />}
          {page === 'slack' && <SlackFeed />}
          {page === 'auto' && <AutoAnalysis />}
          {page === 'private' && !IS_VIEWER && <PrivateTracker />}
          {page === 'settings' && <Settings />}
          {page === 'usage' && <Usage />}
        </main>
      </div>
    </div>
  );
}
