import { useMemo, useState } from 'react';
import { useData } from '../store';
import { useLiveData, liveByKind } from '../store/liveData';
import {
  ALL_PIPELINES,
  OFFICE_JUNIOR,
  OFFICE_SENIOR,
  OFFICE_EXEC,
  FIELD_PRODUCTION,
  type PipelineDef,
  PIPELINE_TONE_CLASSES,
  PIPELINE_TONE_BG,
  inferStageId,
} from '../lib/pipelines';
import { pickField } from '../lib/sheetMapping';

interface CandidateRow {
  nm: string;
  dept: string;
  job: string;
  rank?: string;
  stageId: string;
  stageRaw: string;
  note?: string;
  source: 'sheet' | 'static';
}

export function Pipeline() {
  const live = useLiveData();
  const D = useData();
  const [pipelineId, setPipelineId] = useState<string>(OFFICE_JUNIOR.id);
  const pipeline = ALL_PIPELINES.find((p) => p.id === pipelineId) || OFFICE_JUNIOR;

  const candidates: CandidateRow[] = useMemo(() => {
    try {
      if (pipeline.group === 'office') return officeCandidates(pipeline, live, D);
      return fieldCandidates(pipeline, live, D);
    } catch (e) {
      console.error('[Pipeline] candidate extraction failed:', e);
      return [];
    }
    // intentionally depend only on stable signals to avoid flicker on every sync tick
  }, [pipeline, live.hasLive, live.snapshots, live.mappings, D]);

  // 매핑된 탭에서 단계/상태 컬럼이 없으면 잘못된 매핑 가능성 (예: 재직자DB)
  const mappingWarning = useMemo(() => {
    if (!live.hasLive) return null;
    try {
      const kind = pipeline.group === 'office' ? ['office_pipeline', 'office_interview'] : ['field_pipeline'];
      const totalRows = kind.reduce((acc, k) => acc + liveByKind(k as any).length, 0);
      if (totalRows > 0 && candidates.length === 0) {
        return `시트에 ${totalRows}건이 있지만 "단계/상태/결과" 컬럼이 없어요. ⚙️ 설정에서 채용 후보자 시트가 아닌 탭(예: 정규직DB·도급직DB 같은 재직자 DB)이 매핑돼있는지 확인하세요.`;
      }
    } catch (e) {
      console.error('[Pipeline] mapping warning check failed:', e);
    }
    return null;
  }, [live.hasLive, live.snapshots, live.mappings, pipeline, candidates.length]);

  const grouped = useMemo(() => {
    const g: Record<string, CandidateRow[]> = {};
    pipeline.stages.forEach((s) => (g[s.id] = []));
    candidates.forEach((c) => {
      const id = c.stageId in g ? c.stageId : pipeline.stages[0].id;
      g[id].push(c);
    });
    return g;
  }, [candidates, pipeline]);

  return (
    <div className="space-y-4">
      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <PipelineTab onClick={() => setPipelineId(OFFICE_JUNIOR.id)} active={pipelineId === OFFICE_JUNIOR.id} group="office">
            🎯 신입 (사원·주임)
          </PipelineTab>
          <PipelineTab onClick={() => setPipelineId(OFFICE_SENIOR.id)} active={pipelineId === OFFICE_SENIOR.id} group="office">
            🎓 경력 (대리급↑)
          </PipelineTab>
          <PipelineTab onClick={() => setPipelineId(OFFICE_EXEC.id)} active={pipelineId === OFFICE_EXEC.id} group="office">
            👔 임원 (잠정)
          </PipelineTab>
          <span className="mx-1 h-6 w-px bg-bg-line" />
          <PipelineTab onClick={() => setPipelineId(FIELD_PRODUCTION.id)} active={pipelineId === FIELD_PRODUCTION.id} group="field">
            🏭 현장직 (생산직 1차→합격/불합격)
          </PipelineTab>
          <div className="ml-auto text-xs text-slate-400">총 {candidates.length}명 · {live.hasLive ? '시트 연동' : '정적 스냅샷'}</div>
        </div>
        <div className="text-xs text-slate-400 px-1">{pipeline.description}</div>
      </div>

      <div
        className="grid gap-3 overflow-x-auto pb-2"
        style={{ gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(190px, 1fr))` }}
      >
        {pipeline.stages.map((stage) => (
          <div
            key={stage.id}
            className={`rounded-xl bg-bg-card/50 border ${PIPELINE_TONE_CLASSES[stage.tone]} flex flex-col min-h-[460px]`}
          >
            <div className="px-3 py-2 border-b border-bg-line flex items-center justify-between sticky top-0 bg-bg-card/80 backdrop-blur rounded-t-xl">
              <div>
                <div className="text-xs font-semibold text-slate-200">{stage.label}</div>
                {stage.hint && <div className="text-[10px] text-slate-500 mt-0.5">{stage.hint}</div>}
              </div>
              <span className={`chip ${PIPELINE_TONE_BG[stage.tone]}`}>{grouped[stage.id]?.length || 0}</span>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto flex-1">
              {(grouped[stage.id] || []).map((c, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-bg-deep/60 border border-bg-line hover:border-accent-purple/50 animate-slide-up">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm">{c.nm}</div>
                    {c.rank && <span className="chip bg-accent-yellow/15 text-accent-yellow text-[10px]">{c.rank}</span>}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {c.dept}
                    {c.job ? ` · ${c.job}` : ''}
                  </div>
                  {c.note && <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{c.note}</div>}
                  <div className="mt-1.5 flex items-center justify-between text-[10px]">
                    <span className="text-slate-600">{c.source === 'sheet' ? '📊 시트' : '📦 캐시'}</span>
                    {c.stageRaw && c.stageRaw !== stage.label && (
                      <span className="text-slate-500" title="시트 원본 단계 표기">"{c.stageRaw}"</span>
                    )}
                  </div>
                </div>
              ))}
              {(grouped[stage.id] || []).length === 0 && (
                <div className="text-[11px] text-slate-600 text-center py-4">없음</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {mappingWarning && (
        <div className="card border-accent-red/40 bg-accent-red/5 p-4 text-sm text-accent-red">
          ⚠ {mappingWarning}
        </div>
      )}
      {!live.hasLive && (
        <div className="card border-accent-yellow/40 bg-accent-yellow/5 p-4 text-sm text-accent-yellow">
          ⚠ 아직 시트에 연결되지 않았습니다. 표시 중인 데이터는 정적 스냅샷입니다. 정확한 숫자를 원하시면 ⚙️ 설정 / 연동에서 시트를 연결하세요.
        </div>
      )}
    </div>
  );
}

function officeCandidates(pipeline: PipelineDef, live: ReturnType<typeof useLiveData>, D: ReturnType<typeof useData>): CandidateRow[] {
  if (live.hasLive) {
    const fromPipelineTab = liveByKind('office_pipeline');
    const fromIntvTab = liveByKind('office_interview');
    const merged = [...fromPipelineTab, ...fromIntvTab];
    if (merged.length) {
      // 후보자 시트는 단계/상태 컬럼이 있어야 함. 없으면 재직자 DB 같은 잘못 매핑된 탭이므로 무시.
      const hasStageColumn = merged.some((row) =>
        Object.keys(row).some((k) => /단계|진행|상태|stage|status|결과/i.test(k))
      );
      if (!hasStageColumn) return [];

      const out = merged.map((row) => {
        const nm = pickField(row, ['이름', '성명', '후보자', '지원자']);
        const dept = pickField(row, ['부서', '팀', '소속']);
        const job = pickField(row, ['직무', '직군', '포지션', '담당']);
        const rank = pickField(row, ['직급', '직책', '레벨']);
        const stageRaw = pickField(row, ['단계', '진행', '상태', 'stage', 'status', '결과']);
        const note = pickField(row, ['비고', '메모', '특이사항', 'action', 'note']);
        return {
          nm: nm || '-',
          dept,
          job,
          rank,
          stageRaw,
          stageId: stageRaw ? inferStageId(pipeline, stageRaw) : '',
          note,
          source: 'sheet' as const,
        };
      });
      // 이름 + 단계 둘 다 있는 후보만 — 단계 비어있으면 재직자/예약자라서 제외
      return out.filter((c) => c.nm !== '-' && c.stageRaw && c.stageId);
    }
  }
  // Fallback: static D.screeningTasks
  return D.screeningTasks.map((t) => ({
    nm: t.nm,
    dept: t.dept,
    job: t.job,
    stageRaw: t.stage,
    stageId: inferStageId(pipeline, t.stage),
    note: t.action,
    source: 'static' as const,
  }));
}

function fieldCandidates(pipeline: PipelineDef, live: ReturnType<typeof useLiveData>, D: ReturnType<typeof useData>): CandidateRow[] {
  if (live.hasLive) {
    const fromTab = liveByKind('field_pipeline');
    if (fromTab.length) {
      const hasStageColumn = fromTab.some((row) =>
        Object.keys(row).some((k) => /단계|진행|상태|stage|status|결과/i.test(k))
      );
      if (!hasStageColumn) return [];

      const out = fromTab.map((row) => {
        const nm = pickField(row, ['이름', '성명', '지원자']);
        const dept = pickField(row, ['팀', '부서', '직군', '사업장']);
        const job = pickField(row, ['직무', '포지션', 'job']);
        const stageRaw = pickField(row, ['상태', '결과', 'stage', 'status', 'st']);
        const note = pickField(row, ['비고', '메모', '소스', 'src']);
        return {
          nm: nm || '-',
          dept,
          job,
          stageRaw,
          stageId: stageRaw ? inferStageId(pipeline, stageRaw) : '',
          note,
          source: 'sheet' as const,
        };
      });
      return out.filter((c) => c.nm !== '-' && c.stageRaw && c.stageId);
    }
  }
  return D.fieldIntvRecent.map((r) => ({
    nm: r.nm,
    dept: r.site,
    job: r.job,
    stageRaw: r.st,
    stageId: inferStageId(pipeline, r.st),
    note: `${r.src} · ${r.dt}`,
    source: 'static' as const,
  }));
}

function PipelineTab({
  onClick,
  active,
  group,
  children,
}: {
  onClick: () => void;
  active: boolean;
  group: 'office' | 'field';
  children: React.ReactNode;
}) {
  const tone = group === 'office' ? 'accent-purple' : 'accent-green';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm border transition ${
        active
          ? `bg-${tone}/15 text-${tone === 'accent-purple' ? 'white' : 'white'} border-${tone}/60 shadow-glow`
          : 'border-bg-line text-slate-300 hover:bg-bg-hover/50'
      }`}
    >
      {children}
    </button>
  );
}
