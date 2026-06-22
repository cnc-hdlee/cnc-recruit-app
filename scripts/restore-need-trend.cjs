/* 추이: 채용필요(누적)를 flat목표 → 차오르는 누적선으로 복원 (전체 227 도달).
   날짜있는것 월누적 + 날짜없는것(라인/완료) 현재월 반영. 달성률=입사/전사합계(227,고정). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';
const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const rng=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A108:E130`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 let hdrRow=null,totRow=null;rng.forEach((r,i)=>{const rn=i+108;if(String(r[1]||'').includes('채용목표')||String(r[1]||'').includes('채용필요(누적)'))hdrRow=rn;if(String(r[0]||'').includes('전사 합계'))totRow=rn;});
 console.log('헤더행:',hdrRow,'전사합계행:',totRow);if(!hdrRow||!totRow)return;
 const first=hdrRow+1,last=hdrRow+8;
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A${hdrRow}:E${last}`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_need_trend_20260622.json'),JSON.stringify(bak,null,1));
 const datedCum=(c,r)=>`SUMIFS(${P}!$${c}$5:$${c}$2029,${P}!$A$5:$A$2029,"<="&EOMONTH($A${r},0))`;
 const undated=c=>`SUMIFS(${P}!$${c}$5:$${c}$2029,${P}!$A$5:$A$2029,"")`;
 const data=[{range:`'${TAB}'!B${hdrRow}`,values:[['채용필요(누적)']]}];
 for(let r=first;r<=last;r++){
   const b=`=${datedCum('N',r)}+IF(EOMONTH($A${r},0)>=EOMONTH(TODAY(),0),${undated('N')},0)`; // 채용필요 누적 → 227
   const d=`=IFERROR(C${r}/$B$${totRow},0)`; // 달성률 = 누적입사 / 전사합계(227)
   data.push({range:`'${TAB}'!B${r}`,values:[[b]]});
   data.push({range:`'${TAB}'!D${r}`,values:[[d]]});
 }
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A${hdrRow}:D${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 추이 (채용필요 누적 복원) ===');chk.forEach((r,i)=>console.log(`r${i+hdrRow}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
