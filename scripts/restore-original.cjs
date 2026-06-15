/* 원복: 내가 지운/바꾼 입사예정·잔여·달성률을 원래대로 복원.
 *  - 트리 C/D/E: C=B의 O→P치환(입사예정), D=B-C(잔여), E=IFERROR(C/B)(달성률)
 *  - 블록 I/J(우선순위15-18·채용사유21-22·근무지33-37): I=H의 O→P, J=IFERROR(I/H). 헤더14/20/32=입사예정/달성률. 현황24-30은 I/J 없음.
 *  - 패널 I5:I11: =SUMIF(F,본부,P) 입사예정 복원. 헤더 I4='입사예정'.
 *  - 헤드라인 R2: 입사예정 기준 원문.
 *  - 트리 헤더 A4/C4/D4/E4 원복.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';
const RAW="'RAW DATA_채용진행상황(현재)'";
const O2P=f=>String(f).replace(/\$O\$3:\$O\$2001/g,'$P$3:$P$2001');
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // 남은 B/H 수식 재취득
  const B=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!B5:B88`,valueRenderOption:'FORMULA'})).data.values||[];
  const H=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!H14:H37`,valueRenderOption:'FORMULA'})).data.values||[];

  // 트리 C/D/E (행 5..88)
  const tree=[];
  for(let i=0;i<84;i++){const row=5+i;const b=(B[i]&&B[i][0])||'';
    if(b&&String(b).startsWith('=')) tree.push([O2P(b),`=B${row}-C${row}`,`=IFERROR(C${row}/B${row},0)`]);
    else tree.push(['','','']);
  }
  // 블록 I/J (행 14..37)
  const HDR={14:1,20:1,32:1}; const NOIJ=new Set([19,23,24,25,26,27,28,29,30,31]);
  const blocks=[];
  for(let i=0;i<24;i++){const row=14+i;const h=(H[i]&&H[i][0])||'';
    if(HDR[row]) blocks.push(['입사예정','달성률']);
    else if(NOIJ.has(row)) blocks.push(['','']);
    else if(h&&String(h).startsWith('=SUMIF')) blocks.push([O2P(h),`=IFERROR(I${row}/H${row},0)`]);
    else blocks.push(['','']);
  }
  // 패널 I5:I11
  const panelI=[5,6,7,8,9,10,11].map(r=>[`=SUMIF(${RAW}!$F$3:$F$2001,$G${r},${RAW}!$P$3:$P$2001)`]);
  // 헤드라인
  const SO=`SUM(${RAW}!$O$3:$O$2001)`,SP=`SUM(${RAW}!$P$3:$P$2001)`;
  const r2=`="총 채용필요 "&${SO}&"명   ·   입사예정 "&${SP}&"명   ·   잔여 "&(${SO}-${SP})&"명   ·   채용달성률 "&TEXT(IFERROR(${SP}/${SO},0),"0.0%")`;

  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:`'${TAB}'!C5:E88`,values:tree},
    {range:`'${TAB}'!I14:J37`,values:blocks},
    {range:`'${TAB}'!I5:I11`,values:panelI},
    {range:`'${TAB}'!A2`,values:[[r2]]},
    {range:`'${TAB}'!A4:E4`,values:[['조직  (부문 ▸ 본부 ▸ 실/부 ▸ 팀)','채용필요인원','입사예정','잔여','달성률']]},
    {range:`'${TAB}'!I4`,values:[['입사예정']]},
  ]}});
  console.log('원복 완료. 검증:');
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A2`,valueRenderOption:'FORMATTED_VALUE'})).data.values;
  console.log(' 헤드라인:',chk&&chk[0][0]);
  const t=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A5:J11`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  t.forEach((r,i)=>console.log(` R${5+i}: `+(r||[]).map((c,j)=>c!==''&&c!=null?`${String.fromCharCode(65+j)}=${c}`:'').filter(Boolean).join(' | ')));
  const bl=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!G14:J37`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log(' 블록 일부:');bl.slice(0,5).forEach((r,i)=>console.log(`  R${14+i}: `+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
