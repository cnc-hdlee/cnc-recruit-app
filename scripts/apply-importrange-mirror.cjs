/* 채용진행상황 O(채용필요)·P(입사예정)을 채용요청(정규직)DB에서 IMPORTRANGE 미러링.
 * O{행}=IMPORTRANGE(DB!G{dbrow}) · P{행}=IMPORTRANGE(DB!O{dbrow}). 생산2팀 패턴 그대로 전 행 적용.
 * 부자재 중복행은 첫행만 IR·둘째 0. DB에 없는 행(충전QC/RA/총무)은 정적 유지.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY',REQ='RAW DATA_채용진행상황(현재)';
const C=x=>String(x==null?'':x).trim();const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();const key=(t,j)=>norm(t)+'|'+norm(j);
const N=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const IR=(col,row)=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!${col}${row}")`;
async function main(){
  const s=await auth();
  // DB map
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`채용요청(정규직)DB!A2:O72`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dbmap={};dv.forEach((r,i)=>{const gb=C(r[0]);if(!/^[0-9]+$/.test(gb))return;const tm=C(r[4]),jb=C(r[5]);if(!tm&&!jb)return;dbmap[key(tm,jb)]={row:i+2};});
  const OV={'생산운영팀|scm':'생산기획부|scm','|영상편집및사무보조':'-|영상편집및사무보조','peopleops|총괄':'peopleops|팀원'};
  // 진행상황 + 백업
  const valsF=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`${REQ}!A1:R90`,valueRenderOption:'FORMULA'})).data.values||[];
  const valsV=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`${REQ}!A1:R90`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  fs.writeFileSync(path.join(__dirname,'backup_chaeyong_20260617.json'),JSON.stringify({formula:valsF,value:valsV},null,1));
  console.log('백업: backup_chaeyong_20260617.json');
  const data=[];const used=new Set();let m=0,dup=0,keep=0;
  for(let i=0;i<valsV.length;i++){const r=valsV[i]||[];const rn=i+1;const E=C(r[4]),H=C(r[7]),I=C(r[8]);
    if(!E||E.includes('부문')||C(r[0]).startsWith('■'))continue;
    let k=key(H,I);let d=dbmap[k]||dbmap[OV[k]];
    if(!d){keep++;continue;} // DB 없음 → 정적 유지
    if(used.has(d.row)){data.push({range:`${REQ}!O${rn}`,values:[[0]]});data.push({range:`${REQ}!P${rn}`,values:[[0]]});dup++;continue;} // 중복 → 0
    used.add(d.row);
    data.push({range:`${REQ}!O${rn}`,values:[[IR('G',d.row)]]});
    data.push({range:`${REQ}!P${rn}`,values:[[IR('O',d.row)]]});m++;
  }
  console.log(`IMPORTRANGE 적용: ${m}행 · 중복0처리 ${dup} · 정적유지 ${keep}`);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log('✅ 기입 완료. (IMPORTRANGE 로딩 잠시 대기 후 검증)');
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
