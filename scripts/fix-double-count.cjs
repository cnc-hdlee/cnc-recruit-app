/* 라인블록 중복카운팅 수정: 생산1·2팀 정규 행의 채용필요를 J(충원필요)→L(채용요청정규)로.
   J=L+M이라 정규(J)+도급(M)이 M을 이중계상. 정규=L로 바꾸면 중복 제거. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const PTAB='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // 현재 N5,N6 수식 읽기
 const f=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!N5:N6`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('현재 N5(생산1팀정규):',f[0]&&f[0][0]);
 console.log('현재 N6(생산2팀정규):',f[1]&&f[1][0]);
 const bak={N5:f[0]&&f[0][0],N6:f[1]&&f[1][0]};
 fs.writeFileSync(path.join(__dirname,'backup_doublecount_20260622.json'),JSON.stringify(bak,null,1));
 // J→L 치환
 const n5=String(bak.N5).replace(/!J37/,'!L37').replace(/'J37/,"'L37").replace(/J37/,'L37');
 const n6=String(bak.N6).replace(/!J51/,'!L51').replace(/'J51/,"'L51").replace(/J51/,'L51');
 console.log('\n새 N5:',n5);console.log('새 N6:',n6);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${PTAB}'!N5`,valueInputOption:'USER_ENTERED',requestBody:{values:[[n5]]}});
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${PTAB}'!N6`,valueInputOption:'USER_ENTERED',requestBody:{values:[[n6]]}});
 await new Promise(r=>setTimeout(r,4000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A4:Q13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== 라인블록 (수정후) [팀 | 채용필요] ===');
 v.forEach((r,i)=>{if(r&&r[6])console.log(`  ${r[6]}: ${r[13]}`);else if(r&&String(r[0]).match(/▸/))console.log(`  ${r[0]}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
