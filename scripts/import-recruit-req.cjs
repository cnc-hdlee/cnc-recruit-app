/* 채용요청(정규직)DB → RAW DATA_정리본(test) 매핑 적재
 * 기존 38컬럼 유지 + 신규 컬럼(AM~) 추가. 달성률 = 입사예정 ÷ TO.
 * 사용: node import-recruit-req.cjs        (DRY)
 *      node import-recruit-req.cjs --write
 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SRC_ID = '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const SRC_TAB = '채용요청(정규직)DB';
const DST_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const DST_TAB = 'RAW DATA_정리본(test)';
const GID = 55388169;
const WRITE = process.argv.includes('--write');

// 기존 38 헤더 + 신규 10 헤더(AM~AV / idx 38~47)
const BASE = ['채용요청문서번호','본부','센터','실/부','팀','직무','채용유형','근무지','후보자명','신입/경력','채널','이력서_링크','이력서_지원일','서류_결과','1차면접_결과','1차면접_확정일','2차면접_결과','2차면접_확정일','CPI_결과','CPI_확정일','처우협의_결과','처우협의_확정일','최종상태','탈락단계','입사예정일','실제입사일','비고','현재단계','총소요일수','채용요청','TO인원','신규집계','','','리드타임','','','채용필요'];
const ADD  = ['채용요청번호','우선순위','채용상세사유','직/간접','입사예정인원','채용달성률','채용현황','채용요청링크']; // idx 38~45
const HEADERS = [...BASE, ...ADD];
const N = HEADERS.length; // 46
const num = (x)=>{const v=Number(x);return isNaN(v)?'':v;};
const clean = (x)=>{x=String(x==null?'':x).trim();return (x==='-')?'':x;};

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const sheets = await auth();
  const src=(await sheets.spreadsheets.values.get({spreadsheetId:SRC_ID,range:`'${SRC_TAB}'!A1:Q1026`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  const body=src.slice(1).filter(r=>r&&(clean(r[2])||clean(r[5]))); // Org1 또는 직무 있는 행

  const orgSet=new Set();
  const out=[];
  body.forEach((r,i)=>{
    const rownum=i+2; // 시트 행번호(헤더 1행)
    const row=new Array(N).fill('');
    row[1]=clean(r[2]);                 // 본부 = Org1
    row[3]=clean(r[3]); if(clean(r[3])&&!/^\d+$/.test(clean(r[3])))orgSet.add(clean(r[3])); // 실/부 = Org2
    row[4]=clean(r[4]);                 // 팀 = Org3
    row[5]=clean(r[5]);                 // 직무
    row[6]=clean(r[8]);                 // 채용유형 = 채용사유(신규/결원)
    row[7]=clean(r[10]);                // 근무지
    row[8]=clean(r[13]);               // 후보자명 = N열(합격/입사확정자 명단)
    row[30]=num(r[6]);                  // TO인원 = 채용요청인원(G)
    row[37]=num(r[15]);                 // 채용필요 = 잔여(P)
    // 신규 컬럼
    row[38]=clean(r[0]);               // 채용요청번호 = 구분
    row[39]=clean(r[1]);               // 우선순위
    row[40]=clean(r[9]);               // 채용상세사유 = J
    row[41]=clean(r[11]);              // 직/간접
    row[42]=num(r[14]);                // 입사예정인원 = O
    row[43]=`=IF($AE${rownum}="","",AQ${rownum}/$AE${rownum})`; // 채용달성률 = 입사예정(AQ)/TO(AE)
    row[44]=clean(r[12]);              // 채용현황 = 현황(M)
    row[45]=clean(r[16]);             // 채용요청링크 = Q
    out.push(row);
  });

  // 합계 검증
  let to=0,plan=0;out.forEach(r=>{to+=Number(r[30])||0;plan+=Number(r[42])||0;});
  console.log(`매핑 행: ${out.length}`);
  console.log(`TO합:${to} 입사예정합:${plan} 전사달성률:${to?Math.round(plan/to*1000)/10:0}%`);
  console.log(`실/부(Org2) 고유: ${[...orgSet].join(', ')}`);
  console.log('샘플:', out.slice(0,3).map(r=>`${r[1]}/${r[3]}/${r[4]} ${r[5]} TO${r[30]} 예정${r[42]} ${r[44]}`).join(' | '));

  if(!WRITE){console.log('\n[DRY] --write 시 적용');return;}

  // 컬럼 확장
  await sheets.spreadsheets.batchUpdate({spreadsheetId:DST_ID,requestBody:{requests:[
    {updateSheetProperties:{properties:{sheetId:GID,gridProperties:{columnCount:48}},fields:'gridProperties.columnCount'}}
  ]}});
  // 헤더 + 데이터 쓰기 (기존 데이터는 이미 비워둔 상태)
  await sheets.spreadsheets.values.update({spreadsheetId:DST_ID,range:`'${DST_TAB}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:[HEADERS,...out]}});
  console.log(`\n[WRITE] 헤더+데이터 ${out.length}행 적재 완료`);

  // 드롭다운/형식 적용
  const rng=(c)=>({sheetId:GID,startRowIndex:1,endRowIndex:2000,startColumnIndex:c,endColumnIndex:c+1});
  const dv=(c,opts)=>({setDataValidation:{range:rng(c),rule:{condition:{type:'ONE_OF_LIST',values:opts.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}});
  const reqs=[
    dv(1,['생산본부','경영기획본부','영업본부','Makeup Center','OD본부','생산기획부','품질경영본부','Skin Science Center','크리에이티브솔루션본부','CEO 직속','People&culture실']),
    dv(3,[...orgSet]),
    dv(6,['신규','결원','대체','충원','증원','전환']),
    dv(7,['퍼플','수원','그린','서울','방교']),
    dv(39,['P0','P1','P2','P3']),
    dv(41,['직접','간접']),
    dv(44,['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정']),
    // 달성률 % 형식
    {repeatCell:{range:rng(43),cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    // 헤더 신규 컬럼 배경(다크블루) 통일
    {repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:38,endColumnIndex:46},cell:{userEnteredFormat:{backgroundColor:{red:0.12156863,green:0.21960784,blue:0.39215687},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
  ];
  await sheets.spreadsheets.batchUpdate({spreadsheetId:DST_ID,requestBody:{requests:reqs}});
  console.log('[WRITE] 드롭다운/달성률%형식/헤더서식 적용 완료');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
