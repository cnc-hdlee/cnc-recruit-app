/* L3 차트(167562285) 하나에 전부 합치기:
 *   막대  = 누적 입사(명)        [회사표 H, LEFT/명]
 *   선    = 채용 필요(명)        [회사표 J, LEFT/명]
 *   점선  = 달성률(%)            [회사표 I, RIGHT/%]
 *   선 6  = 본부별 누적 입사(명) [본부표 B..G, LEFT/명]
 *  도메인=월(본부표 A). 두 표 월 순서 동일 → 위치정렬로 한 차트 결합.
 *  별도 본부별 차트(제목 매칭)는 삭제. L열 아래 차트 재정렬(겹침 방지). 자동 연동 유지.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285;
const BONBU_TITLE='본부별 채용 추이 (월별 누적 입사)';
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부'];
const BCOL=[ {red:0.0,green:0.6,blue:0.6},{red:0.5,green:0.2,blue:0.75},{red:0.85,green:0.2,blue:0.2},
             {red:0.95,green:0.45,blue:0.75},{red:0.55,green:0.38,blue:0.20},{red:0.6,green:0.6,blue:0.1} ];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const src=(c0,c1,r0,r1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:r0,endRowIndex:r1}]}});

async function main(){
  const s=await auth();
  // 본부표 월 수 n 탐지 (A64~)
  const av=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A64:A80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let n=0;for(const r of av){if(r&&String(r[0]).trim()!=='')n++;else break;}
  if(!n)throw new Error('본부표(A64~) 비어있음 - build-bonbu-trend.cjs 먼저 실행');
  // 행 범위(0-idx): 회사표 헤더 R44 -> 43, 데이터 R45.. ; 본부표 헤더 R63 -> 62
  const COMP={r0:43,r1:44+n}; const BON={r0:62,r1:63+n};

  const series=[
    // 누적 입사(명) 막대
    {series:src(7,8,COMP.r0,COMP.r1),type:'COLUMN',targetAxis:'LEFT_AXIS',color:{red:0.26,green:0.52,blue:0.96}},
    // 채용 필요(명) 회색 굵은 점선
    {series:src(9,10,COMP.r0,COMP.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:{red:0.45,green:0.45,blue:0.45},
     lineStyle:{type:'MEDIUM_DASHED',width:3},pointStyle:{size:6,shape:'DIAMOND'}},
    // 본부별 6개 선 (명)
    ...BONBU.map((b,i)=>({series:src(1+i,2+i,BON.r0,BON.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:BCOL[i],
       lineStyle:{type:'SOLID',width:2},pointStyle:{size:6,shape:'CIRCLE'}})),
    // 달성률(%) 주황 점선 (오른쪽 축)
    {series:src(8,9,COMP.r0,COMP.r1),type:'LINE',targetAxis:'RIGHT_AXIS',color:{red:0.92,green:0.34,blue:0.09},
     lineStyle:{type:'DOTTED',width:3},pointStyle:{size:9,shape:'CIRCLE'}},
  ];
  const spec={
    title:'채용 추이 통합 (월별) — 누적 입사·채용 필요·달성률 + 본부별',
    subtitle:'막대=누적 입사(명) · 회색점선=채용 필요(명) · 색선=본부별 누적(명) · 주황점선=달성률(%)',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',
    hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'COMBO',legendPosition:'RIGHT_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)'},
            {position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(0,1,BON.r0,BON.r1)}],
      series},
  };

  // 별도 본부별 차트 삭제
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(chartId,spec.title))'});
  const dash=meta.data.sheets.find(x=>x.properties.title===TAB);
  const del=(dash.charts||[]).filter(c=>c.spec&&c.spec.title===BONBU_TITLE).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));

  const anchor=(r,w,h)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:w,heightPixels:h}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    ...del,
    {updateChartSpec:{chartId:L3,spec}},
    {updateEmbeddedObjectPosition:{objectId:L3,newPosition:anchor(2,1000,540),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:776153523,newPosition:anchor(29,440,230),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:570111091,newPosition:anchor(41,440,230),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:1035164469,newPosition:anchor(53,440,230),fields:'*'}},
  ]}});
  console.log(`OK: L3 통합 콤보(${series.length}계열, 월 ${n}) 1000x540, 본부별 차트 삭제, L열 재정렬.`);
  const m2=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(spec.title,position.overlayPosition(anchorCell.rowIndex,widthPixels,heightPixels)))'});
  const d2=m2.data.sheets.find(x=>x.properties.title===TAB);
  (d2.charts||[]).sort((a,b)=>a.position.overlayPosition.anchorCell.rowIndex-b.position.overlayPosition.anchorCell.rowIndex)
    .forEach(c=>{const p=c.position.overlayPosition;console.log(`  L${p.anchorCell.rowIndex+1} ${p.widthPixels}x${p.heightPixels} "${c.spec.title}"`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
