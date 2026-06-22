/* RAW DATA 라벨을 DB에 통일 (DB 기준) + 대시보드 트리 SCM 줄 동기화.
 * RAW: R25 팀 생산운영팀→생산기획부 · R65 팀 (빈칸)→"-" · R58 직무 총괄→팀원
 * 트리 R30(SCM): 팀 기준 생산운영팀→생산기획부 + 라벨 변경. (숫자는 IMPORTRANGE라 불변)
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',REQ='RAW DATA_채용진행상황(현재)';
const R=`'RAW DATA_채용진행상황(현재)'`;
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const sif=(col,team)=>`=SUMIFS(${R}!$${col}$3:$${col}$2002,${R}!$E$3:$E$2002,"COO",${R}!$F$3:$F$2002,"생산본부",${R}!$G$3:$G$2002,"생산기획부",${R}!$H$3:$H$2002,"${team}",${R}!$I$3:$I$2002,"SCM")`;
async function main(){
  const s=await auth();
  // 1) RAW 라벨 3개 (DB에 통일)
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'RAW',data:[
    {range:`${REQ}!H25`,values:[['생산기획부']]},   // SCM 팀
    {range:`${REQ}!H65`,values:[['-']]},            // 영상편집 팀
    {range:`${REQ}!I58`,values:[['팀원']]},         // People Ops 직무
  ]}});
  // 2) 트리 R30 SCM: 라벨 + 팀 기준 생산기획부
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!A30:C30`,valueInputOption:'USER_ENTERED',requestBody:{values:[[
    '         생산기획부 - SCM', sif('O','생산기획부'), sif('P','생산기획부')]]}});
  console.log('✅ RAW 라벨 3개 + 트리 SCM 줄 동기화');
  // 검증
  const rv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!E4:P90`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  rv.forEach((r,i)=>{const H=C(r[7]),I=C(r[8]);if(/scm/i.test(I)||/영상/.test(I)||/people ops/i.test(H))console.log(`  RAW R${i+4}: 팀[${H}] 직무[${I}] O${C(r[14])} P${C(r[15])}`);});
  const t=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!A30:E31`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('  트리:',t.map(r=>`${C(r[0]).trim()} [${C(r[1])}/${C(r[2])}]`).join(' || '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
