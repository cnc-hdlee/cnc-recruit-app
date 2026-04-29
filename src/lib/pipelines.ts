// Pipeline definitions per candidate track.
// Source of truth: user-described business process (2026-04-29 conversation).

export interface Stage {
  id: string;
  label: string;
  hint?: string;
  // Color tone hint for UI
  tone: 'gray' | 'cyan' | 'blue' | 'purple' | 'pink' | 'yellow' | 'green' | 'red';
}

export interface PipelineDef {
  id: string;
  label: string;
  group: 'office' | 'field';
  description: string;
  stages: Stage[];
}

const COMMON_FAIL: Stage[] = [
  { id: 'reject', label: '불합격', tone: 'red' },
  { id: 'hold', label: '보류', tone: 'gray' },
  { id: 'cancel', label: '지원취소/불참', tone: 'gray' },
];

// Office — 사원/주임 (1차 면접만)
export const OFFICE_JUNIOR: PipelineDef = {
  id: 'office_junior',
  label: '사무직 · 신입(사원·주임)',
  group: 'office',
  description: '1차 면접 후 CPI → 처우협의 → 채용품의 → 결재 → 입사안내',
  stages: [
    { id: 'resume_review', label: '이력서검토', tone: 'cyan' },
    { id: 'biz_review', label: '현업 검토', hint: '현업 부서 OK 확인', tone: 'cyan' },
    { id: 'pre_q', label: '사전질문지 전달', tone: 'blue' },
    { id: 'intv_set', label: '면접 확정', hint: '장소·일시 확정', tone: 'blue' },
    { id: 'intv_1', label: '1차 면접', tone: 'purple' },
    { id: 'cpi', label: 'CPI 검사', tone: 'pink' },
    { id: 'comp', label: '처우협의', tone: 'yellow' },
    { id: 'apr_draft', label: '채용품의 기안', tone: 'yellow' },
    { id: 'apr_done', label: '결재 완료', tone: 'green' },
    { id: 'onboard', label: '입사안내(Gmail)', tone: 'green' },
    ...COMMON_FAIL,
  ],
};

// Office — 대리급↑ (1차 + 2차)
export const OFFICE_SENIOR: PipelineDef = {
  id: 'office_senior',
  label: '사무직 · 경력(대리급↑)',
  group: 'office',
  description: '1차 + 2차 면접 후 CPI → 처우협의 → 결재 → 입사안내',
  stages: [
    { id: 'resume_review', label: '이력서검토', tone: 'cyan' },
    { id: 'biz_review', label: '현업 검토', tone: 'cyan' },
    { id: 'pre_q', label: '사전질문지 전달', tone: 'blue' },
    { id: 'intv_set', label: '면접 확정', tone: 'blue' },
    { id: 'intv_1', label: '1차 면접', tone: 'purple' },
    { id: 'intv_2', label: '2차 면접', tone: 'purple' },
    { id: 'cpi', label: 'CPI 검사', tone: 'pink' },
    { id: 'comp', label: '처우협의', tone: 'yellow' },
    { id: 'apr_draft', label: '채용품의 기안', tone: 'yellow' },
    { id: 'apr_done', label: '결재 완료', tone: 'green' },
    { id: 'onboard', label: '입사안내(Gmail)', tone: 'green' },
    ...COMMON_FAIL,
  ],
};

// Office — 임원 (잠정 — 사용자 확인 필요)
export const OFFICE_EXEC: PipelineDef = {
  id: 'office_exec',
  label: '사무직 · 임원 (잠정)',
  group: 'office',
  description: '단계 미확정 — 추후 사용자 확인 후 조정',
  stages: [
    { id: 'resume_review', label: '이력서검토', tone: 'cyan' },
    { id: 'biz_review', label: '현업/경영진 검토', tone: 'cyan' },
    { id: 'intv_1', label: '1차 면접', tone: 'purple' },
    { id: 'intv_2', label: '2차 면접', tone: 'purple' },
    { id: 'intv_3', label: '3차/이사회', tone: 'purple' },
    { id: 'comp', label: '처우협의', tone: 'yellow' },
    { id: 'apr_done', label: '결재 완료', tone: 'green' },
    { id: 'onboard', label: '입사안내', tone: 'green' },
    ...COMMON_FAIL,
  ],
};

// Field — 생산1팀·생산2팀 (타정·라인근무)
// 1차 면접 → 합격/불합격 통보 → 입사. 중간 단계 없음.
export const FIELD_PRODUCTION: PipelineDef = {
  id: 'field_production',
  label: '현장직 · 생산직(타정·라인)',
  group: 'field',
  description: '1차 면접 → 합격/불합격 통보 → 입사. 중간 단계 없음.',
  stages: [
    { id: 'applied', label: '지원접수', tone: 'cyan' },
    { id: 'intv_set', label: '면접 확정', tone: 'blue' },
    { id: 'intv_1', label: '1차 면접', tone: 'purple' },
    { id: 'pass', label: '합격', tone: 'green' },
    { id: 'onboard', label: '입사', tone: 'green' },
    { id: 'reject', label: '불합격', tone: 'red' },
    { id: 'hold', label: '보류', tone: 'gray' },
    { id: 'cancel', label: '지원취소/불참', tone: 'gray' },
  ],
};

export const ALL_PIPELINES: PipelineDef[] = [OFFICE_JUNIOR, OFFICE_SENIOR, OFFICE_EXEC, FIELD_PRODUCTION];

export function getPipeline(id: string): PipelineDef | undefined {
  return ALL_PIPELINES.find((p) => p.id === id);
}

export const PIPELINE_TONE_CLASSES: Record<Stage['tone'], string> = {
  gray: 'border-slate-500/40',
  cyan: 'border-accent-cyan/40',
  blue: 'border-accent-blue/50',
  purple: 'border-accent-purple/50',
  pink: 'border-accent-pink/50',
  yellow: 'border-accent-yellow/50',
  green: 'border-accent-green/60',
  red: 'border-accent-red/50',
};

export const PIPELINE_TONE_BG: Record<Stage['tone'], string> = {
  gray: 'bg-slate-500/15 text-slate-300',
  cyan: 'bg-accent-cyan/15 text-accent-cyan',
  blue: 'bg-accent-blue/15 text-accent-blue',
  purple: 'bg-accent-purple/15 text-accent-purple',
  pink: 'bg-accent-pink/15 text-accent-pink',
  yellow: 'bg-accent-yellow/15 text-accent-yellow',
  green: 'bg-accent-green/15 text-accent-green',
  red: 'bg-accent-red/15 text-accent-red',
};

// Heuristic: map free-text stage strings (from sheet) to stage id.
export function inferStageId(pipeline: PipelineDef, raw: string): string {
  const s = (raw || '').trim();
  if (!s) return pipeline.stages[0].id;
  const lower = s.toLowerCase();
  if (s.includes('이력서')) return findStage(pipeline, 'resume_review');
  if (s.includes('현업')) return findStage(pipeline, 'biz_review');
  if (s.includes('사전질문')) return findStage(pipeline, 'pre_q');
  if (s.includes('CPI') || lower.includes('cpi')) return findStage(pipeline, 'cpi');
  if (s.includes('처우')) return findStage(pipeline, 'comp');
  if (s.includes('품의')) return findStage(pipeline, 'apr_draft');
  if (s === '결재완료' || s === '결재 완료') return findStage(pipeline, 'apr_done');
  if (s.includes('입사안내') || s.includes('입사 안내')) return findStage(pipeline, 'onboard');
  if (s === '입사' || s === '최종입사') return findStage(pipeline, 'onboard');
  if (s.includes('2차') && s.includes('완료')) return findStage(pipeline, 'intv_2');
  if (s.includes('1차') && s.includes('완료')) return findStage(pipeline, 'intv_1');
  if (s === '2차') return findStage(pipeline, 'intv_2');
  if (s === '1차') return findStage(pipeline, 'intv_1');
  if (s.includes('면접 예정') || s.includes('1차 예정')) return findStage(pipeline, 'intv_set');
  if (s === '합격') return findStage(pipeline, 'pass') || findStage(pipeline, 'apr_done');
  if (s === '불합격' || s === '불참') return 'reject';
  if (s === '보류') return 'hold';
  if (s.includes('취소') || s.includes('포기')) return 'cancel';
  return pipeline.stages[0].id;
}

function findStage(pipeline: PipelineDef, want: string): string {
  return pipeline.stages.find((s) => s.id === want)?.id || pipeline.stages[0].id;
}
