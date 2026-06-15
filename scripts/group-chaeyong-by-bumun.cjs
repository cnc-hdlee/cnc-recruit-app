/* RAW DATA_채용요청(현재): 부문별로 묶고 각 그룹 위에 "■ 부문" 소계 헤더줄 삽입.
 * 헤더줄은 텍스트 요약(숫자X)이라 대시보드 SUM/SUMIFS 안 깨짐. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='RAW DATA_채용요청(현재)';const GID=660728561;
const ORDER=['COO','CRIO','CBO','CFO','크리에이티브솔루션','CEO','OD'];
const NAVY={red:0.12,green:0.22,blue:0.39},WHITE={red:1,green:1,blue:1};
const num=x=>{const v=Number(x);return isNaN(v)?0:v;};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const head=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A1:S1`})).data.values[0];
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A2:S2000`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  const rows=v.filter(r=>r&&String(r[2]||'').trim()); // 부문(C) 있는 데이터행
  // 부문별 그룹
  const grp={};const bo=[];rows.forEach(r=>{const bm=String(r[2]).trim();if(!grp[bm]){grp[bm]=[];bo.push(bm);}grp[bm].push(r);});
  const order=[...ORDER.filter(b=>grp[b]),...bo.filter(b=>!ORDER.includes(b))];

  const out=[head];const navyRows=[];let rn=2; // 시트행(헤더 1행 다음부터)
  for(const bm of order){
    const g=grp[bm];const to=g.reduce((a,r)=>a+num(r[12]),0),pl=g.reduce((a,r)=>a+num(r[14]),0);
    const ach=to?(pl/to*100).toFixed(1):'0.0';
    const label=`■ ${bm}    (채용필요 ${to}명 · 입사예정 ${pl}명 · 잔여 ${to-pl}명 · 달성률 ${ach}%)`;
    out.push([label,'','','','','','','','','','','','','','','','','','']);navyRows.push(rn);rn++; // 부문 헤더줄(숫자 없음)
    g.forEach(r=>{const row=r.slice(0,19);while(row.length<19)row.push('');row[16]=`=IF(M${rn}=0,"",O${rn}/M${rn})`;out.push(row);rn++;}); // 데이터행 (달성률 수식 재생성)
  }

  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!A1:S2000`});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:out}});
  // 서식: 헤더(1행)+부문헤더줄 네이비, 달성률% 등
  const req=[
    {repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:19},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true,fontSize:10},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:out.length,startColumnIndex:16,endColumnIndex:17},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ];
  navyRows.forEach(r=>req.push({repeatCell:{range:{sheetId:GID,startRowIndex:r-1,endRowIndex:r,startColumnIndex:0,endColumnIndex:19},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true,fontSize:12}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});
  console.log('부문 그룹화 완료: 부문',order.length,'개 헤더줄 + 데이터',rows.length,'행 / 총',out.length-1,'행');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
