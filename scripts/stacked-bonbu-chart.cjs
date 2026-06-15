/* L3 통합차트를 가독성 좋은 STACKED 콤보로 교체:
 *   월별 막대(STACKED) = 본부별 누적 입사(색 구간)  [A92:G94, LEFT/명]
 *   회색 선 = 채용 필요(명) 목표선                  [회사표 J, LEFT/명]
 *   주황 점선 = 달성률(%)                           [회사표 I, RIGHT/%]
 *  9개 선 겹침 문제 해소. 표/트리/다른 차트 미터치.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285;
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부'];
// 고대비 정성 팔레트
const BCOL=[{red:0.12,green:0.44,blue:0.83},{red:0.0,green:0.59,blue:0.53},{red:0.48,green:0.12,blue:0.64},
            {red:0.91,green:0.12,blue:0.39},{red:0.26,green:0.63,blue:0.28},{red:0.47,green:0.33,blue:0.28}];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const src=(c0,c1,r0,r1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:r0,endRowIndex:r1}]}});

async function main(){
  const s=await auth();
  // 본부표 월 수 탐지(A93~)
  const av=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A93:A110`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let n=0;for(const r of av){if(r&&String(r[0]).trim()!=='')n++;else break;}
  const BON={r0:91,r1:92+n};        // 헤더 R92(idx91)+데이터 n
  const COMP={r0:43,r1:44+n};       // 회사표 헤더 R44(idx43)+데이터 n

  const series=[
    // 본부별 누적 입사 — 쌓은 막대
    ...BONBU.map((b,i)=>({series:src(1+i,2+i,BON.r0,BON.r1),type:'COLUMN',targetAxis:'LEFT_AXIS',color:BCOL[i]})),
    // 채용 필요(명) 목표선
    {series:src(9,10,COMP.r0,COMP.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:{red:0.38,green:0.38,blue:0.38},
     lineStyle:{type:'MEDIUM_DASHED',width:3},pointStyle:{size:7,shape:'DIAMOND'}},
    // 달성률(%) — 우측 축
    {series:src(8,9,COMP.r0,COMP.r1),type:'LINE',targetAxis:'RIGHT_AXIS',color:{red:0.94,green:0.42,blue:0.0},
     lineStyle:{type:'DOTTED',width:4},pointStyle:{size:11,shape:'CIRCLE'}},
  ];
  const spec={
    title:'본부별 채용 추이 (월별 누적 입사, 쌓은 막대) + 달성률',
    subtitle:'막대=본부별 누적 입사(쌓기, 명) · 회색선=채용 필요(명) · 주황점선=달성률(%)',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'COMBO',stackedType:'STACKED',legendPosition:'RIGHT_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)'},
            {position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(0,1,BON.r0,BON.r1)}],series},
  };
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateChartSpec:{chartId:L3,spec}}]}});
  console.log(`OK: L3 STACKED 콤보(본부 ${BONBU.length} 쌓기 + 채용필요 + 달성률), 월 ${n}.`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
