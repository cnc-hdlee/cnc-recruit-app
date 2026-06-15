/* L4로 이동 + 전 차트 확대 재배치 + 예측선 흐릿(미래)/실제 진하게(데이터 있는 월).
 *  예측(C)은 마지막 실제 월부터만 표시 → 흐릿한 점선이 실제선 끝에서 뻗어나감.
 *  데이터가 들어오면 실제(진한 실선)가 그 달까지 자동 연장, 예측은 그 뒤로 물러남.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const ROSTER="'입사자 명단'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(r0,r1,c0,c1)=>({sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});

async function main(){
  const s=await auth();
  const first=92,last=98;
  // 예측 C: 마지막 실제월(roster MAX)부터만 값, 그 전 월은 공백
  const ky=`$B$${first}:INDEX($B$${first}:$B$${last},COUNT($B$${first}:$B$${last}))`;
  const kx=`$A$${first}:INDEX($A$${first}:$A$${last},COUNT($B$${first}:$B$${last}))`;
  const Cf=[];for(let r=first;r<=last;r++){Cf.push([`=IF(EOMONTH($A${r},0)>=EOMONTH(MAX(${ROSTER}!$B$4:$B$2000),0),IFERROR(INTERCEPT(${ky},${kx})+SLOPE(${ky},${kx})*$A${r},""),"")`]);}
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!C${first}:C${last}`,valueInputOption:'USER_ENTERED',requestBody:{values:Cf}});

  // 차트 id 조회
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(chartId,spec.title))'});
  const d=meta.data.sheets.find(x=>x.properties.title===TAB);
  const byTitle=t=>{const c=(d.charts||[]).find(x=>x.spec&&x.spec.title&&x.spec.title.includes(t));return c&&c.chartId;};
  const order=[
    ['입사 충원율 추이',true],          // L4 = 메인(스타일 재정의)
    ['본부별 채용필요 vs 입사예정',false],
    ['현황 단계별 분포',false],
    ['채용 달성률 추이 (월별 누적)',false],
    ['채용 필요 대비 충원 추이',false],
    ['본부별 채용달성률(%)',false],
  ];
  const W=780,H=400,SP=21,startRow=3; // L4=rowIndex3
  const pos=(r)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:W,heightPixels:H}});
  const reqs=[];
  order.forEach((o,i)=>{const id=byTitle(o[0]);if(!id)return;reqs.push({updateEmbeddedObjectPosition:{objectId:id,newPosition:pos(startRow+i*SP),fields:'*'}});});

  // 메인 차트 스타일 재정의(흐릿/진하게)
  const mainId=byTitle('입사 충원율 추이');
  const spec={title:'입사 충원율 추이 & 예측 (월별)',
    subtitle:'진한 실선=실제 입사(데이터 있는 월) · 흐릿한 점선=예측 추세 · ※ 채용달성률(34.6%)과 다른 지표',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'입사 충원율'}],
      domains:[{domain:{sourceRange:rng(first-2,last,0,1)}}],
      series:[
        {series:{sourceRange:rng(first-2,last,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.09,green:0.30,blue:0.60},lineStyle:{type:'SOLID',width:4},pointStyle:{size:10,shape:'CIRCLE'},dataLabel:{type:'DATA',textFormat:{fontSize:10,bold:true}}},
        {series:{sourceRange:rng(first-2,last,2,3)},targetAxis:'LEFT_AXIS',color:{red:0.74,green:0.76,blue:0.80},lineStyle:{type:'DOTTED',width:2},pointStyle:{size:5,shape:'CIRCLE'}},
      ]}};
  if(mainId)reqs.push({updateChartSpec:{chartId:mainId,spec}});

  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('OK: L4 이동+확대(780x400) 재배치, 예측 흐릿/실제 진하게.');
  const m2=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(spec.title,position.overlayPosition(anchorCell.rowIndex,widthPixels,heightPixels)))'});
  const d2=m2.data.sheets.find(x=>x.properties.title===TAB);
  (d2.charts||[]).sort((a,b)=>a.position.overlayPosition.anchorCell.rowIndex-b.position.overlayPosition.anchorCell.rowIndex).forEach(c=>{const p=c.position.overlayPosition;console.log(`  L${p.anchorCell.rowIndex+1} ${p.widthPixels}x${p.heightPixels} "${c.spec.title}"`);});
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A91:C98`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('표:');chk.forEach(r=>console.log('  ',(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
