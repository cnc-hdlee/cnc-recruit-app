/* COO 생산 라인 빈칸(13,14,16,22,23) 제거: r24~(생산1부 소계~)를 r19로 당기고(copyPaste 자동보정),
   라인 6팀+합계를 r12~18 연속 재작성. 우측 블록(G~)은 안 건드림(A:E만). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$3:$N$2026`,O=`${P}!$O$3:$O$2026`,D=`${P}!$D$3:$D$2026`,E=`${P}!$E$3:$E$2026`,G=`${P}!$G$3:$G$2026`,H=`${P}!$H$3:$H$2026`,L=`${P}!$L$3:$L$2026`;
const team=(label,g,h,rn)=>[label,`=SUMIFS(${N},${D},"COO",${E},"생산본부",${G},"${g}",${H},"${h}")`,`=SUMIFS(${O},${D},"COO",${E},"생산본부",${G},"${g}",${H},"${h}")`,`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A11:E118`,valueRenderOption:'FORMULA'})).data.values||[];
  fs.writeFileSync(path.join(__dirname,'backup_compact_tree_20260622.json'),JSON.stringify(bak,null,1));
  // 1) r24~96 → r19 로 당김 (A:E만, 상대참조 자동보정)
  await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{copyPaste:{
    source:{sheetId:GID,startRowIndex:23,endRowIndex:96,startColumnIndex:0,endColumnIndex:5},
    destination:{sheetId:GID,startRowIndex:18,endRowIndex:91,startColumnIndex:0,endColumnIndex:5},
    pasteType:'PASTE_NORMAL'}}]}});
  // 2) 라인 구간 r12~18 재작성 (연속)
  const body=[
    team('         생산1팀','생산1팀*','생산',12),
    team('         생산2팀','생산2팀*','생산',13),
    team('         생산3팀 · 도급','생산3팀*','생산',14),
    team('         포장1팀 · 도급','포장1팀*','포장',15),
    team('         포장2팀 · 도급','포장2팀*','포장',16),
    team('         포장3팀 · 도급','포장3팀*','포장',17),
    ['      ▸ 직접 라인 합계',`=SUMIFS(${N},${D},"COO",${E},"생산본부",${L},"직접")`,`=SUMIFS(${O},${D},"COO",${E},"생산본부",${L},"직접")`,'=B18-C18','=IFERROR(C18/B18,0)'],
  ];
  await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A12:E18`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
  // 3) 꼬리 정리
  await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${TAB}'!A91:E118`]});
  await new Promise(r=>setTimeout(r,4000));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A12:E32`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('=== 정리 후 ===');
  chk.forEach((r,i)=>{const t=r&&r.some(c=>String(c).trim()!=='')?JSON.stringify(r):'(빈칸)';console.log(`r${i+12}: ${t}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
