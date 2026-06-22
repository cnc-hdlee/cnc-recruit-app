/* 채용완료 탭을 IMPORTRANGE하는 detail 행들의 현황(M)을 "입사완료"로 통일.
   그래야 SUMIFS(O,현황="입사완료")로 완료 16을 정확히 집계. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const PTAB='RAW DATA_채용진행상황(현재)';const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const fm=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V95`,valueRenderOption:'FORMULA'})).data.values||[];
 const fv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V95`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const data=[];const done=[];
 fm.forEach((r,i)=>{const rn=i+14;const nf=String((r||[])[13]||'');
   if(/채용완료!/.test(nf)){const cur=(fv[i]||[])[12]||'';if(cur!=='입사완료'){data.push({range:`'${PTAB}'!M${rn}`,values:[['입사완료']]});}
     done.push(`r${rn} ${(fv[i]||[])[6]}/${(fv[i]||[])[7]} (현황:${cur||'빈'})`);}});
 console.log('완료 행:',done.length);done.forEach(d=>console.log('  '+d));
 console.log('현황 수정:',data.length,'행');
 if(data.length)await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,3000));
 const t=[[`=SUMIFS(${P}!$O$3:$O$2026,${P}!$M$3:$M$2026,"입사완료")`],[`=SUMIFS(${P}!$N$3:$N$2026,${P}!$M$3:$M$2026,"입사완료")`]];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'_chartdata'!K1:K2`,valueInputOption:'USER_ENTERED',requestBody:{values:t}});
 await new Promise(r=>setTimeout(r,2500));
 const r=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!K1:K2`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n입사완료 O합=',r[0]&&r[0][0],' N합=',r[1]&&r[1][0]);
 await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'_chartdata'!K1:K2`]});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
