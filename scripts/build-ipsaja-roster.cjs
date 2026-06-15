/* 새 탭 "입사자 명단" 생성: 입력용 레이아웃 (드롭다운/달력/자동번호/요약). 기존은 안 건드림. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='입사자 명단';
const NAVY={red:0.12,green:0.22,blue:0.39},WHITE={red:1,green:1,blue:1},BAND={red:0.93,green:0.95,blue:0.98},BRD={red:0.45,green:0.5,blue:0.6};
const HEAD=['No.','입사확정일','부문','본부','실/부','팀','직무','성명','직급','신입/경력','성별','근무지','직/간접','채용유형','연락처','비고'];
const DV={2:['COO','CRIO','CBO','CFO','크리에이티브솔루션','OD','CEO'],
  3:['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부','OD본부','CEO직속'],
  8:['사원','주임','대리','과장','차장','부장','이사','연구원','선임','책임','수석','소장','부소장'],
  9:['신입','경력','인턴'],10:['남','여'],11:['퍼플','그린','수원','서울','방교','3공장'],
  12:['직접','간접'],13:['신규','결원','대체','충원']};
const W=[50,110,80,130,120,110,110,90,70,80,50,80,70,80,120,150];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const m=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title,sheetId))'});
  let sh=m.data.sheets.find(x=>x.properties.title===TAB);let GID;
  if(sh){GID=sh.properties.sheetId;await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!A1:Z2000`});}
  else{const r=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{addSheet:{properties:{title:TAB,gridProperties:{rowCount:2000,columnCount:16,frozenRowCount:3}}}}]}});GID=r.data.replies[0].addSheet.properties.sheetId;}

  // 값: 타이틀(1)+요약(2)+헤더(3)+자동번호(4)
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:`${TAB}!A1`,values:[['👥  입사자 명단']]},
    {range:`${TAB}!A2`,values:[['="총 입사자 "&COUNTA($H$4:$H$2000)&"명     ·     직접 "&COUNTIF($M$4:$M$2000,"직접")&"명 / 간접 "&COUNTIF($M$4:$M$2000,"간접")&"명     ·     신입 "&COUNTIF($J$4:$J$2000,"신입")&"명 / 경력 "&COUNTIF($J$4:$J$2000,"경력")&"명"']]},
    {range:`${TAB}!A3`,values:[HEAD]},
    {range:`${TAB}!A4`,values:[['=ARRAYFORMULA(IF($H$4:$H$2000="","",ROW($H$4:$H$2000)-3))']]},
  ]}});

  const req=[];
  // 타이틀/요약 폰트
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:15}}},fields:'userEnteredFormat.textFormat'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:11,foregroundColor:{red:0.2,green:0.3,blue:0.5}}}},fields:'userEnteredFormat.textFormat'}});
  // 헤더(행3) 네이비
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:16},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true,fontSize:10},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}});
  // 데이터 정렬(가운데 일부)
  [0,1,2,8,9,10,11,12,13].forEach(c=>req.push({repeatCell:{range:{sheetId:GID,startRowIndex:3,endRowIndex:2000,startColumnIndex:c,endColumnIndex:c+1},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}}));
  // 입사확정일(B) 날짜서식+달력
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:3,endRowIndex:2000,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({setDataValidation:{range:{sheetId:GID,startRowIndex:3,endRowIndex:2000,startColumnIndex:1,endColumnIndex:2},rule:{condition:{type:'DATE_IS_VALID'},showCustomUi:true,strict:false}}});
  // 드롭다운들
  Object.entries(DV).forEach(([c,opts])=>req.push({setDataValidation:{range:{sheetId:GID,startRowIndex:3,endRowIndex:2000,startColumnIndex:+c,endColumnIndex:+c+1},rule:{condition:{type:'ONE_OF_LIST',values:opts.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}}));
  // 열너비
  W.forEach((px,c)=>req.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  // 헤더 테두리
  req.push({updateBorders:{range:{sheetId:GID,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:16},top:{style:'SOLID',color:BRD},bottom:{style:'SOLID',color:BRD},left:{style:'SOLID',color:BRD},right:{style:'SOLID',color:BRD},innerVertical:{style:'SOLID',color:{red:0.7,green:0.75,blue:0.82}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});
  // 행 줄무늬(banding) — 데이터 영역
  try{await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{addBanding:{bandedRange:{range:{sheetId:GID,startRowIndex:3,endRowIndex:200,startColumnIndex:0,endColumnIndex:16},rowProperties:{firstBandColor:WHITE,secondBandColor:BAND}}}}]}});}catch(e){console.log('banding skip:',e.message);}
  console.log('탭 "입사자 명단" 생성 완료: 16컬럼 + 드롭다운 + 달력 + 자동번호 + 요약 + 헤더고정');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
