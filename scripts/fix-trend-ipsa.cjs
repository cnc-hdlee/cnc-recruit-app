/* 추이 누적입사: 날짜있는것 월누적 + 날짜없는것(라인/완료 31명) 현재월부터 반영 → 엔드포인트=전체63.
   달성률 = 누적입사/목표(B). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';
const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const rng=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A108:E130`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 let hdrRow=null;rng.forEach((r,i)=>{if(String(r[1]||'').includes('채용목표')||String(r[1]||'').includes('채용필요(누적)'))hdrRow=i+108;});
 console.log('추이 헤더행:',hdrRow);if(!hdrRow)return;
 const first=hdrRow+1,last=hdrRow+8;
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A${first}:E${last}`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_trend_ipsa_20260622.json'),JSON.stringify(bak,null,1));
 const datedCum=r=>`SUMIFS(${P}!$O$5:$O$2029,${P}!$A$5:$A$2029,"<="&EOMONTH($A${r},0))`;
 const undated=`SUMIFS(${P}!$O$5:$O$2029,${P}!$A$5:$A$2029,"")`;
 const data=[];
 for(let r=first;r<=last;r++){
   const c=`=${datedCum(r)}+IF(EOMONTH($A${r},0)>=EOMONTH(TODAY(),0),${undated},0)`;
   const d=`=IFERROR(C${r}/B${r},0)`;
   data.push({range:`'${TAB}'!C${r}`,values:[[c]]});
   data.push({range:`'${TAB}'!D${r}`,values:[[d]]});
 }
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A${hdrRow}:D${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 추이 (입사 누적 보정 후) ===');chk.forEach((r,i)=>console.log(`r${i+hdrRow}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
