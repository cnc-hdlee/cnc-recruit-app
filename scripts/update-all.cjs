/* "업데이트 해줘!" 통합 업데이트 — 외국인 RAW DATA(1CcRpw…) 전체 최신화.
 * 순서: 신규 외국인 입사자 추가 → 퇴사 반영 → 면접내용 동기화 → 합격/결원/입사 처리.
 * 대시보드/차트는 수식 자동연동이라 별도 작업 불필요.
 */
const {execSync}=require('child_process');const path=require('node:path');
const env={...process.env,NODE_PATH:path.resolve(__dirname,'..','node_modules')};
const steps=[
  ['[외국인RAW] 신규 외국인 입사자 추가','import-foreign-new.cjs'],
  ['[외국인RAW] 퇴사 반영','mark-foreign-resigned.cjs'],
  ['[외국인RAW] 면접내용 동기화(면접일·센터·유입경로)','sync-interview-info.cjs'],
  ['[외국인RAW] 합격/결원/입사 처리','mark-all-passed-hired.cjs'],
  // [제외 2026-06-16] 채용진행상황(현재)는 형도님 수동 관리로 전환 → 자동 P 갱신 중단(수동작업 보존).
  // ['[채용진행상황] 입사예정(P) 갱신','update-chaeyong-p.cjs'],
  ['[채용예정] 입사예정DB(정규+도급) 미러링 — 근무지자동·서식·에스텍 음영','mirror-recruit-planned.cjs'],
];
console.log('===== 전체 업데이트 시작 (외국인RAW + 채용진행상황) =====');
for(const [label,file] of steps){
  console.log(`\n▶ ${label} (${file})`);
  try{execSync(`node "${file}"`,{cwd:__dirname,env,stdio:'inherit'});}
  catch(e){console.error(`  ✗ ${file} 실패 — 중단`);process.exit(1);}
}
console.log('\n===== ✅ 전체 업데이트 완료 (외국인RAW 대시보드·차트, 채용진행상황 잔여/달성률 자동 반영) =====');
