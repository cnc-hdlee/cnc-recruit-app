const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const num=x=>Number(String(x==null?'':x).replace(/[^\d.-]/g,''))||0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const col=c=>String.fromCharCode(65+c);
(async()=>{const s=await auth();
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E46`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const bu=['생산1부','생산2부','생산3부','제조부','자재물류부','품질경영','생산기획부'];let sum=0;
 bu.forEach(b=>{const r=v.find(x=>String(x[0]||'').includes(b+' 소계'));if(r)sum+=num(r[1]);});
 const sis=v.find(x=>/시설안전/.test(String(x[0]||'')));sum+=num(sis&&sis[1]);
 const bb=v.find(x=>/생산본부 소계/.test(String(x[0]||'')));
 console.log(`부소계합(시설안전 포함) ${sum} =? 생산본부 소계 ${num(bb&&bb[1])} ${sum===num(bb&&bb[1])?'✓':'✗'}`);
 // 전사합계 + KPI + 오류
 const t=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A107:E110`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const tot=t.find(r=>/전사 합계/.test(String(r&&r[0]||'')));
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!B9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log(`전사합계 ${tot&&tot[1]} =? KPI전체 ${k[0][0]} ${num(tot&&tot[1])===num(k[0][0])?'✓':'✗'}`);
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'대시보드'!A12:E112`],includeGridData:true})).data.sheets[0];
 const errs=[];(g.data[0].rowData||[]).forEach((rd,ri)=>{(rd.values||[]).forEach((c,ci)=>{if((c.effectiveValue||{}).errorValue)errs.push(`${col(ci)}${ri+12}`);});});
 console.log('트리 오류:',errs.length?errs.join(','):'0개 ✅');
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
