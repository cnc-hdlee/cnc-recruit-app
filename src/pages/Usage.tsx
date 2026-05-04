export function Usage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <section className="card p-0 overflow-hidden border-accent-purple/30">
        <div className="px-5 py-4 bg-gradient-to-r from-accent-purple/15 via-accent-blue/10 to-transparent border-b border-bg-line">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">📖</span> 사용법
            <span className="chip bg-accent-red/20 text-accent-red text-[10px] tracking-wider">필독</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            처음 사용하시는 분, 또는 다른 팀원에게 공유 전 한 번 정독해주세요. 5분이면 충분합니다.
          </p>
        </div>

        <div className="p-5 space-y-6 text-sm leading-relaxed">
          <Block num="1" title="이 앱이 뭔가요?" tone="purple">
            <p>
              <b className="text-slate-800">CNC 채용 커맨드센터</b>는 TA팀이 매일 보는{' '}
              <b className="text-accent-blue">Google Sheets · Gmail · Calendar</b>를 한 화면에 모아주는
              데스크탑 앱이에요. 시트를 직접 열지 않아도 인원현황·미충원·면접일정·파이프라인을 실시간으로 확인할 수 있어요.
            </p>
            <ul className="mt-2 space-y-1 text-slate-600 text-[13px]">
              <li>• 시트의 숫자는 <b>1초도 차이 없이</b> 똑같이 표시됩니다 (자동 동기화 ~10초)</li>
              <li>• 데이터는 모두 본인 PC에만 저장돼요 — 외부 서버로 절대 보내지 않습니다</li>
              <li>• 2~3명이 각자 자기 PC에서 따로 설치해서 쓰면 됩니다 (계정만 본인 것으로 로그인)</li>
            </ul>
          </Block>

          <Block num="2" title="어떤 시트와 연동되나요?" tone="blue">
            <p>
              아무 시트나 연결할 수 있어요. 단, 앱이 의미를 알아야 하는 탭은{' '}
              <b className="text-accent-yellow">탭 카테고리 매핑</b>을 한 번 해주면 됩니다. 매핑 가능한 카테고리는 아래와 같아요:
            </p>
            <div className="mt-3 grid sm:grid-cols-2 gap-2">
              <KindCard label="인원현황 (TO/미충원)" kind="office_headcount" hint="예: ★전사인원현황, 부서별TO" />
              <KindCard label="입사예정자 (사무직)" kind="incoming" hint="예: 입사예정(정규직)DB" />
              <KindCard label="채용요청 관리" kind="recruit_request" hint="예: 채용요청(정규직)DB" />
              <KindCard label="정규직 채용현황 (사무직)" kind="office_pipeline" hint="이력서/면접/CPI/처우" />
              <KindCard label="면접 및 처우 현황" kind="office_interview" hint="면접일정/평가/처우협의" />
              <KindCard label="생산직 면접 내용" kind="field_pipeline" hint="생산1팀/2팀 타정·라인" />
              <KindCard label="생산입사 예정자" kind="field_incoming" hint="생산직 입사예정" />
              <KindCard label="위클리 업무 로그" kind="weekly_log" hint="주간 업무 보고용" />
            </div>
            <Note tone="green">
              <b>병합 셀·다중 헤더 OK.</b> 1행이 타이틀이고 3행에 진짜 헤더가 있어도 자동으로 찾아냅니다.
              "합계/소계/총계" 행은 자동으로 제외돼요.
            </Note>
          </Block>

          <Block num="3" title="어떻게 시트가 자동으로 업데이트되나요?" tone="green">
            <p>
              앱은 Google Drive API로 시트의 <b>마지막 수정시각(modifiedTime)</b>을 8초마다 한 번씩 체크해요.
              시각이 바뀌었을 때만 시트 본문을 다시 읽어옵니다 (변경 없으면 트래픽 0).
            </p>
            <ol className="mt-2 space-y-1 list-decimal list-inside text-slate-600 text-[13px]">
              <li>창이 켜진 상태 → 8초 간격</li>
              <li>창이 백그라운드 → 60초 간격 (배터리 절약)</li>
              <li>변경 감지 → 즉시 모든 화면이 자동 갱신 (새로고침 누를 필요 없음)</li>
            </ol>
          </Block>

          <Block num="4" title="처음 시작하기 — 4단계만" tone="yellow">
            <Step n={1} title="Google Cloud Console에서 OAuth Client 발급">
              <span className="text-slate-600">
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">console.cloud.google.com/apis/credentials</a>{' '}
                → <b>+ 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 데스크톱 앱</b> 선택. Client ID + Client Secret을 [⚙️ 설정 / 연동] 페이지의 [Google 연동] 섹션에 붙여넣기.
              </span>
              <Note tone="yellow">
                필요한 API: <code>Sheets · Drive · Gmail · Calendar</code> — 모두 "사용 설정" 누르세요. 동의 화면은 <b>Internal</b>(조직 내부) 권장.
              </Note>
            </Step>
            <Step n={2} title="Google 로그인 → 시트 URL 추가">
              인사팀 시트 URL을 그대로 복사해서 붙여넣기. 자동으로 탭 목록을 가져와요.
            </Step>
            <Step n={3} title="✨ 모든 탭 자동 매핑">
              탭 이름으로 카테고리를 자동 추천합니다. 정확하지 않으면 옆 드롭다운에서 직접 바꾸세요.
            </Step>
            <Step n={4} title="[매핑 저장 + 동기화 시작] 클릭">
              끝. 이제 시트가 바뀌면 앱이 자동으로 따라가요.
            </Step>
          </Block>

          <Block num="5" title="시트가 망가지진 않나요? — 데이터 안전성" tone="red">
            <p className="text-slate-600">
              <b className="text-accent-green">절대로</b> 앱이 시트의 셀을 수정하지 않습니다. 권한 자체가 <b>읽기 전용</b>이에요.
            </p>
            <table className="w-full mt-2 text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left py-1">대상</th>
                  <th className="text-left py-1">권한</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-line/50">
                <tr><td className="py-1.5">Google Sheets</td><td className="text-accent-green">📖 읽기 전용</td></tr>
                <tr><td className="py-1.5">Gmail</td><td className="text-accent-green">📖 읽기 전용</td></tr>
                <tr><td className="py-1.5">Google Drive (메타데이터만)</td><td className="text-accent-green">📖 수정시각만 조회</td></tr>
                <tr><td className="py-1.5">Google Calendar</td><td className="text-accent-yellow">📝 읽기 + 쓰기</td></tr>
              </tbody>
            </table>
            <Note tone="purple">
              Calendar만 쓰기 권한을 받습니다 — 면접 일정 등록·수정·삭제를 앱에서 직접 하기 위해서예요.
            </Note>
          </Block>

          <Block num="6" title="페이지별 기능 요약" tone="cyan">
            <div className="grid sm:grid-cols-2 gap-2 text-[13px]">
              <PageCard icon="🏠" name="대시보드" desc="다가오는 면접 · 최근 메일 · 알림" />
              <PageCard icon="👥" name="인원현황" desc="★전사인원현황 시트 그대로 + 본부 필터 + 미충원만 토글" />
              <PageCard icon="🎉" name="입사예정자" desc="결재 완료된 입사예정만 노란색 카드로 자동 정렬" />
              <PageCard icon="📅" name="면접 캘린더" desc="TA팀 공유 면접 캘린더 — 팀원 모두 동일하게 봄" />
              <PageCard icon="🏢" name="일자리센터" desc="수원/안성/오산/화성/용인/박람회 일정 자동 분류" />
              <PageCard icon="🔍" name="후보자 검색" desc="시트·캘린더·Gmail 통합 검색" />
              <PageCard icon="✉️" name="메일" desc="TA팀 메일 로그, 클릭 시 Gmail에서 검색해서 열기" />
            </div>
          </Block>

          <Block num="7" title="자주 묻는 질문 / 문제 해결" tone="orange">
            <Faq q="시트 숫자가 화면에 안 보여요 / 1385=1385 같은 이상한 값이 나와요">
              ⚙️ 설정에서 시트 추가 후 [매핑 저장]을 눌렀는지 확인하세요.
              그래도 이상하면 <b>본부/팀/구분</b> 같은 컬럼이 시트의 <u>3행 이상</u>에 있어도 자동 감지됩니다 — 그래도 안 되면 시트 URL을 다시 추가해보세요.
            </Faq>
            <Faq q="라이브 표시가 '대기'에서 안 변해요">
              좌측 사이드바 하단의 시트 상태와 [⚙️ 설정 → 즉시 새로고침] 한 번 눌러주세요.
              여전히 막히면 Google 로그아웃 → 로그인 재시도.
            </Faq>
            <Faq q="다른 팀원도 같이 쓰려면?">
              각자 본인 PC에 앱을 설치하고 본인 Google 계정으로 로그인하면 됩니다.
              시트 권한이 있는 사람이면 동일하게 보입니다. 데이터는 PC 간 동기화되지 않아요.
            </Faq>
            <Faq q="앱 데이터/토큰을 초기화하고 싶어요">
              Google 로그아웃 → Client 재설정, 시트 모두 삭제. 또는 OS의 사용자 디렉토리에서{' '}
              <code>cnc-recruit-config.json</code>을 삭제하세요.
            </Faq>
          </Block>

          <div className="pt-3 border-t border-bg-line/50 text-[11px] text-slate-500">
            문의 — Talent Acquisition Team · 이형도 사원
          </div>
        </div>
      </section>
    </div>
  );
}

function Block({ num, title, tone, children }: { num: string; title: string; tone: string; children: React.ReactNode }) {
  const toneMap: Record<string, string> = {
    purple: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
    blue: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
    green: 'text-accent-green bg-accent-green/10 border-accent-green/30',
    yellow: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
    red: 'text-accent-red bg-accent-red/10 border-accent-red/30',
    pink: 'text-accent-pink bg-accent-pink/10 border-accent-pink/30',
    cyan: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
    orange: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg grid place-items-center text-xs font-bold border ${toneMap[tone] || toneMap.purple}`}>
          {num}
        </span>
        <h3 className="font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="pl-9 text-slate-600 space-y-2">{children}</div>
    </div>
  );
}

function Note({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'blue' | 'purple'; children: React.ReactNode }) {
  const map = {
    green: 'border-accent-green/30 bg-accent-green/5 text-slate-600',
    yellow: 'border-accent-yellow/30 bg-accent-yellow/5 text-slate-600',
    red: 'border-accent-red/30 bg-accent-red/5 text-slate-600',
    blue: 'border-accent-blue/30 bg-accent-blue/5 text-slate-600',
    purple: 'border-accent-purple/30 bg-accent-purple/5 text-slate-600',
  } as const;
  const ico = tone === 'red' ? '⚠' : tone === 'yellow' ? '💡' : tone === 'green' ? '✓' : 'ℹ';
  return (
    <div className={`mt-2 px-3 py-2 rounded-lg border text-[12.5px] ${map[tone]}`}>
      <span className="mr-1.5">{ico}</span>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mt-2">
      <span className="shrink-0 w-6 h-6 rounded-full bg-accent-yellow/20 text-accent-yellow text-xs font-bold grid place-items-center">
        {n}
      </span>
      <div className="flex-1 text-[13px]">
        <div className="font-medium text-slate-800">{title}</div>
        <div className="text-slate-400 mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function KindCard({ label, kind, hint }: { label: string; kind: string; hint: string }) {
  return (
    <div className="rounded-lg border border-bg-line bg-bg-deep/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-800">{label}</span>
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">키: <code>{kind}</code></div>
      <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
    </div>
  );
}

function PageCard({ icon, name, desc }: { icon: string; name: string; desc: string }) {
  return (
    <div className="rounded-lg border border-bg-line bg-bg-deep/40 px-3 py-2 flex items-center gap-3">
      <span className="text-xl">{icon}</span>
      <div className="min-w-0">
        <div className="font-medium text-slate-800">{name}</div>
        <div className="text-[11px] text-slate-400 truncate">{desc}</div>
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer list-none flex items-start gap-2 text-slate-800 hover:text-accent-purple transition-colors">
        <span className="mt-0.5 text-xs text-accent-yellow group-open:rotate-90 transition-transform">▶</span>
        <span className="font-medium text-[13px]">{q}</span>
      </summary>
      <div className="ml-5 mt-1.5 text-[12.5px] text-slate-400 leading-relaxed">{children}</div>
    </details>
  );
}
