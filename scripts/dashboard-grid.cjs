/* 대시보드 그리드 레이아웃: 상단 가로 5박스 + 하단 부문블록 2단 그리드 (출처: RAW DATA_채용요청(현재)) */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const SRC='RAW DATA_채용요청(현재)';
const C1={red:0.10,green:0.18,blue:0.32},C2={red:0.20,green:0.34,blue:0.55},C3={red:0.82,green:0.87,blue:0.94};
const WHITE={red:1,green:1,blue:1},GREY={red:0.9,green:0.92,blue:0.96},HDRC={red:0.16,green:0.28,blue:0.45},BRD={red:0.45,green:0.5,blue:0.6};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const colL=i=>{let s='';i+=1;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;};
const T=c=>`'${SRC}'!$${c}$2:$${c}$2000`;
const SI=(keys,col)=>{const a=[];for(let i=0;i<keys.length;i+=2)a.push(`${T(keys[i])},"${q(keys[i+1])}"`);return `=SUMIFS(${T(col)},${a.join(',')})`;};
const ORDER=['COO','CRIO','CBO','CFO','크리에이티브솔루션','CEO'];
const HQ=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부','CEO직속'];
const IND={s:'   ',t:'      '};const K=x=>x==='(직속)'?'':x;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title,sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.title==='대시보드');const GID=dsh.properties.sheetId;
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${SRC}'!A2:S2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const tree={};const bo=[];
  v.forEach(r=>{const bm=clean(r[2]);if(!bm)return;const b=clean(r[3]);const sb=clean(r[4])||'(직속)';const tm=clean(r[5]);
    tree[bm]=tree[bm]||{ord:[],b:{}};if(!tree[bm].b[b]){tree[bm].b[b]={ord:[],s:{}};tree[bm].ord.push(b);}
    const B=tree[bm].b[b];if(!B.s[sb]){B.s[sb]=[];B.ord.push(sb);}if(tm&&!B.s[sb].includes(tm))B.s[sb].push(tm);
    if(!bo.includes(bm))bo.push(bm);});
  const order=[...ORDER.filter(b=>tree[b]),...bo.filter(b=>!ORDER.includes(b))];

  const data=[];const fmt=[];const borders=[];
  const fillRow=(row,c0,c1,bg,white)=>fmt.push({repeatCell:{range:{sheetId:GID,startRowIndex:row-1,endRowIndex:row,startColumnIndex:c0,endColumnIndex:c1},cell:{userEnteredFormat:{backgroundColor:bg,textFormat:{foregroundColor:white?WHITE:{red:0,green:0,blue:0},bold:true,fontSize:10}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  const box=(r0,r1,c0,c1)=>borders.push({updateBorders:{range:{sheetId:GID,startRowIndex:r0-1,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},top:{style:'SOLID',color:BRD},bottom:{style:'SOLID',color:BRD},left:{style:'SOLID',color:BRD},right:{style:'SOLID',color:BRD},innerHorizontal:{style:'SOLID',color:{red:0.85,green:0.87,blue:0.9}},innerVertical:{style:'SOLID',color:{red:0.85,green:0.87,blue:0.9}}}});
  const numFmt=(r0,r1,c0,c1,pct)=>fmt.push({repeatCell:{range:{sheetId:GID,startRowIndex:r0-1,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},cell:{userEnteredFormat:{numberFormat:{type:pct?'PERCENT':'NUMBER',pattern:pct?'0.0%':'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});

  // ===== 상단 가로 5박스 =====
  const HR=4; // 박스 헤더행
  const mkBox=(c0,title,col,vals,isStat)=>{
    const FL=colL(c0+1),PL=colL(c0+2);
    const head=isStat?[title,'건수']:[title,'필요','예정','달성률'];
    const rows=[head];vals.forEach((x,i)=>{const rr=HR+1+i;
      if(isStat)rows.push([x,`=COUNTIF(${T(col)},"${q(x)}")`+(x==='면접예정'?`+COUNTIF(${T(col)},"면접에정")`:'')]);
      else rows.push([x,`=SUMIF(${T(col)},"${q(x)}",${T('M')})`,`=SUMIF(${T(col)},"${q(x)}",${T('O')})`,`=IFERROR(${PL}${rr}/${FL}${rr},0)`]);});
    data.push({range:`대시보드!${colL(c0)}${HR}`,values:rows});
    const w=isStat?2:4;fillRow(HR,c0,c0+w,HDRC,true);box(HR,HR+vals.length,c0,c0+w);
    if(!isStat)numFmt(HR+1,HR+vals.length,c0+3,c0+4,true);
    return HR+vals.length;
  };
  mkBox(0,'본부별','D',HQ,false);
  mkBox(5,'우선순위','B',['P0','P1','P2','P3'],false);
  mkBox(10,'채용사유','H',['신규','결원'],false);
  mkBox(15,'현황단계','L',['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'],true);
  mkBox(18,'근무지','J',['퍼플','그린','수원','서울','방교'],false);
  const topEnd=HR+Math.max(HQ.length,6); // 박스 영역 끝

  // ===== 하단 부문 블록 2단 그리드 =====
  const block=(bm,c0,startRow)=>{
    const FL=colL(c0+1),PL=colL(c0+2);const rem=rr=>`=${FL}${rr}-${PL}${rr}`,ac=rr=>`=IFERROR(${PL}${rr}/${FL}${rr},0)`;
    const vals=[['■ '+bm+' 부문','','','',''],['조직','채용필요','입사예정','잔여','달성률']];let rr=startRow+2;const l1=[],l2=[],l3=[];
    for(const b of tree[bm].ord){
      for(const sb of tree[bm].b[b].ord){
        for(const tm of tree[bm].b[b].s[sb]){vals.push([IND.t+tm,SI(['C',bm,'D',b,'E',K(sb),'F',tm],'M'),SI(['C',bm,'D',b,'E',K(sb),'F',tm],'O'),rem(rr),ac(rr)]);rr++;}
        vals.push([IND.s+sb+' 소계',SI(['C',bm,'D',b,'E',K(sb)],'M'),SI(['C',bm,'D',b,'E',K(sb)],'O'),rem(rr),ac(rr)]);l3.push(rr);rr++;
      }
      vals.push([b+' 소계',SI(['C',bm,'D',b],'M'),SI(['C',bm,'D',b],'O'),rem(rr),ac(rr)]);l2.push(rr);rr++;
    }
    vals.push([bm+' 부문 소계',SI(['C',bm],'M'),SI(['C',bm],'O'),rem(rr),ac(rr)]);l1.push(rr);rr++;
    const endRow=rr-1;
    data.push({range:`대시보드!${colL(c0)}${startRow}`,values:vals});
    fillRow(startRow,c0,c0+5,C1,true);            // 부문 타이틀바
    fillRow(startRow+1,c0,c0+5,HDRC,true);         // 헤더
    l2.forEach(x=>fillRow(x,c0,c0+5,C2,true));l3.forEach(x=>fillRow(x,c0,c0+5,C3,false));
    fillRow(l1[0],c0,c0+5,GREY,false);
    numFmt(startRow+2,endRow,c0+1,c0+4,false);numFmt(startRow+2,endRow,c0+4,c0+5,true);
    box(startRow,endRow,c0,c0+5);
    return endRow;
  };
  const pairs=[];for(let i=0;i<order.length;i+=2)pairs.push([order[i],order[i+1]]);
  let row=topEnd+2;
  for(const [L,R] of pairs){
    const le=block(L,0,row);const re=R?block(R,7,row):row;
    row=Math.max(le,re)+2;
  }

  // ===== 쓰기 =====
  const reqs0=[{unmergeCells:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52}}}];
  (dsh.charts||[]).forEach(c=>reqs0.push({deleteEmbeddedObject:{objectId:c.chartId}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs0}});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A1:AZ600"});
  // 리셋(흰배경+테두리제거)
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52},cell:{userEnteredFormat:{textFormat:{fontSize:10,bold:false,foregroundColor:{red:0,green:0,blue:0}},backgroundColor:WHITE,horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)'}},
    {updateBorders:{range:{sheetId:GID,startRowIndex:0,endRowIndex:600,startColumnIndex:0,endColumnIndex:52},top:{style:'NONE'},bottom:{style:'NONE'},left:{style:'NONE'},right:{style:'NONE'},innerHorizontal:{style:'NONE'},innerVertical:{style:'NONE'}}},
  ]}});
  // 타이틀+KPI
  data.unshift({range:'대시보드!A1',values:[['🎯  채용 달성률 대시보드'],[`="총 채용필요 "&SUM(${T('M')})&"명   ·   입사예정 "&SUM(${T('O')})&"명   ·   잔여 "&(SUM(${T('M')})-SUM(${T('O')}))&"명   ·   채용달성률 "&TEXT(IFERROR(SUM(${T('O')})/SUM(${T('M')}),0),"0.0%")`]]});
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  fmt.unshift({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:15}}},fields:'userEnteredFormat.textFormat'}});
  fmt.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:11}}},fields:'userEnteredFormat.textFormat'}});
  // 열너비
  [[0,150],[1,70],[2,70],[3,70],[4,70],[5,110],[6,16],[7,150],[8,70],[9,70],[10,70],[11,90],[12,70],[13,70],[15,90],[16,60],[18,80],[19,70],[20,70],[21,70]].forEach(([c,px])=>fmt.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[...fmt,...borders]}});
  console.log('완료: 상단 5박스 + 하단 부문블록',order.length,'개 (2단 그리드), 마지막행',row);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
