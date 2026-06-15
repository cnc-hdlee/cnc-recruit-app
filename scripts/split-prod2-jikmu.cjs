/* 대시보드 좌측 트리: 생산2팀/포장2팀의 PM·ERP를 별도 줄로 분리.
 * A~E열에만 3행 insert (우측 패널 G~L 미터치, 아래 행 상대수식/서식 자동 이동).
 * 생산2부 구간을 6줄로 재작성:
 *   생산2팀(생산직) / 생산2팀-PM / 생산2팀-ERP / 포장2팀-PM / 포장2팀-ERP / 생산2부 소계
 * 소계·총계 로직 불변(131 유지). raw 미터치.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;
const R="'RAW DATA_채용진행상황(현재)'";
const col=c=>`${R}!$${c}$3:$${c}$2001`;
const APPLY=process.argv.includes('--apply');
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

// SUMIFS 빌더: 생산2부 고정 + 추가 조건(criteria 배열)
const base=`${col('E')},"COO",${col('F')},"생산본부",${col('G')},"생산2부"`;
const S=(c,extra)=>`=SUMIFS(${col(c)},${base}${extra})`;
const teamMain=c=>S(c,`,${col('H')},"생산2팀",${col('I')},"<>PM",${col('I')},"<>ERP"`); // 생산직만
const teamJik=(c,tm,jik)=>S(c,`,${col('H')},"${tm}",${col('I')},"${jik}"`);
const silbu=c=>S(c,''); // 생산2부 소계

// 7~12행 (insert 후) 6줄
function rows(){
  const r=(label,Bf,Cf,rn)=>[label,Bf,Cf,`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];
  return [
    r('         생산2팀',        teamMain('O'),        teamMain('P'),        7),
    r('         생산2팀 - PM',   teamJik('O','생산2팀','PM'),  teamJik('P','생산2팀','PM'),  8),
    r('         생산2팀 - ERP',  teamJik('O','생산2팀','ERP'), teamJik('P','생산2팀','ERP'), 9),
    r('         포장2팀 - PM',   teamJik('O','포장2팀','PM'),  teamJik('P','포장2팀','PM'),  10),
    r('         포장2팀 - ERP',  teamJik('O','포장2팀','ERP'), teamJik('P','포장2팀','ERP'), 11),
    r('      생산2부 소계',      silbu('O'),           silbu('P'),           12),
  ];
}

async function main(){
  const s=await auth();
  const bk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A1:L90",valueRenderOption:'FORMULA'})).data.values||[];
  if(!APPLY){console.log('[DRY-RUN] insert 3행(A:E, 8행 앞) + A7:E12 재작성');rows().forEach(r=>console.log('  ',r[0].trim(),'| B=',r[1].slice(0,40)+'...'));console.log('--apply 로 적용');return;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`.backup-dashboard-${stamp}.json`),JSON.stringify(bk,null,2),'utf8');
  // 1) A~E열에만 3행 insert (0-indexed row 7~10 = 1-indexed 8행 앞)
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {insertRange:{range:{sheetId:DASH,startRowIndex:7,endRowIndex:10,startColumnIndex:0,endColumnIndex:5},shiftDimension:'ROWS'}},
  ]}});
  // 2) A7:E12 = 6줄 작성
  await s.spreadsheets.values.update({spreadsheetId:ID,range:"'대시보드'!A7:E12",valueInputOption:'USER_ENTERED',requestBody:{values:rows()}});
  console.log('적용 완료.');
  // 검증
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A5:E26",valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const C=x=>String(x==null?'':x).trim();
  console.log('생산2부 구간:');v.forEach(r=>{const a=C(r[0]);if(/생산2팀|포장2팀|생산2부|생산1|제조1|생산본부 소계|COO 소계/.test(a))console.log('  ['+a+'] '+C(r[1])+' / '+C(r[2]));});
  const h=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A2",valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('헤더:',C((h[0]||[])[0]));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
