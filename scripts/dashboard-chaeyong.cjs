/* 대시보드: 채용달성률 (출처: RAW DATA_채용요청(현재)). 테두리+공백으로 구분, 레이아웃 정리.
 * 메인(A~E): 부문▸본부▸실/부▸팀 달성률. 사이드(G~J): 본부/우선순위/사유/현황/근무지. 차트(L~). */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500729561;const SRC='RAW DATA_채용요청(현재)';
const C1={red:0.10,green:0.18,blue:0.32};const C2={red:0.20,green:0.34,blue:0.55};const C3={red:0.82,green:0.87,blue:0.94};const WHITE={red:1,green:1,blue:1};const GREY={red:0.9,green:0.92,blue:0.96};const HDRC={red:0.16,green:0.28,blue:0.45};
const BRD={red:0.45,green:0.5,blue:0.6};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const T=c=>`'${SRC}'!$${c}$2:$${c}$2000`;
const ORDER=['COO','CRIO','CBO','CFO','크리에이티브솔루션','OD','CEO'];
const HQ=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부','CEO직속'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // 대시보드 gid 확인
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title,sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.title==='대시보드');const GID=dsh.properties.sheetId;
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${SRC}'!A2:S2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const tree={};const bo=[];
  v.forEach(r=>{const bm=clean(r[2]);if(!bm)return;const b=clean(r[3]);const sb=clean(r[4])||'(직속)';const tm=clean(r[5]);
    tree[bm]=tree[bm]||{ord:[],b:{}};if(!tree[bm].b[b]){tree[bm].b[b]={ord:[],s:{}};tree[bm].ord.push(b);}
    const B=tree[bm].b[b];if(!B.s[sb]){B.s[sb]=[];B.ord.push(sb);}if(tm&&!B.s[sb].includes(tm))B.s[sb].push(tm);
    if(!bo.includes(bm))bo.push(bm);});
  const order=[...ORDER.filter(b=>tree[b]),...bo.filter(b=>!ORDER.includes(b))];
  const SI=(keys,col)=>{const a=[];for(let i=0;i<keys.length;i+=2)a.push(`${T(keys[i])},"${q(keys[i+1])}"`);return `=SUMIFS(${T(col)},${a.join(',')})`;};
  const K=x=>x==='(직속)'?'':x;const IND={b:'   ',s:'      ',t:'         '};
  const remain=rr=>`=B${rr}-C${rr}`, ach=rr=>`=IFERROR(C${rr}/B${rr},0)`;

  // subtotal-below: 하위(팀)을 위로, 소계를 아래로
  const START=5;let r=START;const rows=[];const l1=[],l2=[],l3=[];
  for(const bm of order){
    for(const b of tree[bm].ord){
      for(const sb of tree[bm].b[b].ord){
        for(const tm of tree[bm].b[b].s[sb]){rows.push([IND.t+tm,SI(['C',bm,'D',b,'E',K(sb),'F',tm],'M'),SI(['C',bm,'D',b,'E',K(sb),'F',tm],'N'),remain(r),ach(r)]);r++;} // 팀 먼저
        rows.push([IND.s+sb+' 소계',SI(['C',bm,'D',b,'E',K(sb)],'M'),SI(['C',bm,'D',b,'E',K(sb)],'N'),remain(r),ach(r)]);l3.push(r);r++; // 실/부 소계
      }
      rows.push([IND.b+b+' 소계',SI(['C',bm,'D',b],'M'),SI(['C',bm,'D',b],'N'),remain(r),ach(r)]);l2.push(r);r++; // 본부 소계
    }
    rows.push([bm+' 소계',SI(['C',bm],'M'),SI(['C',bm],'N'),remain(r),ach(r)]);l1.push(r);r++; // 부문 소계
    rows.push(['','','','','']);r++; // 공백
  }
  rows.push(['◆ 전사 합계',`=SUM(${T('M')})`,`=SUM(${T('N')})`,remain(r),ach(r)]);const totalRow=r;

  // 사이드 표 (고정 위치, 공백 구분). 각 [headerRow, label, col, vals, isStatus]
  const SIDE=[
    [4,'본부별','D',HQ,false],
    [4+HQ.length+3,'우선순위','B',['P0','P1','P2','P3'],false],
    [4+HQ.length+3+6,'채용사유','H',['신규','결원'],false],
    [4+HQ.length+3+6+4,'현황 단계','L',['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'],true],
    [4+HQ.length+3+6+4+8,'근무지','J',['퍼플','그린','수원','서울','방교'],false],
  ];
  const sideData=[];
  SIDE.forEach(([hr,label,col,vals,isStat])=>{
    const out=[[label,isStat?'건수':'채용필요',isStat?'':'입사예정',isStat?'':'달성률']];
    vals.forEach((x,i)=>{const rr=hr+1+i;if(isStat)out.push([x,`=COUNTIF(${T(col)},"${q(x)}")`+(x==='면접예정'?`+COUNTIF(${T(col)},"면접에정")`:''),'','']);
      else out.push([x,`=SUMIF(${T(col)},"${q(x)}",${T('M')})`,`=SUMIF(${T(col)},"${q(x)}",${T('N')})`,`=IFERROR(I${rr}/H${rr},0)`]);});
    sideData.push({range:`대시보드!G${hr}`,values:out,hr,len:out.length,isStat});
  });

  // 쓰기
  const reqs0=[{unmergeCells:{range:{sheetId:GID,startRowIndex:0,endRowIndex:400,startColumnIndex:0,endColumnIndex:40}}}];
  (dsh.charts||[]).forEach(c=>reqs0.push({deleteEmbeddedObject:{objectId:c.chartId}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs0}});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A1:Z400"});
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:'대시보드!A1',values:[['🎯  채용 달성률 대시보드'],[`="총 채용필요 "&SUM(${T('M')})&"명   ·   입사예정 "&SUM(${T('N')})&"명   ·   잔여 "&(SUM(${T('M')})-SUM(${T('N')}))&"명   ·   채용달성률 "&TEXT(IFERROR(SUM(${T('N')})/SUM(${T('M')}),0),"0.0%")`]]},
    {range:'대시보드!A4',values:[['조직  (부문 ▸ 본부 ▸ 실/부 ▸ 팀)','채용필요인원','입사예정','잔여','달성률'],...rows]},
    ...sideData.map(d=>({range:d.range,values:d.values})),
  ]}});

  // 서식 + 테두리
  const req=[];
  // 0) 전체 서식 리셋 (폰트 10 통일, 배경 흰색, 테두리 제거 — 넓게)
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52},cell:{userEnteredFormat:{textFormat:{fontSize:10,bold:false,foregroundColor:{red:0,green:0,blue:0}},backgroundColor:WHITE,horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)'}});
  req.push({updateBorders:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52},top:{style:'NONE'},bottom:{style:'NONE'},left:{style:'NONE'},right:{style:'NONE'},innerHorizontal:{style:'NONE'},innerVertical:{style:'NONE'}}});
  // 숫자서식 잔재 제거 (입사예정 등에 남은 % 서식)
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}});
  // 타이틀/KPI 폰트
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat.textFormat'}});
  const box=(r0,r1,c0,c1)=>{const side={style:'SOLID',color:BRD};return {updateBorders:{range:{sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},top:side,bottom:side,left:side,right:side,innerHorizontal:{style:'SOLID',color:{red:0.85,green:0.87,blue:0.9}},innerVertical:{style:'SOLID',color:{red:0.85,green:0.87,blue:0.9}}}};};
  const hdr=(r,c0,c1)=>({repeatCell:{range:{sheetId:GID,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c0,endColumnIndex:c1},cell:{userEnteredFormat:{backgroundColor:HDRC,textFormat:{foregroundColor:WHITE,bold:true,fontSize:10},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  // 메인
  req.push(hdr(3,0,5));
  const fill=(arr,c)=>arr.forEach(rn=>req.push({repeatCell:{range:{sheetId:GID,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{foregroundColor:c===C3?{red:0,green:0,blue:0}:WHITE,bold:true,fontSize:10}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  fill(l1,C1);fill(l2,C2);fill(l3,C3);
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true,fontSize:10}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:1,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:15}}},fields:'userEnteredFormat.textFormat'}});
  req.push(box(3,totalRow,0,5)); // 메인 테두리
  // 사이드: 헤더+달성률%+테두리
  sideData.forEach(d=>{req.push(hdr(d.hr-1,6,10));
    if(!d.isStat)req.push({repeatCell:{range:{sheetId:GID,startRowIndex:d.hr,endRowIndex:d.hr+d.len-1,startColumnIndex:9,endColumnIndex:10},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
    req.push({repeatCell:{range:{sheetId:GID,startRowIndex:d.hr,endRowIndex:d.hr+d.len-1,startColumnIndex:7,endColumnIndex:9},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}});
    req.push(box(d.hr-1,d.hr+d.len-1,6,10));});
  // 열너비 (F=공백)
  [[0,300],[1,100],[2,75],[3,65],[4,75],[5,24],[6,130],[7,75],[8,75],[9,75],[10,24]].forEach(([c,px])=>req.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});

  // 차트 (L열=11, 세로로 쌓아 겹침 방지)
  const sr=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  const colC=(t,r0,r1,d,ser,ar,ac,axMax)=>{const bc={chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:sr(r0,r1,d)}],series:ser.map(c=>({series:sr(r0,r1,c),targetAxis:'LEFT_AXIS'}))};if(axMax)bc.axis=[{position:'LEFT_AXIS',viewWindowOptions:{viewWindowMin:0,viewWindowMax:axMax}}];return {addChart:{chart:{spec:{title:t,basicChart:bc},position:{overlayPosition:{anchorCell:{sheetId:GID,rowIndex:ar,columnIndex:ac},widthPixels:440,heightPixels:230}}}}};};
  const pieC=(t,r0,r1,d,se,ar,ac)=>({addChart:{chart:{spec:{title:t,pieChart:{legendPosition:'RIGHT_LEGEND',domain:sr(r0,r1,d),series:sr(r0,r1,se)}},position:{overlayPosition:{anchorCell:{sheetId:GID,rowIndex:ar,columnIndex:ac},widthPixels:440,heightPixels:230}}}}});
  const bH=3,bE=3+HQ.length+1; const statHr=SIDE[3][0];
  const charts=[
    colC('본부별 채용달성률(%)',bH,bE,6,[9],2,11,1),
    colC('본부별 채용필요 vs 입사예정',bH,bE,6,[7,8],14,11,100),
    pieC('현황 단계별 분포',statHr-1,statHr+6,6,7,26,11),
  ];
  const resp=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:charts}});
  console.log(`완료: 본부 ${l2.length} 실/부 ${l3.length} / 메인 ${START}~${totalRow} / 사이드5 / 차트 ${resp.data.replies.filter(x=>x.addChart).length}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
