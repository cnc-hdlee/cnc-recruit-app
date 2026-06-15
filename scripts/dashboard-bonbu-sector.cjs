/* 대시보드 좌측 본부별 표 재구성: 섹터(빈칸-타이핑) | 본부 | TO | 실제입사 | 채용달성률 (수식) */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TEST='RAW DATA_정리본(test)';
const T=c=>`'${TEST}'!$${c}$2:$${c}$2000`;
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','생산기획부','Skin Science Center','크리에이티브솔루션본부','OD본부','CEO 직속','People&culture실'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 옛 본부별 표(행11~56) 정리: A11:L56 클리어
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A11:L56"});
  // 새 표: B11 타이틀, B12 헤더, B13~ 본부별
  const rows=[['🏢  본부별 채용 현황  (섹터 칸은 직접 입력)','','','',''],
              ['섹터(직접입력)','본부','TO','실제입사','채용달성률']];
  BONBU.forEach((b,i)=>{const r=13+i;rows.push(['',b,`=SUMIF(${T('C')},C${r},${T('K')})`,`=COUNTIF('_src'!$B$2:$B$2000,C${r})`,`=IF(D${r}=0,0,E${r}/D${r})`]);});
  // 합계 행
  const last=13+BONBU.length;rows.push(['','합계',`=SUM(D13:D${last-1})`,`=SUM(E13:E${last-1})`,`=IF(D${last}=0,0,E${last}/D${last})`]);
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!B11',valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  // 서식: 헤더(행12) 다크블루, 달성률 % (F13:F합계), 섹터칸 옅은 노랑(입력 유도)
  const reqs=[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:11,endRowIndex:12,startColumnIndex:1,endColumnIndex:6},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:12,endRowIndex:last,startColumnIndex:5,endColumnIndex:6},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:12,endRowIndex:last-1,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{backgroundColor:{red:1,green:0.98,blue:0.8}}},fields:'userEnteredFormat.backgroundColor'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:last-1,endRowIndex:last,startColumnIndex:1,endColumnIndex:6},cell:{userEnteredFormat:{textFormat:{bold:true},backgroundColor:{red:0.9,green:0.92,blue:0.96}}},fields:'userEnteredFormat(textFormat,backgroundColor)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:10,endRowIndex:11,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('본부별 표 재구성 완료 (행11~'+last+'), 섹터 입력칸 노랑');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
