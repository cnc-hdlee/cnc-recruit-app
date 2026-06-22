/* G열 표 정리: 채용사유에 미지정 행 추가(+간격) + 5개 표 전부 박스처리(테두리·헤더음영). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666;
const R="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const HEADBG={red:0.12,green:0.22,blue:0.39},bd={style:'SOLID',color:{red:0.7,green:0.72,blue:0.78}};
function fmtTable(r1,r2,c1,c2){ // 1-based rows, 0-based cols. r1=header row
  return [
   {repeatCell:{range:{sheetId:GID,startRowIndex:r1-1,endRowIndex:r1,startColumnIndex:c1,endColumnIndex:c2},cell:{userEnteredFormat:{backgroundColor:HEADBG,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:10},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:r1,endRowIndex:r2,startColumnIndex:c1+1,endColumnIndex:c2},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}},
   {updateBorders:{range:{sheetId:GID,startRowIndex:r1-1,endRowIndex:r2,startColumnIndex:c1,endColumnIndex:c2},top:bd,bottom:bd,left:bd,right:bd,innerHorizontal:bd,innerVertical:bd}},
  ];
}
async function main(){
  const s=await auth();
  // 1) R23에 2행 삽입 (미지정 + 표간 간격). 현황·근무지 +2 밀림(_chartdata 참조 자동조정)
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:22,endIndex:24},inheritFromBefore:false}}]}});
  // 2) 미지정 행 (G23) = 총합 - 결원 - 신규
  const tot=(col)=>`SUMIFS(${R}!$${col}$4:$${col}$2001,${R}!$E$4:$E$2001,"<>")`;
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!G23:J23`,valueInputOption:'USER_ENTERED',requestBody:{values:[['미지정(유형 미입력)',`=${tot('O')}-H21-H22`,`=${tot('P')}-I21-I22`,'=IFERROR(I23/H23,0)']]}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{repeatCell:{range:{sheetId:GID,startRowIndex:22,endRowIndex:23,startColumnIndex:9,endColumnIndex:10},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}}]}});
  // 3) 표 5개 박스처리 (현황·근무지는 +2 밀린 위치)
  const reqs=[
    ...fmtTable(4,11,6,10),    // 본부별 G4:J11
    ...fmtTable(14,18,6,10),   // 우선순위 G14:J18
    ...fmtTable(20,23,6,10),   // 채용사유 G20:J23 (결원/신규/미지정)
    ...fmtTable(25,32,6,8),    // 현황 G25:H32
    ...fmtTable(33,38,6,10),   // 근무지 G33:J38
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('✅ 미지정 추가 + 표간 간격 + 5개 표 박스처리(헤더음영·테두리)');
  // 검증
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!G20:J38`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  v.forEach((r,i)=>{const c=(r||[]).map(x=>String(x==null?'':x).trim()).filter(Boolean).join(' | ');if(c)console.log(`R${20+i}: ${c}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
