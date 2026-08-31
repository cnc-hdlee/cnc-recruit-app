export interface ProdTORow {
  site: string;
  team: string;
  type: string;
  to: number;
  current: number;
  need: number;
  request: number;
  incoming: number;
  note: string;
}

export interface ScreeningTask {
  nm: string;
  dept: string;
  job: string;
  stage: string;
  action: string;
}

export interface DeptNotify {
  nm: string;
  dt: string;
  team: string;
  items: string;
  st: string;
  note: string;
}

export interface MissingAlert {
  icon: string;
  title: string;
  desc: string;
  priority: 'high' | 'medium' | 'low' | string;
}

export interface OfficeIntv {
  no: number;
  dept: string;
  type: string;
  nm: string;
  note: string;
  stage: string;
  maxStage: string;
}

export interface FieldIntvRecent {
  src: string;
  dt: string;
  job: string;
  nm: string;
  gender: string;
  age: number;
  site: string;
  avail: string;
  st: string;
}

export interface CalEvent {
  dt: string;
  tm: string;
  title: string;
  done?: boolean;
}

export interface TeamMail {
  dt: string;
  from: string;
  type: string;
  subj: string;
  to: string;
  sum: string;
}

export interface DataShape {
  prodTO: ProdTORow[];
  screeningTasks: ScreeningTask[];
  deptNotify: DeptNotify[];
  missingAlerts: MissingAlert[];
  officeIntv: OfficeIntv[];
  fieldIntvRecent: FieldIntvRecent[];
  calIntv: CalEvent[];
  calJoin: CalEvent[];
  calLeave: CalEvent[];
  teamMail: TeamMail[];
  [k: string]: unknown;
}

// 편제표는 부서가 계속 늘어나므로 'orgchart:<부서id>' 형태로 열어둔다.
// 부서를 추가할 때 이 타입을 고칠 필요가 없다 (src/data/orgCharts.ts 에만 추가).
export type PageId =
  | 'headcount'
  | 'orgcharts'
  | `orgchart:${string}`
  | 'incoming'
  | 'calendar'
  | 'insights'
  | 'funnel'
  | 'rooms'
  | 'jobcenters'
  | 'campus'
  | 'lookup'
  | 'comms'
  | 'competitors'
  | 'comp_kolmar'
  | 'comp_cosmax'
  | 'settings'
  | 'usage';
