/* 대시보드 클린 재구성:
 * 좌측 = 본부(소계) ▸ 팀, 본부마다 빈줄 구분 (실/부 단계 제거)
 * 우측 = KPI + 차트4 (중복 detail표 제거)
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TEST='RAW DATA_정리본(test)';
const NAVY={red:0.12,green:0.22,blue:0.39};const WHITE={red:1,green:1,blue:1};const GREY={red:0.90,green:0.92,blue:0.96};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const Tc=c=>`'${TEST}'!$${c}$2:$${c}$2000`;const Sc=c=>`'_src'!$${c}$2:$${c}$2000`;
const ORDER=['생산본부','제품개발본부','경영기획본부','OD본부','CEO직속'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!A2:Q2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const tree={};const bord=[];
  tv.forEach(r=>{const b=clean((r||[])[2]);if(!b)return;const tm=clean((r||[])[4]);if(!tree[b]){tree[b]=[];bord.push(b);}if(tm&&!tree[b].includes(tm))tree[b].push(tm);});
  const order=[...ORDER.filter(b=>tree[b]),...bord.filter(b=>!ORDER.includes(b))];

  // ===== 좌측 본부▸팀 =====
  const START=13;let r=START;const rows=[];const navy=[];
  const sumB=b=>`=SUMIF(${Tc('C')},"${q(b)}",${Tc('K')})`;
  const cntB=b=>`=COUNTIF(${Sc('B')},"${q(b)}")`;
  const sumBT=(b,t)=>`=SUMIFS(${Tc('K')},${Tc('C')},"${q(b)}",${Tc('E')},"${q(t)}")`;
  const cntBT=(b,t)=>`=COUNTIFS(${Sc('B')},"${q(b)}",${Sc('C')},"${q(t)}")`;
  const ratio=rr=>`=IFERROR(D${rr}/C${rr},0)`;
  for(const b of order){
    rows.push([b,'',sumB(b),cntB(b),ratio(r)]);navy.push(r);r++;
    for(const t of tree[b]){rows.push(['',t,sumBT(b,t),cntBT(b,t),ratio(r)]);r++;}
    rows.push(['','','','','']);r++; // 섹터 구분 빈줄
  }
  rows.push(['◆ 전사 합계','',`=SUM(${Tc('K')})`,`=COUNTA(${Sc('E')})`,ratio(r)]);const totalRow=r;

  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A11:L130"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A11',valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['🏢  본부별 채용 현황','','','',''],
    ['본부 / 팀','','채용 필요 (건)','실제입사','달성률'],
    ...rows,
  ]}});

  // ===== 우측 KPI =====
  const kpi=[['■ 채용 달성률 요약',''],['총 채용필요 (건)',`=SUM(${Tc('K')})`],['실제 입사 (명)',`=COUNTA(${Sc('E')})`],['채용 달성률','=IF(N2=0,0,N3/N2)']];
  // ===== 차트용 오프스크린 헬퍼 (A200) =====
  const STATUS=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];const PRIO=['P0','P1','P2','P3'];
  const hh=[['본부','채용필요','실제입사','달성률']];order.forEach((b,i)=>{const rr=201+i;hh.push([b,`=SUMIF(${Tc('C')},A${rr},${Tc('K')})`,`=COUNTIF(${Sc('B')},A${rr})`,`=IFERROR(C${rr}/B${rr},0)`]);});
  const st=[['현황','건수']];STATUS.forEach((x,i)=>st.push([x,`=COUNTIF(${Tc('O')},F${201+i})`]));
  const pr=[['우선순위','채용필요']];PRIO.forEach((x,i)=>pr.push([x,`=SUMIF(${Tc('B')},I${201+i},${Tc('K')})`]));
  const HN=Math.max(hh.length,st.length,pr.length);const helper=[];
  for(let i=0;i<HN;i++){helper.push([...(hh[i]||['','','','']),'',...(st[i]||['','']),'',...(pr[i]||['',''])]);}

  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!M28:U135"});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A200:K215"});
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:'대시보드!M1',values:kpi},
    {range:'대시보드!A200',values:helper},
  ]}});

  // ===== 서식 =====
  const req=[];
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:11,endRowIndex:12,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  navy.forEach(rn=>req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:2,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:10,endRowIndex:11,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:1,startColumnIndex:12,endColumnIndex:13},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:3,endRowIndex:4,startColumnIndex:13,endColumnIndex:14},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},textFormat:{bold:true}}},fields:'userEnteredFormat(numberFormat,textFormat)'}});
  // 열너비
  [[0,150],[1,150],[2,110],[3,90],[4,90]].forEach(([c,px])=>req.push({updateDimensionProperties:{range:{sheetId:DASH,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});

  // ===== 차트 재생성 =====
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.sheetId===DASH);
  const delc=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(delc.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delc}});
  const sr=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  const W=370,H=210;
  const colC=(title,r0,r1,d,ser,ar,ac)=>({addChart:{chart:{spec:{title,basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:sr(r0,r1,d)}],series:ser.map(c=>({series:sr(r0,r1,c),targetAxis:'LEFT_AXIS'}))}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const pieC=(title,r0,r1,d,se,ar,ac)=>({addChart:{chart:{spec:{title,pieChart:{legendPosition:'RIGHT_LEGEND',domain:sr(r0,r1,d),series:sr(r0,r1,se)}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const nb=order.length;
  const charts=[
    colC('본부별 채용필요 vs 실제입사',199,200+nb,0,[1,2],5,12),
    colC('본부별 채용달성률',199,200+nb,0,[3],5,18),
    pieC('채용현황 단계별 분포',199,206,5,6,17,12),
    colC('우선순위별 채용필요',199,204,8,[9],17,18),
  ];
  const resp=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:charts}});
  console.log(`완료: 본부 ${nb} · 데이터 ${START}~${totalRow} · 차트 ${resp.data.replies.filter(x=>x.addChart).length}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
