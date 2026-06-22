/* 진행상황(현재) 상단 라인블록을 '정규직 라인 / 도급직 라인' 2그룹으로 재편 (Option B).
   소스: HR '★전사인원현황' (항목별 정규/도급 분류 그대로 싱크).
     E 정규직 / H 도급직 / L 채용요청(정규) / M 채용요청(도급) / N 입사예정(정규) / O 입사예정(도급)
   - 정규직 라인(생산1·2팀): 채용필요←L, 입사예정←N, 재직(U)←E
   - 도급직 라인(생산1·2·3팀 + 포장1·2·3팀): 채용필요←M, 입사예정←O, 재직(V)←H
   - 생산1·2팀은 정규/도급 혼합 → 두 그룹에 각각 등장(채용필요 값은 L/M으로 분리되어 중복 안 됨).
   실행: node scripts/regroup-line-jeongdo.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const TAB='RAW DATA_채용진행상황(현재)';const GID=660728561;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const bu=(s,reqs)=>s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:reqs}});
const ir=(col,row)=>`=IMPORTRANGE("${HR}","'★전사인원현황'!${col}${row}")`;

// r=시트행, src=전사현황 행, grp='J'(정규)|'D'(도급). 정규=L/N/E, 도급=M/O/H.
const ROWS=[
 {r:5, bu:'생산1부', team:'생산1팀',          jik:'생산', site:'퍼플',  src:37, grp:'J'},
 {r:6, bu:'생산2부', team:'생산2팀',          jik:'생산', site:'그린',  src:51, grp:'J'},
 // r7 = 도급 헤더
 {r:8, bu:'생산1부', team:'생산1팀',          jik:'생산', site:'퍼플',  src:37, grp:'D'},
 {r:9, bu:'생산2부', team:'생산2팀',          jik:'생산', site:'그린',  src:51, grp:'D'},
 {r:10,bu:'생산3부', team:'생산3팀',          jik:'생산', site:'3공장', src:41, grp:'D'},
 {r:11,bu:'생산1부', team:'포장1팀 (도급직)', jik:'포장', site:'퍼플',  src:39, grp:'D'},
 {r:12,bu:'생산2부', team:'포장2팀 (도급직)', jik:'포장', site:'그린',  src:55, grp:'D'},
 {r:13,bu:'생산3부', team:'포장3팀 (도급직)', jik:'포장', site:'3공장', src:43, grp:'D'},
];
function rowArr(d){const a=Array(19).fill('');
 a[3]='COO';a[4]='생산본부';a[5]=d.bu;a[6]=d.team;a[7]=d.jik;a[10]=d.site;a[11]='직접';
 const nc=d.grp==='J'?'L':'M', oc=d.grp==='J'?'N':'O';
 a[13]=ir(nc,d.src); a[14]=ir(oc,d.src); a[15]=`=N${d.r}-O${d.r}`; a[16]=`=IFERROR(O${d.r}/N${d.r},0)`;
 return a;}                                   // U/V는 uv()로 별도
const uv=(d)=>d.grp==='J'?[ir('E',d.src),'']:['',ir('H',d.src)];
const head=(label,nr,or_,rr)=>`="▸ ${label}    (채용필요 "&SUM(${nr})&"명 · 입사예정 "&SUM(${or_})&"명 · 재직 "&SUM(${rr})&"명)"`;

async function main(){
  const s=await auth();
  // 0) 백업
  const bak=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A1:AC100`,valueRenderOption:'FORMULA'})).data.values||[];
  const bf=path.join(__dirname,'backup_chaeyong_progress_20260622.json');
  fs.writeFileSync(bf,JSON.stringify(bak,null,1));
  console.log(`백업: ${path.basename(bf)} (${bak.length}행)`);

  // 1) 블록 1줄 부족(9→10) → 시트행13(idx12)에 1줄 삽입. 아래 블랭크·제조1팀 밀림.
  await bu(s,[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:12,endIndex:13},inheritFromBefore:true}}]);
  console.log('1줄 삽입 (블록 4~13행 확보).');

  // 2) 값 기입 — A4:S13 본문 + U4:V13
  const rows={};
  const h4=Array(19).fill('');h4[0]=head('정규직 라인','N5:N6','O5:O6','U5:U6');rows[4]=h4;
  const h7=Array(19).fill('');h7[0]=head('도급직 라인','N8:N13','O8:O13','V8:V13');rows[7]=h7;
  ROWS.forEach(d=>rows[d.r]=rowArr(d));
  const body=[];for(let r=4;r<=13;r++)body.push(rows[r]);
  const uvv=[];for(let r=4;r<=13;r++){const d=ROWS.find(x=>x.r===r);uvv.push(d?uv(d):['','']);}
  await s.spreadsheets.values.batchUpdate({spreadsheetId:SS,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:`'${TAB}'!A4:S13`,values:body},
    {range:`'${TAB}'!U4:V13`,values:uvv},
  ]}});
  console.log('값 기입 완료 (정규 2줄 + 도급 6줄, 항목별 분류 싱크).');

  // 3) ■COO 헤더 SUMIF 범위 D5:D86 로 보존
  await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A3`,valueInputOption:'USER_ENTERED',requestBody:{values:[[
    `="■ COO    (채용필요 "&SUMIF($D$5:$D$86,"COO",$N$5:$N$86)&"명 · 입사예정 "&SUMIF($D$5:$D$86,"COO",$O$5:$O$86)&"명 · 잔여 "&(SUMIF($D$5:$D$86,"COO",$N$5:$N$86)-SUMIF($D$5:$D$86,"COO",$O$5:$O$86))&"명 · 달성률 "&TEXT(IFERROR(SUMIF($D$5:$D$86,"COO",$O$5:$O$86)/SUMIF($D$5:$D$86,"COO",$N$5:$N$86),0),"0.0%")&")"`
  ]]}});

  // 4) 서식: r4~r13 흰색·볼드해제 후 헤더 2줄 색칠 (정규=연파랑, 도급=연주황)
  const wipe={repeatCell:{range:{sheetId:GID,startRowIndex:3,endRowIndex:13,startColumnIndex:0,endColumnIndex:22},cell:{userEnteredFormat:{backgroundColor:{red:1,green:1,blue:1},textFormat:{bold:false}}},fields:'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold'}};
  const fmt=(row,c)=>({repeatCell:{range:{sheetId:GID,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:22},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{bold:true,foregroundColor:{red:0,green:0,blue:0}},verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)'}});
  await bu(s,[wipe, fmt(3,{red:0.84,green:0.92,blue:0.98}), fmt(6,{red:0.99,green:0.90,blue:0.79})]);
  console.log('서식 적용.');

  // 5) 확인
  await new Promise(r=>setTimeout(r,4000));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A3:V15`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n=== 확인 (팀 / 직간접 / 채용필요 / 입사예정 / 잔여 / 달성률 / 정규 / 도급) ===');
  chk.forEach((r,i)=>{if(r.some(c=>String(c).trim()!==''))console.log(`r${i+3}: ${JSON.stringify([r[0]||(r[6]+''),r[11],r[13],r[14],r[15],r[16],r[20],r[21]])}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
