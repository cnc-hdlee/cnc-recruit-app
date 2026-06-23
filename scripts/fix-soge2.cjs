const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=500969666;const R="'RAW DATA_채용진행상황(현재)'";
const N=`${R}!$N$3:$N$2026`,O=`${R}!$O$3:$O$2026`,D=`${R}!$D$3:$D$2026`,E=`${R}!$E$3:$E$2026`,F=`${R}!$F$3:$F$2026`,G=`${R}!$G$3:$G$2026`;
const team=(lbl,g,rn)=>[lbl,`=SUMIFS(${N},${D},"COO",${E},"생산본부",${G},"${g}")`,`=SUMIFS(${O},${D},"COO",${E},"생산본부",${G},"${g}")`,`=B${rn}-C${rn}`,`=IF(B${rn}=0,"-",MIN(C${rn},B${rn})/B${rn})`];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A11:E120`,valueRenderOption:'FORMULA'})).data.values||[];
  fs.writeFileSync(path.join(__dirname,'backup_bonbu_soge_20260623.json'),JSON.stringify(bak,null,1));
  const qual=[team('         품질관리1팀','품질관리1팀',32),team('         품질관리2팀','품질관리2팀',33),team('         품질보증팀','품질보증팀',34),
    ['      품질경영 소계',`=SUMIFS(${N},${D},"COO",${E},"생산본부",${F},"품질경영*")`,`=SUMIFS(${O},${D},"COO",${E},"생산본부",${F},"품질경영*")`,'=B35-C35','=IF(B35=0,"-",MIN(C35,B35)/B35)']];
  await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'대시보드'!A32:E35`,valueInputOption:'USER_ENTERED',requestBody:{values:qual}});
  await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{copyPaste:{source:{sheetId:GID,startRowIndex:42,endRowIndex:108,startColumnIndex:0,endColumnIndex:5},destination:{sheetId:GID,startRowIndex:43,endRowIndex:109,startColumnIndex:0,endColumnIndex:5},pasteType:'PASTE_NORMAL'}}]}});
  await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'대시보드'!A43:E43`,valueInputOption:'USER_ENTERED',requestBody:{values:[team('         시설안전팀 · 직속','시설안전팀',43)]}});
  await new Promise(r=>setTimeout(r,4000));
  const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E46`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let soge=0;console.log('=== 부 소계 ===');
  v.forEach(r=>{if(r&&/부 소계|품질경영 소계/.test(String(r[0]||''))){console.log(`  ${r[0].trim()}: ${r[1]}`);soge+=Number(r[1])||0;}});
  const bb=v.find(r=>/생산본부 소계/.test(String(r[0]||'')));const sis=v.find(r=>/시설안전/.test(String(r[0]||'')));
  console.log(`  시설안전팀 직속: ${sis&&sis[1]}`);soge+=Number(sis&&sis[1])||0;
  console.log(`  부소계합 ${soge} =? 생산본부 소계 ${bb&&bb[1]} ${soge===Number(bb&&bb[1])?'✓':'✗'}`);
  const t=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A108:E110`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n전사합계 위치확인:',t.map(r=>r&&r[0]).filter(Boolean).join(' | '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
