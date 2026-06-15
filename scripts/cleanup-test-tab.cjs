/* TEST 탭 정리: 안 쓰는 컬럼 드롭다운/날짜형식 제거 + 품질경영본부→생산본부 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TEST='RAW DATA_정리본(test)';const GID=55388169;
// 안 쓰는 컬럼 인덱스 (센터C=2, 신입경력J=9, 채널K=10, 이력서링크L=11, 지원일M=12, 서류N=13, 1차결과O=14, 1차일P=15, 2차결과Q=16, 2차일R=17, CPI결과S=18, CPI일T=19, 처우결과U=20, 처우일V=21, 최종상태W=22, 탈락단계X=23, 입사예정일Y=24, 실제입사일Z=25, 현재단계AB=27)
const UNUSED=[2,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27];
const DATECOLS=[11,12,15,17,19,21,24,25];
const HQ_KEEP=['생산본부','경영기획본부','영업본부','Makeup Center','OD본부','생산기획부','Skin Science Center','크리에이티브솔루션본부','CEO 직속','People&culture실'];

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(c)=>({sheetId:GID,startRowIndex:1,endRowIndex:2000,startColumnIndex:c,endColumnIndex:c+1});

async function main(){
  const s=await auth();
  // 1) 품질경영본부 → 생산본부 (본부 B열만)
  const b=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!B2:B2000`})).data.values||[];
  let changed=0;const nb=b.map(r=>{const v=(r&&r[0])||'';if(v==='품질경영본부'){changed++;return ['생산본부'];}return [v];});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TEST}'!B2:B${1+nb.length}`,valueInputOption:'RAW',requestBody:{values:nb}});
  console.log('품질경영본부→생산본부 변경:',changed,'행');

  const reqs=[];
  // 2) 안 쓰는 컬럼 데이터검증 제거 (rule 생략 = 제거)
  UNUSED.forEach(c=>reqs.push({setDataValidation:{range:rng(c)}}));
  // 3) 날짜형식 제거 (numberFormat 클리어)
  DATECOLS.forEach(c=>reqs.push({repeatCell:{range:rng(c),cell:{userEnteredFormat:{}},fields:'userEnteredFormat.numberFormat'}}));
  // 4) 본부 드롭다운 재설정 (품질경영본부 제외)
  reqs.push({setDataValidation:{range:rng(1),rule:{condition:{type:'ONE_OF_LIST',values:HQ_KEEP.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('안쓰는 컬럼 드롭다운/날짜 제거:',UNUSED.length,'컬럼 / 본부 드롭다운 갱신');

  // 5) 대시보드 헬퍼 본부목록 갱신(품질경영 제거)
  const HROW=200;const T=c=>`'${TEST}'!$${c}$2:$${c}$2000`;
  const hq=[['본부','TO','입사예정','달성률']];
  HQ_KEEP.forEach((h,i)=>{const r=HROW+1+i;hq.push([h,`=SUMIF(${T('B')},A${r},${T('AE')})`,`=SUMIF(${T('B')},A${r},${T('AQ')})`,`=IF(B${r}=0,0,C${r}/B${r})`]);});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A200:D215"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A200',valueInputOption:'USER_ENTERED',requestBody:{values:hq}});
  console.log('대시보드 본부 집계 갱신(품질경영본부 제거,',HQ_KEEP.length,'본부)');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
