/* RAW DATA_오리지날 탭 오른쪽(AN~)에 부서별 다크블루 소계 요약 (지원/입사/입사율) */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=1257455662;const TAB='RAW DATA_오리지날';
const C1={red:0.09,green:0.16,blue:0.29};const C2={red:0.17,green:0.30,blue:0.50};const C3={red:0.40,green:0.52,blue:0.68};
const WHITE={red:1,green:1,blue:1};const GREY={red:0.88,green:0.90,blue:0.95};
const clean=x=>String(x==null?'':x).trim();const q=s=>String(s).replace(/"/g,'""');
const R=c=>`'${TAB}'!$${c}$2:$${c}$2000`; // B본부 C센터 D실부 E팀 Z실제입사일
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!B2:E2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const tree={};const bo=[];
  v.forEach(r=>{const b=clean(r[0]);if(!b)return;const c=clean(r[1])||'(미지정)';const d=clean(r[2])||'(직속)';const e=clean(r[3]);
    tree[b]=tree[b]||{ord:[],c:{}};if(!tree[b].c[c]){tree[b].c[c]={ord:[],d:{}};tree[b].ord.push(c);}
    const C=tree[b].c[c];if(!C.d[d]){C.d[d]=[];C.ord.push(d);}if(e&&!C.d[d].includes(e))C.d[d].push(e);
    if(!bo.includes(b))bo.push(b);});

  // 수식 (지원=count, 입사=실제입사일 있는 행)
  const ci=(...kv)=>{let p=`COUNTIFS(`;const parts=[];for(let i=0;i<kv.length;i+=2)parts.push(`${R(kv[i])},"${q(kv[i+1])}"`);return '='+p+parts.join(',')+')';};
  const cii=(...kv)=>{const parts=[];for(let i=0;i<kv.length;i+=2)parts.push(`${R(kv[i])},"${q(kv[i+1])}"`);parts.push(`${R('Z')},"<>"`);return '=COUNTIFS('+parts.join(',')+')';};
  const AN=39;const START=3;let r=START;const rows=[];const l1=[],l2=[],l3=[];
  const rt=rr=>`=IFERROR(AS${rr}/AR${rr},0)`; // AR지원 AS입사 AT입사율  (AN39 AO40 AP41 AQ42 AR43 AS44 AT45)
  for(const b of bo){
    rows.push([b,'','','',ci('B',b),cii('B',b),rt(r)]);l1.push(r);r++;
    for(const c of tree[b].ord){
      rows.push(['',c,'','',ci('B',b,'C',c),cii('B',b,'C',c),rt(r)]);l2.push(r);r++;
      for(const d of tree[b].c[c].ord){
        rows.push(['','',d,'',ci('B',b,'C',c,'D',d),cii('B',b,'C',c,'D',d),rt(r)]);l3.push(r);r++;
        for(const e of tree[b].c[c].d[d]){rows.push(['','','',e,ci('B',b,'C',c,'D',d,'E',e),cii('B',b,'C',c,'D',d,'E',e),rt(r)]);r++;}
      }
    }
    rows.push(['','','','','','','']);r++;
  }
  rows.push(['◆ 전사 합계','','',`=COUNTA(${R('I')})`,`=COUNTIF(${R('Z')},"<>")`,rt(r)]);const totalRow=r;

  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateSheetProperties:{properties:{sheetId:GID,gridProperties:{columnCount:48}},fields:'gridProperties.columnCount'}}]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!AN1`,valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['🏢  부서별 채용현황 (본부 ▸ 센터 ▸ 실/부 ▸ 팀)','','','','','',''],
    ['본부','센터','실/부','팀','지원','입사','입사율'],
    ...rows,
  ]}});
  const req=[];
  const fill=(rn,c)=>({repeatCell:{range:{sheetId:GID,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:AN,endColumnIndex:AN+7},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{foregroundColor:WHITE,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:AN,endColumnIndex:AN+7},cell:{userEnteredFormat:{backgroundColor:C1,textFormat:{foregroundColor:WHITE,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  l1.forEach(rn=>req.push(fill(rn,C1)));l2.forEach(rn=>req.push(fill(rn,C2)));l3.forEach(rn=>req.push(fill(rn,C3)));
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:AN,endColumnIndex:AN+7},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:45,endColumnIndex:46},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:AN,endColumnIndex:AN+1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}});
  [[39,80],[40,140],[41,150],[42,140],[43,70],[44,70],[45,70]].forEach(([c,px])=>req.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});
  console.log(`오리지날 소계 완료: 본부 ${l1.length} 센터 ${l2.length} 실/부 ${l3.length} / AN1~AT${totalRow}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
