/* KPI에 입사완료 칸 추가: 구분|채용필요|입사완료|입사예정(pending)|미충원|달성률.
   입사완료=현황"입사완료". 입사예정=총입사-완료. 아래 별도 블록(r10~14) 제거. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$3:$N$2026`,O=`${P}!$O$3:$O$2026`,M=`${P}!$M$3:$M$2026`,L=`${P}!$L$3:$L$2026`,U=`${P}!$U$3:$U$2026`,Vc=`${P}!$V$3:$V$2026`;
const Cjik=`,${L},"직접",${U},">0"`, Cgan=`,${L},"간접"`, CganV=`,${L},"간접",${Vc},">0"`, CdjikV=`,${L},"직접",${Vc},">0"`, Done=`,${M},"입사완료"`;
const sn=c=>`SUMIFS(${N}${c})`, so=c=>`SUMIFS(${O}${c})`, sd=c=>`SUMIFS(${O}${Done}${c})`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z140`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_kpi_done_20260622.json'),JSON.stringify(bak,null,1));
 // 1) 별도 블록 제거: r10~r14 (5줄) 삭제
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{deleteDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:9,endIndex:14}}}]}});
 // 2) KPI A2:F9 재작성 (입사완료 칸 추가)
 const E=r=>`=B${r}-C${r}-D${r}`, F=r=>`=IFERROR((C${r}+D${r})/B${r},0)`;
 const leaf=(label,bN,cDone,dTot,rn)=>[label,'='+bN,'='+cDone,`=${dTot}-C${rn}`,E(rn),F(rn)];
 const par=(label,r1,r2,rn)=>[label,`=B${r1}+B${r2}`,`=C${r1}+C${r2}`,`=D${r1}+D${r2}`,E(rn),F(rn)];
 const body=[
  ['구분','채용필요','입사완료','입사예정','미충원','채용 달성률'],
  par('정규직',4,5,3),
  leaf('   · 직접', sn(Cjik), sd(Cjik), so(Cjik),4),
  leaf('   · 간접', `${sn(Cgan)}-${sn(CganV)}`, `${sd(Cgan)}-${sd(CganV)}`, `(${so(Cgan)}-${so(CganV)})`,5),
  par('도급직',7,8,6),
  leaf('   · 직접', sn(CdjikV), sd(CdjikV), so(CdjikV),7),
  leaf('   · 간접', sn(CganV), sd(CganV), so(CganV),8),
  ['■ 전체','=B3+B6','=C3+C6','=D3+D6',E(9),F(9)],
 ];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A2:F9`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 const navy={red:0.12,green:0.22,blue:0.39},lav={red:0.93,green:0.95,blue:0.99};
 const f=(r0,r1,cell,flds)=>({repeatCell:{range:{sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:0,endColumnIndex:6},cell,fields:flds}});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   f(1,2,{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'),
   f(2,3,{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'),
   f(5,6,{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'),
   f(8,9,{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'),
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:9,startColumnIndex:5,endColumnIndex:6},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:9,startColumnIndex:1,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A2:F9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== KPI (입사완료 분리) ===');chk.forEach((r,i)=>console.log(`r${i+2}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
