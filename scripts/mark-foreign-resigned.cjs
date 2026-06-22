/* 외국인 33명 중 소스에 퇴사일자 있는 사람 → 타겟 최종상태(W)="퇴사", 비고에 퇴사일, 현재단계(AB) 수식 보완.
 * W 드롭다운에 "퇴사" 추가(빨강 방지). 이름 매칭. 기존 항목/다른 데이터 미터치.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY',TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='생산직 RAW DATA',SID=0;
const C=x=>String(x==null?'':x).trim();
const isF=n=>{n=C(n);return n&&n!=='내국인';};
const nd=d=>{const m=C(d).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`:'';};
const recent=d=>{const x=nd(d);return x&&x>='2026-05-01';};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const abF=r=>`=IF($I${r}="","",IFS($W${r}="퇴사","퇴사",$W${r}="입사","입사",$W${r}="포기","포기",$X${r}<>"","탈락("&$X${r}&")",$V${r}="적합","건강검진 통과",$T${r}="합격","면접 합격",$S${r}="합격","서류 합격",$R${r}<>"","접수",TRUE,"-"))`;

async function main(){
  const s=await auth();
  const jv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`정규직DB!A2:AJ2026`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`도급직DB!A2:U1920`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const q={}; // 성명 -> 퇴사일
  jv.filter(r=>isF(r[13])&&recent(r[19])).forEach(r=>{if(nd(r[20]))q[C(r[3])]=nd(r[20]);}); // 정규직 퇴사U(20)
  dv.filter(r=>isF(r[11])&&recent(r[15])).forEach(r=>{if(nd(r[16]))q[C(r[3])]=nd(r[16]);}); // 도급직 퇴사Q(16)
  console.log('퇴사자:',Object.keys(q).length,JSON.stringify(q));

  // 타겟 성명(I)·비고(AA) 읽어 행 매칭
  const grid=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I2:AA100`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const updates=[];let done=0;
  grid.forEach((row,i)=>{const r=2+i;const name=C(row[0]);if(!name)return;const qd=q[name];if(!qd)return;
    const note=C(row[18]); // AA = I기준 +18 (I=8,AA=26 -> 26-8=18)
    const newNote=note+(note.includes('퇴사')?'':` · 퇴사 ${qd}`);
    updates.push({range:`${TAB}!W${r}`,values:[['퇴사']]});
    updates.push({range:`${TAB}!AA${r}`,values:[[newNote]]});
    updates.push({range:`${TAB}!AB${r}`,values:[[abF(r)]]});
    done++;console.log(`  R${r} ${name} -> 퇴사 (${qd})`);
  });
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data:updates}});
  // W 드롭다운에 "퇴사" 추가
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:[
    {setDataValidation:{range:{sheetId:SID,startRowIndex:1,endRowIndex:1000,startColumnIndex:22,endColumnIndex:23},
      rule:{condition:{type:'ONE_OF_LIST',values:['진행중','입사','탈락','포기','퇴사'].map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}},
  ]}});
  console.log(`OK: ${done}명 퇴사 기입 + W목록에 "퇴사" 추가`);
  // 검증
  const chk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I2:AB34`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach((r,i)=>{if(C(r[14])==='퇴사')console.log(`  검증 R${2+i}: ${C(r[0])} | W=${C(r[14])} | AA=${C(r[18])} | AB(현재단계)=${C(r[19])}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
