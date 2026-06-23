/* r3 ■ COO의 전체합계 숫자 제거 → 구분선 라벨만. 각 줄은 자기 소계만. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${P}'!N3:V3`]});
 await new Promise(r=>setTimeout(r,2500));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A3:V13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== RAW 라인블록 (r3 합계 제거 후) [라벨/팀 | 채용필요 | 입사 | 정규재직 | 도급재직] ===');
 v.forEach((r,i)=>{const rn=i+3;const nm=r[0]||r[6]||'';console.log(`r${rn}: ${nm.padEnd(18)} | ${r[13]!=null&&r[13]!==''?r[13]:'·'} | ${r[14]!=null&&r[14]!==''?r[14]:'·'} | ${r[20]||'·'} | ${r[21]||'·'}`);});
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
