/* 모든 달성률 100% 캡 확인 + KPI 캡 적용. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const num=x=>Number(String(x==null?'':x).replace(/[^\d.-]/g,''))||0;
(async()=>{const s=await auth();
 // KPI F열 수식 확인
 const kf=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A2:F9`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('KPI 달성률(F) 수식 샘플:',kf[2]&&kf[2][5]);
 // KPI: 채용필요B, 완료C, 예정D, 미충원E, 달성률F → MIN(C+D,B)/B 캡
 const data=[];for(let r=3;r<=9;r++){const row=kf[r-2];if(row&&row[0]&&num(row[1])>=0&&String(row[0]).trim()){data.push({range:`'대시보드'!F${r}`,values:[[`=IF($B${r}=0,"-",MIN($C${r}+$D${r},$B${r})/$B${r})`]]});}}
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,3000));
 // 전수 스캔: 100% 초과 있나
 const scan=async(range,pcols)=>{const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];const over=[];v.forEach((r,i)=>{(r||[]).forEach((c,ci)=>{const str=String(c);if(str.includes('%')){const p=num(str);if(p>100)over.push(`${range.split('!')[0]} r${i}+ c${ci} = ${str}`);}});});return over;};
 const a=await scan(`'대시보드'!A2:F9`);const b=await scan(`'대시보드'!A11:E112`);const c=await scan(`'대시보드'!G46:N54`);
 const all=[...a,...b,...c];
 console.log('\n100% 초과 달성률 셀:',all.length?all.join(' / '):'없음 ✅ (전부 100% 이하)');
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A2:F9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\nKPI:');k.forEach(r=>{if(r&&r[0]&&r[0].trim())console.log('  '+JSON.stringify(r));});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
