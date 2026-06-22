/* 도급 라인행 채용필요(N)/입사예정(O)을 ★전사인원현황 J/O열에 IMPORTRANGE 연결.
   채용필요 ← 전사 J열(충원필요), 입사예정 ← 전사 O열(입사예정 도급). 정규행과 동일 라이브 방식.
   기존 정규행/대시보드 안 건드림. 실행: node scripts/fill-dogup-from-jeonsa.cjs [--dry] */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const TAB='RAW DATA_채용진행상황(현재)';const DRY=process.argv.includes('--dry');
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
// 진행상황 행 → 전사인원현황 원본행
const MAP={9:37,10:51,11:41,12:39,13:55,14:43};
const ir=(col,src)=>`=IMPORTRANGE("${HR}","'★전사인원현황'!${col}${src}")`;
async function main(){const s=await auth();
  const rows=Object.keys(MAP).map(Number).sort((a,b)=>a-b);
  console.log('=== 적용 예정 (N=전사J, O=전사O) ===');
  rows.forEach(r=>console.log(`  진행 r${r}: N=${ir('J',MAP[r])}  O=${ir('O',MAP[r])}`));
  if(DRY){console.log('[DRY]');return;}
  const data=rows.map(r=>({range:`'${TAB}'!N${r}:O${r}`,values:[[ir('J',MAP[r]),ir('O',MAP[r])]]}));
  await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log('\nIMPORTRANGE 기입 완료. 값 확인 중...');
  await new Promise(r=>setTimeout(r,3000));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A4:Q14`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach((r,i)=>{if(r.some(c=>String(c).trim()!==''))console.log(`r${i+4}: ${JSON.stringify(r)}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
