/* RAW 생산1·2팀: 채용필요 공통 1개(충원필요 J를 정규행에) + 입사 정규/도급 분리(이미 두 행).
   정규행 N=J(충원필요 공통), 도급행 N=0. 입사 O는 그대로(정규행=정규입사, 도급행=도급입사). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const ir=cell=>`=IMPORTRANGE("${HR}","'★전사인원현황'!${cell}")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!N5:N9`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_rawsplit_20260623.json'),JSON.stringify(bak,null,1));
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   {range:`'${P}'!N5`,values:[[ir('J37')]]}, // 생산1팀 정규 = 충원필요(공통)
   {range:`'${P}'!N6`,values:[[ir('J51')]]}, // 생산2팀 정규 = 충원필요(공통)
   {range:`'${P}'!N8`,values:[[0]]},          // 생산1팀 도급 = 0 (공통은 정규행)
   {range:`'${P}'!N9`,values:[[0]]},          // 생산2팀 도급 = 0
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A5:O9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== RAW 생산1·2팀 (변경후) [팀|채용필요N|입사O] ===');
 v.forEach((r,i)=>{if(r&&r[6])console.log(`  ${r[6]}: 채용필요=${r[13]} 입사=${r[14]}`);});
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A3:B9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n대시보드 KPI:');k.forEach(r=>{if(r&&r[0])console.log(`  ${r[0].trim()}: ${r[1]}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
