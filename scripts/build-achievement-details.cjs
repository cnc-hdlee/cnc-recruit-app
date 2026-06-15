/* 대시보드 채용달성률 세부: 본부별/실부별/팀별 (전부 수식). _src 실제입사 기준. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TEST='RAW DATA_정리본(test)';
const T=c=>`'${TEST}'!$${c}$2:$${c}$2000`;
const colL=i=>{let s='';i+=1;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // distinct 차원 (TEST에서)
  const tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!A2:Q2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const order=(idx)=>{const seen=[];tv.forEach(r=>{const x=String((r||[])[idx]||'').trim();if(x&&!/^\d+$/.test(x)&&!seen.includes(x))seen.push(x);});return seen;};
  const bonbu=order(2), silbu=order(3), team=order(4);
  console.log('본부',bonbu.length,'실/부',silbu.length,'팀',team.length);

  // _src!F : 입사자 팀 → 실/부 매핑(수식)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'_src!F1',valueInputOption:'USER_ENTERED',requestBody:{values:[['실/부(매핑)'],[`=ARRAYFORMULA(IF(C2:C="","",IFERROR(INDEX('${TEST}'!$D$2:$D$2000,MATCH(C2:C,'${TEST}'!$E$2:$E$2000,0)),"")))`]]}});

  // 테이블 작성기: 헤더+라벨+수식. dimCol=TEST차원컬럼, srcCol=_src카운트컬럼
  const buildTbl=(startCol,startRow,title,labels,dimCol,srcCntCol)=>{
    const data=[[title,'채용 필요 (건)','실제입사','달성률']];
    labels.forEach((lb,i)=>{const r=startRow+1+i;data.push([lb,
      `=SUMIF(${T(dimCol)},${colL(startCol)}${r},${T('K')})`,
      `=COUNTIF('_src'!$${srcCntCol}$2:$${srcCntCol}$2000,${colL(startCol)}${r})`,
      `=IF(${colL(startCol+1)}${r}=0,0,${colL(startCol+2)}${r}/${colL(startCol+1)}${r})`]);});
    return {range:`'대시보드'!${colL(startCol)}${startRow}`,values:data,rows:data.length,startRow,col달성:startCol+3};
  };
  // 본부별 M30(col12), 실/부별 M43, 팀별 R30(col17)
  const tB=buildTbl(12,30,'본부별',bonbu,'C','B');
  const tD=buildTbl(12,30+1+bonbu.length+2,'실/부별',silbu,'D','F');
  const tT=buildTbl(17,30,'팀별',team,'E','C');

  // KPI (M1:N4)
  const kpi=[['■ 채용 달성률 요약',''],['총 채용필요 (건)',`=SUM(${T('K')})`],['실제 입사 (명)','=COUNTA(\'_src\'!E2:E2000)'],['채용 달성률','=IF(N2=0,0,N3/N2)']];
  // 차트용 오프스크린 헬퍼(현황/우선순위) A200
  const STATUS=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];const PRIO=['P0','P1','P2','P3'];
  const st=[['현황','건수']];STATUS.forEach((x,i)=>st.push([x,`=COUNTIF(${T('O')},A${201+i})`]));
  const pr=[['우선순위','채용 필요 (건)']];PRIO.forEach((x,i)=>pr.push([x,`=SUMIF(${T('B')},D${201+i},${T('K')})`]));

  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:'대시보드!M1',values:kpi},
    {range:tB.range,values:tB.values},{range:tD.range,values:tD.values},{range:tT.range,values:tT.values},
    {range:'대시보드!A200',values:st.map((row,i)=>row.concat(pr[i]?['',...pr[i]]:['','','']))},
  ]}});
  console.log('KPI + 본부/실부/팀 테이블 + 헬퍼 작성');

  // 서식 + 차트
  const pctCol=(c,r0,r1)=>({repeatCell:{range:{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
  const hdrFmt=(c0,c1,r)=>({repeatCell:{range:{sheetId:DASH,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c0,endColumnIndex:c1},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  const fmt=[
    pctCol(15,tB.startRow,tB.startRow+bonbu.length+1),   // 본부 달성률 P
    pctCol(15,tD.startRow,tD.startRow+silbu.length+1),   // 실부 달성률 P
    pctCol(20,tT.startRow,tT.startRow+team.length+1),    // 팀 달성률 U
    pctCol(13,3,4),                                       // KPI 달성률 N4
    hdrFmt(12,16,tB.startRow-1),hdrFmt(12,16,tD.startRow-1),hdrFmt(17,21,tT.startRow-1),
    {repeatCell:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:1,startColumnIndex:12,endColumnIndex:13},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:fmt}});

  // 차트 재생성
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.sheetId===DASH);
  const delc=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(delc.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delc}});
  const sr=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  const W=360,H=210;
  const colC=(title,r0,r1,d,ser,ar,ac)=>({addChart:{chart:{spec:{title,basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:sr(r0,r1,d)}],series:ser.map(c=>({series:sr(r0,r1,c),targetAxis:'LEFT_AXIS'}))}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const pieC=(title,r0,r1,d,se,ar,ac)=>({addChart:{chart:{spec:{title,pieChart:{legendPosition:'RIGHT_LEGEND',domain:sr(r0,r1,d),series:sr(r0,r1,se)}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const bR0=tB.startRow-1, bR1=tB.startRow+bonbu.length; // 본부테이블 헤더~끝
  const charts=[
    colC('본부별 TO vs 실제입사',bR0,bR1,12,[13,14],5,12),
    colC('본부별 채용달성률',bR0,bR1,12,[15],5,18),
    pieC('채용현황 단계별 분포',199,206,0,1,17,12),
    colC('우선순위별 TO',199,204,3,[4],17,18),
  ];
  const resp=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:charts}});
  console.log('차트',resp.data.replies.filter(r=>r.addChart).length,'개 / 완료');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
