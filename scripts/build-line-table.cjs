/* 생산 라인 채용현황 표: 채용필요(공통 1) + 입사예정 정규/도급(2) + 달성률(100%캡) + 초과 + 재직(정규/도급).
   대시보드 G46~N54 빈영역. 소스(RAW) SUMIFS, 마커 U>0=정규행 / V>0=도급행. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const R="'RAW DATA_채용진행상황(현재)'";
const N=`${R}!$N$3:$N$2026`,O=`${R}!$O$3:$O$2026`,G=`${R}!$G$3:$G$2026`,H=`${R}!$H$3:$H$2026`,U=`${R}!$U$3:$U$2026`,V=`${R}!$V$3:$V$2026`;
const teams=[['생산1팀','생산1팀*','생산'],['생산2팀','생산2팀*','생산'],['생산3팀','생산3팀*','생산'],['포장1팀','포장1팀*','포장'],['포장2팀','포장2팀*','포장'],['포장3팀','포장3팀*','포장']];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const data=[];
 data.push(['■ 생산 라인 채용현황  (채용필요=정규·도급 공통 / 입사예정만 구분)','','','','','','','']); // r46
 data.push(['팀','채용필요','입사(정규)','입사(도급)','달성률','초과채용','재직(정규)','재직(도급)']); // r47
 teams.forEach((t,i)=>{const rn=48+i;const[nm,g,h]=t;
   data.push([nm,
     `=MAX(0,SUMIFS(${N},${G},"${g}",${H},"${h}"))`,
     `=SUMIFS(${O},${G},"${g}",${H},"${h}",${U},">0")`,
     `=SUMIFS(${O},${G},"${g}",${H},"${h}",${V},">0")`,
     `=IF(H${rn}=0,"-",MIN(I${rn}+J${rn},H${rn})/H${rn})`,
     `=MAX(0,I${rn}+J${rn}-H${rn})`,
     `=SUMIFS(${U},${G},"${g}",${H},"${h}")`,
     `=SUMIFS(${V},${G},"${g}",${H},"${h}")`]);
 });
 data.push(['■ 라인 합계','=SUM(H48:H53)','=SUM(I48:I53)','=SUM(J48:J53)','=IF(H54=0,"-",MIN(I54+J54,H54)/H54)','=SUM(L48:L53)','=SUM(M48:M53)','=SUM(N48:N53)']); // r54
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!G46:N54`,valueInputOption:'USER_ENTERED',requestBody:{values:data}});
 await new Promise(r=>setTimeout(r,3500));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!G47:N54`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 생산 라인 채용현황 ===');v.forEach(r=>console.log('  '+JSON.stringify(r)));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
