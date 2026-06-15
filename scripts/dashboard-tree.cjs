/* 대시보드(A열~): 본부 ▸ 센터 ▸ 기능그룹 ▸ 팀 (기능별 그룹) + 단계별 지표
 * 출처: RAW DATA_정리본 (B본부 C센터 E팀 / N서류 O1차 Q2차 S CPI U처우 Z입사 I후보자) */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TEST='RAW DATA_정리본';
const C1={red:0.10,green:0.18,blue:0.32};const C2={red:0.20,green:0.34,blue:0.55};const C3={red:0.80,green:0.86,blue:0.94};const WHITE={red:1,green:1,blue:1};const GREY={red:0.9,green:0.92,blue:0.96};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const R=c=>`'${TEST}'!$${c}$2:$${c}$3000`;
const ORDER=['COO','CRIO','CBO','CFO','크리에이티브솔루션'];
const HEAD=['조직','지원','서류합격','1차합격','2차합격','CPI통과','처우동의','입사','입사율'];
const CL=['','B','C','D','E','F','G','H'];
const gkey=t=>{const k=t.replace(/[0-9]/g,'').replace(/팀$/,'').trim();return k||t;};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!B2:E3000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // 본부 ▸ 센터 ▸ 기능그룹 ▸ 팀
  const tree={};const bo=[];
  v.forEach(r=>{const b=clean(r[0]);if(!b)return;const c=clean(r[1])||'(미지정)';const e=clean(r[3]);if(!e)return;const g=gkey(e);
    tree[b]=tree[b]||{ord:[],c:{}};if(!tree[b].c[c]){tree[b].c[c]={ord:[],g:{}};tree[b].ord.push(c);}
    const C=tree[b].c[c];if(!C.g[g]){C.g[g]=[];C.ord.push(g);}if(!C.g[g].includes(e))C.g[g].push(e);
    if(!bo.includes(b))bo.push(b);});
  const order=[...ORDER.filter(b=>tree[b]),...bo.filter(b=>!ORDER.includes(b))];

  const M=(keys)=>{const C=extra=>{const p=[...keys,...(extra||[])];const a=[];for(let i=0;i<p.length;i+=2)a.push(`${R(p[i])},"${q(p[i+1])}"`);return '=COUNTIFS('+a.join(',')+')';};
    return [C(),C(['N','합격']),C(['O','합격']),C(['Q','합격']),C(['S','통과']),C(['U','동의']),C(['Z','<>'])];};
  const rate=rr=>`=IFERROR(H${rr}/B${rr},0)`;
  const IND={c:'    ',g:'        ',e:'            '};

  const START=5;let r=START;const rows=[];const l1=[],l2=[],l3=[],patches=[];
  for(const b of order){
    rows.push([b,...M(['B',b]),rate(r)]);l1.push(r);r++;
    for(const c of tree[b].c?tree[b].ord:[]){
      rows.push([IND.c+c,...M(['B',b,'C',c==='(미지정)'?'':c]),rate(r)]);l2.push(r);r++;
      for(const g of tree[b].c[c].ord){
        const teams=tree[b].c[c].g[g];
        if(teams.length>=2){
          const gRow=r;rows.push([IND.g+g,'','','','','','','','']);l3.push(r);r++;
          const tStart=r;
          for(const e of teams){rows.push([IND.e+e,...M(['B',b,'C',c==='(미지정)'?'':c,'E',e]),rate(r)]);r++;}
          patches.push({gRow,tStart,tEnd:r-1});
        } else {
          rows.push([IND.g+teams[0],...M(['B',b,'C',c==='(미지정)'?'':c,'E',teams[0]]),rate(r)]);l3.push(r);r++;
        }
      }
    }
    rows.push(['','','','','','','','','']);r++;
  }
  rows.push(['◆ 전사 합계',`=COUNTA(${R('I')})`,`=COUNTIF(${R('N')},"합격")`,`=COUNTIF(${R('O')},"합격")`,`=COUNTIF(${R('Q')},"합격")`,`=COUNTIF(${R('S')},"통과")`,`=COUNTIF(${R('U')},"동의")`,`=COUNTIF(${R('Z')},"<>")`,rate(r)]);const totalRow=r;
  // 그룹 소계 = 팀 행 SUM
  patches.forEach(p=>{const row=rows[p.gRow-START];for(let ci=1;ci<=7;ci++)row[ci]=`=SUM(${CL[ci]}${p.tStart}:${CL[ci]}${p.tEnd})`;row[8]=`=IFERROR(H${p.gRow}/B${p.gRow},0)`;});

  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.sheetId===DASH);
  const reqs0=[{unmergeCells:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:400,startColumnIndex:0,endColumnIndex:40}}}];
  (dsh.charts||[]).forEach(c=>reqs0.push({deleteEmbeddedObject:{objectId:c.chartId}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs0}});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A1:Z400"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A1',valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['🏢  채용 통합 대시보드'],
    [`="총 지원 "&COUNTA(${R('I')})&"명   ·   입사 "&COUNTIF(${R('Z')},"<>")&"명   ·   입사율 "&TEXT(IFERROR(COUNTIF(${R('Z')},"<>")/COUNTA(${R('I')}),0),"0.0%")`],
  ]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A4',valueInputOption:'USER_ENTERED',requestBody:{values:[HEAD,...rows]}});

  const req=[];
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:3,endRowIndex:4,startColumnIndex:0,endColumnIndex:9},cell:{userEnteredFormat:{backgroundColor:C1,textFormat:{foregroundColor:WHITE,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  const fill=(arr,c,white)=>arr.forEach(rn=>req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:9},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{foregroundColor:white?WHITE:{red:0,green:0,blue:0},bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  fill(l1,C1,true);fill(l2,C2,true);fill(l3,C3,false);
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:0,endColumnIndex:9},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:1,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:8,endColumnIndex:9},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:15}}},fields:'userEnteredFormat.textFormat'}});
  [[0,260],[1,60],[2,75],[3,70],[4,70],[5,75],[6,75],[7,60],[8,75]].forEach(([c,px])=>req.push({updateDimensionProperties:{range:{sheetId:DASH,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});
  console.log(`완료: 본부 ${l1.length} 센터 ${l2.length} 그룹/솔로 ${l3.length} / 행 ${START}~${totalRow}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
