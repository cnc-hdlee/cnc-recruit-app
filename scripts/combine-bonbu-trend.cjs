/* L3 차트(본부별 채용달성률, chartId 167562285)를 COMBO로 교체:
 *  - 막대(COLUMN) = 본부별 달성률 (J5:J11)
 *  - 점선 추세선(LINE, 점 마커) = 같은 달성률 값을 이어 본부 간 오르내림 강조
 *  같은 chartId·앵커(R3C12)·크기(440x230) 유지 → L3 위치 그대로, 한 박스에 중첩.
 *  데이터 소스(G·J열 라이브 집계)는 미터치 → 자동 연동 유지. 다른 차트 4개 미터치.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const CHART=167562285;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

const src=(c0,c1)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:3,endRowIndex:11,startColumnIndex:c0,endColumnIndex:c1}]}});

async function main(){
  const s=await auth();
  const spec={
    title:'본부별 채용달성률(%) · 추세',
    subtitle:'막대=본부별 달성률 · 점선=본부 간 추세(오르내림)',
    titleTextFormat:{fontFamily:'Roboto'},
    fontName:'Roboto',
    hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{
      chartType:'COMBO',
      legendPosition:'NO_LEGEND',
      headerCount:1,
      axis:[
        {position:'BOTTOM_AXIS',viewWindowOptions:{}},
        {position:'LEFT_AXIS',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}},
      ],
      domains:[{domain:src(6,7)}],
      series:[
        // 막대: 본부별 달성률
        {series:src(9,10),type:'COLUMN',targetAxis:'LEFT_AXIS',
         color:{red:0.26,green:0.52,blue:0.96}},
        // 점선 추세선: 같은 값, 점 마커 + 점선
        {series:src(9,10),type:'LINE',targetAxis:'LEFT_AXIS',
         color:{red:0.92,green:0.34,blue:0.09},
         lineStyle:{type:'DOTTED',width:2},
         pointStyle:{size:7,shape:'CIRCLE'}},
      ],
    },
  };
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {updateChartSpec:{chartId:CHART,spec}},
  ]}});
  console.log(`OK: chartId ${CHART} -> COMBO (막대+점선 추세선). L3 위치/크기 유지.`);
  // 검증
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(chartId,spec(title,basicChart(chartType,series(type,lineStyle.type,pointStyle.shape))),position.overlayPosition(anchorCell,widthPixels,heightPixels)))'});
  const dash=meta.data.sheets.find(x=>x.properties.title===TAB);
  const c=(dash.charts||[]).find(x=>x.chartId===CHART);
  console.log(JSON.stringify(c,null,1));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
