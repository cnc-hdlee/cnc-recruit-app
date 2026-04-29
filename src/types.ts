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

export type PageId = 'dashboard' | 'headcount' | 'pipeline' | 'calendar' | 'mail' | 'slack' | 'auto' | 'private' | 'settings' | 'usage';

export interface PrivateInterview {
  id: string;
  candidate: string;
  department: string;
  position: string;
  scheduledAt: string; // ISO datetime, empty if 미정
  location: string;
  source: string; // 볼트엑스 / 헤드헌터 / 직접 등
  status: '면접예정' | '면접완료' | '결과대기' | '오퍼' | '입사확정' | '취소' | '보류';
  notes: string;
  createdAt: string;
  updatedAt: string;
}
