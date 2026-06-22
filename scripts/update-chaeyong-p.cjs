/* 채용진행상황(현재) 입사예정(P) 갱신: 각 채용요청 행에 입사자 명단의 실제 입사자 수(부문|본부|팀|직무 매칭)를 기입.
 * 잔여(Q)·달성률(R)은 수식이라 자동 재계산. 그룹헤더(■)·빈행 미터치.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const REQ='RAW DATA_채용진행상황(현재)',ROS='입사자 명단';
const C=x=>String(x==null?'':x).trim();
const key=(bu,bn,tm,jb)=>[C(bu),C(bn),C(tm),C(jb)].join('|');
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 입사자 명단: C부문 D본부 F팀 G직무
  const ros=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROS}!C4:G400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const cnt={};let tot=0;ros.forEach(r=>{if(!C(r[3]))return;tot++;const k=key(r[0],r[1],r[3],r[4]);cnt[k]=(cnt[k]||0)+1;});
  // 채용요청: E부문 F본부 G실부 H팀 I직무  (행추적 위해 A:P)
  const req=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!A2:P200`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // P열 수식 확인: IMPORTRANGE 등 수식셀(생산1·2팀 전사인원현황 연동)은 절대 안 건드림
  const pForm=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!P2:P200`,valueRenderOption:'FORMULA'})).data.values||[];
  let matched=0,reqRows=0,skipped=0;const data=[];
  // req[i] = 시트행 i+2. 부문(E)+팀(H) 있는 실데이터 행만 P 기입 (헤더/■그룹행 skip).
  for(let i=0;i<req.length;i++){const r=req[i];const sheetRow=i+2;const bu=C(r[4]),bn=C(r[5]),tm=C(r[7]),jb=C(r[8]);
    if(bu&&tm){
      const pf=C(pForm[i]&&pForm[i][0]);
      if(pf.startsWith('=')){skipped++;continue;} // 수식셀 보존(생산1/2팀 IMPORTRANGE 등)
      reqRows++;const c=cnt[key(bu,bn,tm,jb)]||0;const need=+C(r[14])||0;const p=Math.min(c,need);if(c)matched++;
      data.push({range:`${REQ}!P${sheetRow}`,values:[[p]]});}
  }
  console.log(`(수식셀 보존: ${skipped}행 — 생산1/2팀 IMPORTRANGE 등 미터치)`);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log(`채용진행상황 입사예정(P) 갱신: 요청 ${reqRows}행 / 입사자 매칭 ${matched}행 / 입사자총 ${tot}명`);
  // 합계 확인
  let sumP=0;data.forEach(d=>sumP+=+d.values[0][0]||0);console.log(`입사예정(P) 합계: ${sumP}`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
