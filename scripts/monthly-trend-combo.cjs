/* L3 차트(167562285)를 '월별 추이' 대형 콤보로 전환 + L39 월별추이차트(1205909276) 삭제 + L열 스택 재정렬.
 *  L3 콤보: x=월 / 막대(LEFT,명)=월별 누적 입사 / 점선+점(RIGHT,%)=월별 달성률 추이
 *  데이터: 대시보드 G44:J46 표(월·누적입사·달성률·목표) — build-achievement-trend.cjs가 라이브 생성. 미터치.
 *  L열 차트 재배치(겹침 방지): L3 대형(760x430) 아래로 기존 3개를 순서대로 내림.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285, DEL=1205909276;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

// 월별 추이 표 범위 자동 탐지: G44 헤더, G45~ 데이터(월 = yyyy년 m월)
async function trendRange(s){
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!G44:J70`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let n=0; for(let i=1;i<v.length;i++){ if(v[i]&&String(v[i][0]).trim()!=='') n++; else break; }
  if(!n) throw new Error('월별 추이 표(G45~) 비어있음 - build-achievement-trend.cjs 먼저 실행');
  return {startRowIndex:43,endRowIndex:44+n}; // 헤더 R44(idx43) + n행
}
const src=(rng,c0,c1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,...rng}]}});

async function main(){
  const s=await auth();
  const rng=await trendRange(s);
  const monthsN=rng.endRowIndex-rng.startRowIndex-1;

  // 범례가 각 선의 의미를 그대로 보여주도록 헤더 라벨 확정 (H/I/J 44행)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!H44:J44`,valueInputOption:'USER_ENTERED',
    requestBody:{values:[['누적 입사(명)','달성률','채용 필요(명)']]}});

  const spec={
    title:'채용 추이 (월별) — 누적 입사 · 채용 필요 · 달성률',
    subtitle:'막대=누적 입사(명) · 초록선=채용 필요(명) · 주황 점선=달성률(%) · 자동 연동',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',
    hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{
      chartType:'COMBO',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[
        {position:'BOTTOM_AXIS',title:'월'},
        {position:'LEFT_AXIS',title:'인원(명)'},
        {position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}},
      ],
      domains:[{domain:src(rng,6,7)}],
      series:[
        // 막대: 누적 입사(명)
        {series:src(rng,7,8),type:'COLUMN',targetAxis:'LEFT_AXIS',color:{red:0.26,green:0.52,blue:0.96}},
        // 초록 실선+점: 채용 필요(명) — 목표 기준선
        {series:src(rng,9,10),type:'LINE',targetAxis:'LEFT_AXIS',color:{red:0.20,green:0.66,blue:0.33},
         lineStyle:{type:'SOLID',width:2},pointStyle:{size:6,shape:'DIAMOND'}},
        // 주황 점선+점: 달성률(%) — 시간 추이
        {series:src(rng,8,9),type:'LINE',targetAxis:'RIGHT_AXIS',color:{red:0.92,green:0.34,blue:0.09},
         lineStyle:{type:'DOTTED',width:3},pointStyle:{size:9,shape:'CIRCLE'}},
      ],
    },
  };

  // 재배치 좌표 (col 11 = L). L3 대형 900x480 ≈ 23행 → 아래 차트 26/38/50행으로.
  const anchor=(r,w,h)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:w,heightPixels:h}});
  const reqs=[
    {deleteEmbeddedObject:{objectId:DEL}},
    {updateChartSpec:{chartId:L3,spec}},
    {updateEmbeddedObjectPosition:{objectId:L3,newPosition:anchor(2,900,480),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:776153523,newPosition:anchor(26,440,230),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:570111091,newPosition:anchor(38,440,230),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:1035164469,newPosition:anchor(50,440,230),fields:'*'}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log(`OK: L3=월별 콤보(월 ${monthsN}개, 3계열) 900x480, L39 삭제, L열 재정렬.`);

  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(chartId,spec.title,position.overlayPosition(anchorCell.rowIndex,widthPixels,heightPixels)))'});
  const d=meta.data.sheets.find(x=>x.properties.title===TAB);
  (d.charts||[]).sort((a,b)=>a.position.overlayPosition.anchorCell.rowIndex-b.position.overlayPosition.anchorCell.rowIndex)
    .forEach(c=>{const p=c.position.overlayPosition;console.log(`  ${c.chartId} R${p.anchorCell.rowIndex+1} ${p.widthPixels}x${p.heightPixels} "${c.spec.title}"`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
