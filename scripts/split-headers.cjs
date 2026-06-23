/* RAW 라인블록 헤더 소계를 칸별 분리: 라벨엔 이름만, 숫자는 N(채용필요)/O(입사)/U·V(재직) 각 컬럼에.
   헤더행 D/E/F/G/L 전부 빈칸이라 집계 영향 없음(추적가능). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A3:A7`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_headers_20260623.json'),JSON.stringify(bak,null,1));
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   // r3 ■ COO : 라벨만 + N채용필요 O입사 (COO 전체합)
   {range:`'${P}'!A3`,values:[['■ COO']]},
   {range:`'${P}'!N3`,values:[['=SUMIF($D$5:$D$105,"COO",$N$5:$N$105)']]},
   {range:`'${P}'!O3`,values:[['=SUMIF($D$5:$D$105,"COO",$O$5:$O$105)']]},
   // r4 ▸ 정규직 라인 : N채용필요 O입사 U정규재직
   {range:`'${P}'!A4`,values:[['▸ 정규직 라인']]},
   {range:`'${P}'!N4`,values:[['=SUM(N5:N6)']]},
   {range:`'${P}'!O4`,values:[['=SUM(O5:O6)']]},
   {range:`'${P}'!U4`,values:[['=SUM(U5:U6)']]},
   // r7 ▸ 도급직 라인 : N채용필요 O입사 V도급재직
   {range:`'${P}'!A7`,values:[['▸ 도급직 라인']]},
   {range:`'${P}'!N7`,values:[['=SUM(N8:N13)']]},
   {range:`'${P}'!O7`,values:[['=SUM(O8:O13)']]},
   {range:`'${P}'!V7`,values:[['=SUM(V8:V13)']]},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A3:V13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 헤더 분리 후 [A라벨 | N채용필요 | O입사 | U정규재직 | V도급재직] ===');
 v.forEach((r,i)=>{const rn=i+3;if(r&&(r[0]||r[6]))console.log(`r${rn}: ${(r[0]||'').padEnd(16)} | N=${r[13]||''} | O=${r[14]||''} | U=${r[20]||''} | V=${r[21]||''}`);});
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A3:B9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\nKPI(불변 확인):');k.forEach(r=>{if(r&&r[0])console.log(`  ${r[0].trim()}: ${r[1]}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
