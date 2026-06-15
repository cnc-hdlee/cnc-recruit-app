/* 대시보드 좌측: 본부 ▸ 실/부 ▸ 팀 3단계 계층 (조직도 기준). 전부 수식. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TEST='RAW DATA_정리본(test)';
const NAVY={red:0.12,green:0.22,blue:0.39};const STEEL={red:0.30,green:0.42,blue:0.60};const WHITE={red:1,green:1,blue:1};
const GREY={red:0.90,green:0.92,blue:0.96};
const clean=x=>String(x==null?'':x).trim();
const q=s=>String(s).replace(/"/g,'""');
const Tc=c=>`'${TEST}'!$${c}$2:$${c}$2000`;const Sc=c=>`'_src'!$${c}$2:$${c}$2000`;
const ORDER=['생산본부','제품개발본부','경영기획본부','OD본부','CEO직속'];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TEST}'!A2:Q2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // 트리: 본부 ▸ 실/부 ▸ 팀
  const tree={};const bord=[];
  tv.forEach(r=>{const b=clean((r||[])[2]);if(!b)return;const sb=clean((r||[])[3])||'(본부 직속)';const tm=clean((r||[])[4]);
    if(!tree[b]){tree[b]={ord:[],sub:{}};bord.push(b);}
    if(!tree[b].sub[sb]){tree[b].sub[sb]=[];tree[b].ord.push(sb);}
    if(tm&&!tree[b].sub[sb].includes(tm))tree[b].sub[sb].push(tm);});
  const order=[...ORDER.filter(b=>tree[b]),...bord.filter(b=>!ORDER.includes(b))];

  const START=13;let r=START;const rows=[];const navy=[],steel=[];
  const sumB=b=>`=SUMIF(${Tc('C')},"${q(b)}",${Tc('K')})`;
  const cntB=b=>`=COUNTIF(${Sc('B')},"${q(b)}")`;
  const sumBS=(b,sb)=>`=SUMIFS(${Tc('K')},${Tc('C')},"${q(b)}",${Tc('D')},"${q(sb==='(본부 직속)'?'':sb)}")`;
  const cntBS=(b,sb)=>`=COUNTIFS(${Sc('B')},"${q(b)}",${Sc('F')},"${q(sb==='(본부 직속)'?'':sb)}")`;
  const sumBST=(b,sb,tm)=>`=SUMIFS(${Tc('K')},${Tc('C')},"${q(b)}",${Tc('D')},"${q(sb==='(본부 직속)'?'':sb)}",${Tc('E')},"${q(tm)}")`;
  const cntBST=(b,sb,tm)=>`=COUNTIFS(${Sc('B')},"${q(b)}",${Sc('F')},"${q(sb==='(본부 직속)'?'':sb)}",${Sc('C')},"${q(tm)}")`;
  const ratio=rr=>`=IFERROR(E${rr}/D${rr},0)`;

  for(const b of order){
    rows.push([b,'','',sumB(b),cntB(b),ratio(r)]);navy.push(r);r++;
    for(const sb of tree[b].ord){
      rows.push(['',sb,'',sumBS(b,sb),cntBS(b,sb),ratio(r)]);steel.push(r);r++;
      for(const tm of tree[b].sub[sb]){
        rows.push(['','',tm,sumBST(b,sb,tm),cntBST(b,sb,tm),ratio(r)]);r++;
      }
    }
  }
  rows.push(['◆ 전사 합계','','',`=SUM(${Tc('K')})`,`=COUNTA(${Sc('E')})`,ratio(r)]);const totalRow=r;

  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A11:L120"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A11',valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['🏢  본부 ▸ 실/부 ▸ 팀  채용현황','','','','',''],
    ['본부','실/부','팀','채용 필요 (건)','실제입사','달성률'],
    ...rows,
  ]}});

  const req=[];
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:11,endRowIndex:12,startColumnIndex:0,endColumnIndex:6},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  navy.forEach(rn=>req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:6},cell:{userEnteredFormat:{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  steel.forEach(rn=>req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:rn-1,endRowIndex:rn,startColumnIndex:0,endColumnIndex:6},cell:{userEnteredFormat:{backgroundColor:STEEL,textFormat:{foregroundColor:WHITE,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}}));
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:totalRow-1,endRowIndex:totalRow,startColumnIndex:0,endColumnIndex:6},cell:{userEnteredFormat:{backgroundColor:GREY,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}});
  // D,E 정수 / F 퍼센트
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:3,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:START-1,endRowIndex:totalRow,startColumnIndex:5,endColumnIndex:6},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}});
  req.push({repeatCell:{range:{sheetId:DASH,startRowIndex:10,endRowIndex:11,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:req}});
  console.log(`3단 계층 완료: 본부 ${navy.length} · 실/부 ${steel.length} · 데이터 ${START}~${totalRow-1} · 합계 ${totalRow}`);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
