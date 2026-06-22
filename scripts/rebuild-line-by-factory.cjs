/* 라인 섹션을 공장별(직접/간접) 전사인원현황 미러로 재구성.
   - 기존 정규/도급 라인블록(r4~r14) 자리에 4줄 더 끼워 r4~r18(15줄)로.
   - 3 공장헤더(퍼플/그린/3공장) + 12 직접/간접 데이터. 채용필요←전사J, 입사예정←전사N+O.
   - 정규/도급은 U/V 칸(전사 E/H IMPORTRANGE). 일반직군(r19~ 제조1팀 등) 안 건드림.
   실행: node scripts/rebuild-line-by-factory.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const TAB='RAW DATA_채용진행상황(현재)';const GID=660728561;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const ir=(col,src)=>`=IMPORTRANGE("${HR}","'★전사인원현황'!${col}${src}")`;
// 데이터행: [최종행, 전사행, 부, 팀, 직무, 근무지, 구분]
const D=[
 [5,37,'생산1부','생산1팀','생산','퍼플','직접'],
 [6,38,'생산1부','생산1팀','생산','퍼플','간접'],
 [7,39,'생산1부','포장1팀','포장','퍼플','직접'],
 [8,40,'생산1부','포장1팀','포장','퍼플','간접'],
 [10,51,'생산2부','생산2팀','생산','그린','직접'],
 [11,52,'생산2부','생산2팀','생산','그린','간접'],
 [12,55,'생산2부','포장2팀','포장','그린','직접'],
 [13,56,'생산2부','포장2팀','포장','그린','간접'],
 [15,41,'생산3부','생산3팀','생산','3공장','직접'],
 [16,42,'생산3부','생산3팀','생산','3공장','간접'],
 [17,43,'생산3부','포장3팀','포장','3공장','직접'],
 [18,44,'생산3부','포장3팀','포장','3공장','간접'],
];
const HEAD={4:['🟪 퍼플 공장',5,8],9:['🟩 그린 공장',10,13],14:['🟫 3공장',15,18]};
function dataRow(r){const d=D.find(x=>x[0]===r);const[,src,bu,tm,jik,site,gb]=d;const a=Array(19).fill('');
 a[3]='COO';a[4]='생산본부';a[5]=bu;a[6]=tm;a[7]=jik;a[10]=site;a[11]=gb;
 a[13]=ir('J',src); a[14]=`${ir('N',src)}+${ir('O',src)}`; a[15]=`=N${r}-O${r}`; a[16]=`=IFERROR(O${r}/N${r},0)`;
 return a;}
function headRow(r){const[label,a1,a2]=HEAD[r];const a=Array(19).fill('');
 a[0]=`="${label}    (채용필요 "&SUM($N$${a1}:$N$${a2})&"명 · 입사예정 "&SUM($O$${a1}:$O$${a2})&"명)"`;return a;}
async function main(){const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:X100`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_chaeyong_progress_20260619.json'),JSON.stringify(bak,null,1));
 console.log('백업 완료',bak.length,'행');

 // 1) 데이터범위 내부(row6)에 4줄 삽입 → 라인블록 r4~r18
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:5,endIndex:9},inheritFromBefore:true}}]}});

 // 2) 값 기입
 const block=[];for(let r=4;r<=18;r++)block.push(HEAD[r]?headRow(r):dataRow(r));
 const uv=[];for(let r=4;r<=18;r++){if(HEAD[r]){uv.push(['','']);continue;}const src=D.find(x=>x[0]===r)[1];uv.push([ir('E',src),ir('H',src)]);}
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   {range:`'${TAB}'!A4:S18`,values:block},
   {range:`'${TAB}'!U2:V2`,values:[['정규직','도급직']]},
   {range:`'${TAB}'!U4:V18`,values:uv},
 ]}});

 // 3) 서식: r4~r18 깨끗이(흰색·볼드해제) 후 헤더 3줄 색칠
 const wipe={repeatCell:{range:{sheetId:GID,startRowIndex:3,endRowIndex:18,startColumnIndex:0,endColumnIndex:22},cell:{userEnteredFormat:{backgroundColor:{red:1,green:1,blue:1},textFormat:{bold:false}}},fields:'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold'}};
 const head=(row,c)=>({repeatCell:{range:{sheetId:GID,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:22},cell:{userEnteredFormat:{backgroundColor:c,textFormat:{bold:true,foregroundColor:{red:0,green:0,blue:0}}}},fields:'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'}});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[wipe,
   head(3,{red:0.85,green:0.80,blue:0.92}),   // 퍼플 lavender
   head(8,{red:0.84,green:0.93,blue:0.82}),   // 그린
   head(13,{red:0.90,green:0.83,blue:0.72}),  // 3공장 연한갈색
 ]}});
 console.log('재구성 완료. 확인:');
 await new Promise(r=>setTimeout(r,3000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A3:V19`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 chk.forEach((r,i)=>{if(r.some(c=>String(c).trim()!==''))console.log(`r${i+3}: ${JSON.stringify([r[0],r[5],r[6],r[7],r[10],r[11],r[13],r[14],r[15],r[16],r[20],r[21]])}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
