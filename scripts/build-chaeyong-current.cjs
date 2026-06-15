/* 채용요청(정규직)DB → RAW DATA_채용요청(현재) : 부문▸본부(센터)▸실/부▸팀 정확 분류 + 달성율 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const SRC_TAB='채용요청(정규직)DB';
const DST='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DST_TAB='RAW DATA_채용요청(현재)';const GID=660728561;
const clean=x=>{x=String(x==null?'':x).trim();return x==='-'?'':x;};
const num=x=>{if(x===''||x==null)return '';const v=Number(x);return isNaN(v)?'':v;};
// Org1 → 센터(본부급) 정규화
const CENTER_OF={'생산본부':'생산본부','생산기획부':'생산본부','품질경영본부':'생산본부','제조부':'생산본부',
  '경영기획본부':'경영기획본부','People&culture실':'경영기획본부','people&culture실':'경영기획본부',
  '영업본부':'영업본부','Makeup Center':'Makeup Center','Skin Science Center':'Skin Science Center',
  '크리에이티브솔루션본부':'크리에이티브솔루션본부','OD본부':'OD본부','CEO 직속':'CEO직속'};
// 센터 → 부문
const BUMUN_OF={'생산본부':'COO','경영기획본부':'CFO','영업본부':'CBO','Makeup Center':'CRIO','Skin Science Center':'CRIO',
  '크리에이티브솔루션본부':'크리에이티브솔루션','OD본부':'OD','CEO직속':'CEO'};
const FIXS={'품질경영본부':'품질경영부문','people&culture실':'People&Culture실','People&culture실':'People&Culture실'};
const centerOf=x=>CENTER_OF[x]||x;const bumunOf=c=>BUMUN_OF[c]||c;const fixS=x=>FIXS[x]||x;
const HEAD=['채용요청번호','우선순위','부문','본부','실/부','팀','직무','채용유형','채용상세사유','근무지','직/간접','현황','채용요청인원','현재인원','입사예정','잔여','채용달성율','입사자명단','채용요청링크'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const src=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'${SRC_TAB}'!A1:Q200`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  // 소스 2~60행만 = 실제 진행 채용요청 (61행~ 합계/소계/현황/보류 포지션 제외)
  const body=src.slice(1,60).filter(r=>{const o=clean(r[2]);return o&&!/^\d+$/.test(o)&&!/※/.test(clean(r[5]));});
  const rows=body.map((r,i)=>{const rn=i+2;
    const org1=clean(r[2]);const center=centerOf(org1);const bumun=bumunOf(center);
    const silbu=fixS(center===org1?clean(r[3]):org1);  // 하위조직이면 실/부로
    const team=clean(r[4]);
    return [clean(r[0]),clean(r[1]),bumun,center,silbu,team,clean(r[5]),clean(r[8]),clean(r[9]),clean(r[10]),clean(r[11]),clean(r[12]),num(r[6]),num(r[7]),num(r[14]),clean(r[15]),`=IF(M${rn}=0,"",O${rn}/M${rn})`,clean(r[13]),clean(r[16])];
  });
  // 검증 합계
  let to=0,plan=0,now=0;rows.forEach(r=>{to+=Number(r[12])||0;now+=Number(r[13])||0;plan+=Number(r[14])||0;});
  console.log('행:',rows.length,' TO합:',to,' 현재합:',now,' 입사예정합:',plan,' 전사달성율:',to?Math.round(plan/to*1000)/10+'%':'-');
  const cset={},sset={};rows.forEach(r=>{cset[r[3]]=(cset[r[3]]||0)+1;sset[r[2]+'>'+r[3]+'>'+r[4]]=1;});
  console.log('센터(본부) 분포:',JSON.stringify(cset));

  // 쓰기: 헤더+데이터, 나머지 클리어, 컬럼 trim
  await s.spreadsheets.values.clear({spreadsheetId:DST,range:`'${DST_TAB}'!A1:AL2000`});
  await s.spreadsheets.values.update({spreadsheetId:DST,range:`'${DST_TAB}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:[HEAD,...rows]}});
  const rng=(c0,c1,r0,r1)=>({sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1});
  await s.spreadsheets.batchUpdate({spreadsheetId:DST,requestBody:{requests:[
    {updateSheetProperties:{properties:{sheetId:GID,gridProperties:{columnCount:19}},fields:'gridProperties.columnCount'}},
    {repeatCell:{range:rng(0,19,0,1),cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:rng(16,17,1,2000),cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:rng(12,16,1,2000),cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:8,endIndex:9},properties:{pixelSize:200},fields:'pixelSize'}},
    {updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:17,endIndex:18},properties:{pixelSize:180},fields:'pixelSize'}},
    {updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:18,endIndex:19},properties:{pixelSize:180},fields:'pixelSize'}},
  ]}});
  console.log('작성 완료. 컬럼 19개로 정리.');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
