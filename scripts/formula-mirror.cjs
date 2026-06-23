/* detail 채용필요/입사를 키기반 SUMIFS로 전환(DB 재정렬에 자동 강건). 헬퍼탭 _dbsync에 DB 임포트.
   활성행만 전환(완료행·Lip Studio중복은 유지). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const DS="_dbsync";
async function main(){
  const s=await auth();
  // 1) _dbsync 탭 생성 + DB 임포트
  const meta=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title))'})).data.sheets;
  if(!meta.find(x=>x.properties.title===DS)){
    await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{addSheet:{properties:{title:DS,hidden:true}}}]}});
  }
  await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${DS}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:[[`=IMPORTRANGE("${HR}","채용요청(정규직)DB!A1:Q200")`]]}});
  console.log('_dbsync 임포트 설정. 로딩 대기...');await new Promise(r=>setTimeout(r,8000));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${DS}'!E1:G3`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('_dbsync 샘플:',JSON.stringify(chk));
  // 2) detail 읽기 (G팀 H직무 K근무지, N수식으로 소스판별)
  const vals=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A14:V105`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const fms=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!N14:N105`,valueRenderOption:'FORMULA'})).data.values||[];
  const E=`'${DS}'!$E$2:$E$200`,F=`'${DS}'!$F$2:$F$200`,K=`'${DS}'!$K$2:$K$200`,Gc=`'${DS}'!$G$2:$G$200`,Oc=`'${DS}'!$O$2:$O$200`;
  const data=[];let cnt=0,skip=0;
  vals.forEach((r,i)=>{const rn=i+14;const team=r[6],job=r[7],site=r[10];const nf=String((fms[i]&&fms[i][0])||'');
    if(String(r[0]||'').match(/^[■▸]/)||!(team||job))return;
    if(!nf.includes('채용요청(정규직)DB')){skip++;return;} // 완료행 등 유지
    if(team==='Lip Studio 1팀'&&job==='색조연구원'){skip++;return;} // 중복 유지
    data.push({range:`'${P}'!N${rn}`,values:[[`=SUMIFS(${Gc},${E},$G${rn},${F},$H${rn},${K},$K${rn})`]]});
    data.push({range:`'${P}'!O${rn}`,values:[[`=SUMIFS(${Oc},${E},$G${rn},${F},$H${rn},${K},$K${rn})`]]});
    cnt++;});
  console.log(`전환 ${cnt}행, 유지 ${skip}행`);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
  await new Promise(r=>setTimeout(r,5000));
  const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A3:B9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n=== 전환 후 KPI ===');k.forEach(r=>{if(r&&r[0])console.log(`  ${r[0].trim()}: ${r[1]}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
