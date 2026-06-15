/* 정리: ① 상단 빈 행(2~4) 삭제 ② 39채널 드롭다운+범주형+날짜 재적용 ③ A1 헤더 배경 원복 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const GID = 55388169;
const LASTROW = 2000;
const HEADER_BG = { red: 0.12156863, green: 0.21960784, blue: 0.39215687 }; // 원래 다크블루

const CHANNELS = [
  '사람인','사람인 인재풀','잡코리아','원티드','인크루트','리멤버','리멤버 인재풀',
  '링크드인','인디드','캐치','점핏','로켓펀치','블라인드','당근','알바몬','알바천국',
  '고용24','구인24','워크넷','일자리센터','채용박람회','병역일터','산업기능요원','정부기관',
  '직원추천','내부추천','지인추천','서치펌','재입사',
  '대학교 추천','산학협력','현장실습','고등학교','특성화고',
  '자사 채용홈페이지','공모전','도급사','인재Pool','기타',
];
const DROPDOWNS = [
  [1,['COO','CRIO','CBO','CFO','크리에이티브솔루션']],
  [2,['영업본부','경영기획본부','생산본부','MakeUp Center','Skin Science Center','크리에이티브 솔루션 본부']],
  [3,['직속','KPD실','GPD실','CFO Office실','People&Culture실','Workplace Experience실','제조부','생산1부','생산3부','SC Innovation Lab']],
  [6,['신규','대체','충원','결원','증원','전환']],
  [7,['그린','퍼플','수원','3공장']],
  [9,['신입','경력','인턴']],
  [10,CHANNELS],
  [13,['합격','불합격','보류','검토중']],
  [14,['합격','불합격','보류','불참','면접포기']],
  [16,['합격','불합격','보류','불참','면접포기']],
  [18,['통과','불통과','진행중']],
  [20,['동의','거절','협의중']],
  [22,['합격','탈락','진행중','보류']],
  [23,['서류','1차면접','2차면접','CPI','처우협의','면접포기']],
  [27,['지원접수','서류 합격','1차 면접','1차 합격','2차 면접','2차 합격','CPI','처우 동의','입사','서류 탈락','1차 탈락','2차 탈락','포기']],
];
const DATECOLS = [12,15,17,19,21,24,25];
const rng = (c0,c1,r0=1,r1=LASTROW)=>({sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1});

async function main(){
  const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));
  const oauth=new google.auth.OAuth2(tok.clientId,tok.clientSecret);
  oauth.setCredentials({refresh_token:tok.refresh_token});await oauth.getAccessToken();
  const sheets=google.sheets({version:'v4',auth:oauth});

  // ① 빈 행 2~4 삭제 (rowIndex 1,2,3 → startIndex1 endIndex4)
  await sheets.spreadsheets.batchUpdate({spreadsheetId:SS_ID,requestBody:{requests:[
    {deleteDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:1,endIndex:4}}}
  ]}});
  console.log('① 빈 행 2~4 삭제 완료');

  // ②③ 재적용
  const reqs=[];
  reqs.push({updateSheetProperties:{properties:{sheetId:GID,gridProperties:{rowCount:LASTROW}},fields:'gridProperties.rowCount'}});
  for(const [idx,opts] of DROPDOWNS){
    reqs.push({setDataValidation:{range:rng(idx,idx+1),rule:{condition:{type:'ONE_OF_LIST',values:opts.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}});
  }
  for(const idx of DATECOLS){
    reqs.push({repeatCell:{range:rng(idx,idx+1),cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'}}},fields:'userEnteredFormat.numberFormat'}});
    reqs.push({setDataValidation:{range:rng(idx,idx+1),rule:{condition:{type:'DATE_IS_VALID'},showCustomUi:true,strict:false}}});
  }
  // A1 헤더 배경 원복
  reqs.push({repeatCell:{range:rng(0,1,0,1),cell:{userEnteredFormat:{backgroundColor:HEADER_BG}},fields:'userEnteredFormat.backgroundColor'}});
  await sheets.spreadsheets.batchUpdate({spreadsheetId:SS_ID,requestBody:{requests:reqs}});
  console.log(`②③ 드롭다운(${DROPDOWNS.length}컬럼, 채널 ${CHANNELS.length}옵션)+날짜(${DATECOLS.length}컬럼)+헤더 원복 완료, 요청 ${reqs.length}개`);

  // 검증: 첫 데이터행(삭제 후 row2)의 K 검증
  const r=await sheets.spreadsheets.get({spreadsheetId:SS_ID,ranges:["'RAW DATA_정리본'!A2:K2"],includeGridData:true});
  const cells=r.data.sheets[0].data[0].rowData[0].values;
  console.log('검증 row2: I(이름)=',cells[8].formattedValue,' K채널옵션수=',cells[10].dataValidation.condition.values.length);
}
main().catch(e=>{console.error('ERR',e.stack);process.exit(1);});
