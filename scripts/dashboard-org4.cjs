/* TEST 서식정리 + 대시보드 4단(부문▸본부▸실/부▸팀) 소계 표 + 차트 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const GID_T=55388169;const TEST='RAW DATA_정리본(test)';
const C1={red:0.09,green:0.16,blue:0.29};   // 부문 (가장 진함)
const C2={red:0.17,green:0.30,blue:0.50};   // 본부
const C3={red:0.40,green:0.52,blue:0.68};   // 실/부
const WHITE={red:1,green:1,blue:1};const GREY={red:0.88,green:0.90,blue:0.95};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const Tc=c=>`'${TEST}'!$${c}$2:$${c}$2000`;const Sc=c=>`'_src'!$${c}$2:$${c}$2000`;
const BUMUN_ORDER=['COO','CRIO','CBO','CFO','크리에이티브솔루션','OD','CEO'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!A2:R2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // 트리: 부문 ▸ 본부 ▸ 실/부 ▸ 팀  (TEST: C부문2 D본부3 E실부4 F팀5)
  const T={};const bo=[];
  tv.forEach(r=>{const bm=clean(r[2]);if(!bm)return;const bb=clean(r[3]);const sb=clean(r[4])||'(직속)';const tm=clean(r[5]);
    T[bm]=T[bm]||{ord:[],b:{}};if(!T[bm].b[bb]){T[bm].b[bb]={ord:[],s:{}};T[bm].ord.push(bb);}
    const B=T[bm].b[bb];if(!B.s[sb]){B.s[sb]=[];B.ord.push(sb);}if(tm&&!B.s[sb].includes(tm))B.s[sb].push(tm);
    if(!bo.includes(bm))bo.push(bm);});
  const order=[...BUMUN_ORDER.filter(b=>T[b]),...bo.filter(b=>!BUMUN_ORDER.includes(b))];

  // 수식 (TEST: C부문 D본부 E실/부 F팀 L채용필요 / _src: B부문 C본부 F실/부 D팀)
  const sB=m=>`=SUMIF(${Tc('C')},"${q(m)}",${Tc('L')})`;
  const cB=m=>`=COUNTIF(${Sc('B')},"${q(m)}")`;
  const sBB=(m,b)=>`=SUMIFS(${Tc('L')},${Tc('C')},"${q(m)}",${Tc('D')},"${q(b)}")`;
  const cBB=(m,b)=>`=COUNTIFS(${Sc('B')},"${q(m)}",${Sc('C')},"${q(b)}")`;
  const sS=(b,sb)=>`=SUMIFS(${Tc('L')},${Tc('D')},"${q(b)}",${Tc('E')},"${q(sb==='(직속)'?'':sb)}")`;
  const cS=(b,sb)=>`=COUNTIFS(${Sc('C')},"${q(b)}",${Sc('F')},"${q(sb==='(직속)'?'':sb)}")`;
  const sT=(b,sb,t)=>`=SUMIFS(${Tc('L')},${Tc('D')},"${q(b)}",${Tc('E')},"${q(sb==='(직속)'?'':sb)}",${Tc('F')},"${q(t)}")`;
  const cT=(b,sb,t)=>`=COUNTIFS(${Sc('C')},"${q(b)}",${Sc('F')},"${q(sb==='(직속)'?'':sb)}",${Sc('D')},"${q(t)}")`;
  const rt=rr=>`=IFERROR(F${rr}/E${rr},0)`;

  const START=13;let r=START;const rows=[];const l1=[],l2=[],l3=[];
  for(const m of order){
    rows.push([m,'','','',sB(m),cB(m),rt(r)]);l1.push(r);r++;
    for(const b of T[m].ord){
      rows.push(['',b,'','',sBB(m,b),cBB(m,b),rt(r)]);l2.push(r);r++;
      for(const sb of T[m].b[b].ord){
        rows.push(['','',sb,'',sS(b,sb),cS(b,sb),rt(r)]);l3.push(r);r++;
        for(const t of T[m].b[b].s[sb]){rows.push(['','','',t,sT(b,sb,t),cT(b,sb,t),rt(r)]);r++;}
      }
    }
    rows.push(['','','','','','','']);r++; // 부문 구분 빈줄
  }
  rows.push(['◆ 전사 합계','','','',`=SUM(${Tc('L')})`,`=COUNTA(${Sc('E')})`,rt(r)]);const totalRow=r;

  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A11:L200"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A11',valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['🏢  채용현황  (부문 ▸ 본부 ▸ 실/부 ▸ 팀)','','','','','',''],
    ['부문','본부','실/부','팀','채용 필요 (건)','실제입사','달성률'],
    ...rows,
  ]}});

  // KPI + 오프스크린 헬퍼(본부별/현황/우선순위) for 차트
  const kpi=[['■ 채용 달성률 요약',''],['총 채용필요 (건)',`=SUM(${Tc('L')})`],['실제 입사 (명)',`=COUNTA(${Sc('E')})`],['채용 달성률','=IF(N2=0,0,N3/N2)']];
  const centers=[];tv.forEach(r=>{const b=clean(r[3]);if(b&&!centers.includes(b))centers.push(b);});
  const STATUS=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];const PRIO=['P0','P1','P2','P3'];
  const HN=Math.max(centers.length+1,STATUS.length+1,PRIO.length+1);const helper=[];
  for(let i=0;i<HN;i++){const rr=201+i;
    const hc=i===0?['본부','채용필요','실제입사','달성률']:(centers[i-1]?[centers[i-1],`=SUMIF(${Tc('D')},A${rr},${Tc('L')})`,`=COUNTIF(${Sc('C')},A${rr})`,`=IFERROR(C${rr}/B${rr},0)`]:['','','','']);
    const hs=i===0?['현황','건수']:(STATUS[i-1]?[STATUS[i-1],`=COUNTIF(${Tc('P')},F${rr})`]:['','']);
    const hp=i===0?['우선순위','채용필요']:(PRIO[i-1]?[PRIO[i-1],`=SUMIF(${Tc('B')},I${rr},${Tc('L')})`]:['','']);
    helper.push([...hc,'',...hs,'',...hp]);}
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!M28:U140"});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A201:K230"});
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:'대시보드!M1',values:kpi},{range:'대시보드!A201',values:helper},
  ]}});

  // 서식
  const req=[];
  const fill=(rn,c)=>({repeatCell:{range:{sheetId:DASH,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:7},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{foregroundColor:WHITE,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:11,endRowIndex:12,startColumnIndex:0,endColumnIndex:7},cell:{userEnteredFormat:{backgroundColor:C1,textFormat:{foregroundColor:WHITE,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  l1.forEach(rn=>req.push(fill(rn,C1)));l2.forEach(rn=>req.push(fill(rn,C2)));l3.forEach(rn=>req.push(fill(rn,C3)));
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:0,endColumnIndex:7},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:4,endColumnIndex:6},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:10,endRowIndex:11,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:3,endRowIndex:4,startColumnIndex:13,endColumnIndex:14},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},textFormat:{bold:true}}},fields:'userEnteredFormat(numberFormat,textFormat)'}});
  [[0,70],[1,130],[2,150],[3,150],[4,110],[5,90],[6,90]].forEach(([c,px])=>req.push({updateDimensionProperties:{range:{sheetId:DASH,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});

  // ===== TEST 서식 정리 (잔여=숫자, 예정충원율=%, 채용필요/입사예정=숫자) =====
  const rg=(c0,c1)=>({sheetId:GID_T,startRowIndex:1,endRowIndex:2000,startColumnIndex:c0,endColumnIndex:c1});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:rg(11,14),cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}}, // L,M,N 숫자
    {repeatCell:{range:rg(14,15),cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}}, // O 예정충원율 %
  ]}});

  // 차트 재생성
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.sheetId===DASH);
  const delc=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(delc.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delc}});
  const sr=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  const nb=centers.length;const colC=(t,r0,r1,d,ser,ar,ac)=>({addChart:{chart:{spec:{title:t,basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:sr(r0,r1,d)}],series:ser.map(c=>({series:sr(r0,r1,c),targetAxis:'LEFT_AXIS'}))}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:380,heightPixels:220}}}}});
  const pieC=(t,r0,r1,d,se,ar,ac)=>({addChart:{chart:{spec:{title:t,pieChart:{legendPosition:'RIGHT_LEGEND',domain:sr(r0,r1,d),series:sr(r0,r1,se)}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:380,heightPixels:220}}}}});
  const charts=[
    colC('본부별 채용필요 vs 실제입사',200,200+nb,0,[1,2],5,12),
    colC('본부별 채용달성률',200,200+nb,0,[3],5,18),
    pieC('채용현황 단계별 분포',200,206,5,6,18,12),
    colC('우선순위별 채용필요',200,204,8,[9],18,18),
  ];
  const resp=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:charts}});
  console.log(`완료: 부문 ${l1.length} · 본부 ${l2.length} · 실/부 ${l3.length} · 데이터 ${START}~${totalRow} · 차트 ${resp.data.replies.filter(x=>x.addChart).length}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
