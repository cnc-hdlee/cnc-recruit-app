const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P="'RAW DATA_채용진행상황(현재)'";
const num=x=>Number(String(x==null?'':x).replace(/[^\d.-]/g,''))||0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // 1) _chartdata (차트 소스)
 const cd=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A1:G9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 1) _chartdata (추이 차트 소스) ===');cd.forEach((r,i)=>console.log(`r${i+1}: ${JSON.stringify(r)}`));
 // 추이 차트 series 확인
 const charts=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(title),charts(spec(title,basicChart(series))))'})).data.sheets;
 charts.forEach(sh=>(sh.charts||[]).forEach(c=>{if(/월별·RAW/.test((c.spec&&c.spec.title)||'')){const ser=((c.spec.basicChart||{}).series)||[];console.log(`\n추이 차트 series 수: ${ser.length}`);}}));
 // 2) 대시보드 추이 원본
 const td=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A119:D127`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== 2) 대시보드 추이 원본 (월|채용필요누적|누적입사|달성률) ===');td.forEach((r,i)=>console.log(`r${i+119}: ${JSON.stringify(r)}`));
 // 3) KPI 정합성
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A2:F9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== 3) KPI 정합성 (채용필요 = 완료+예정+미충원?) ===');
 k.slice(1).forEach((r,i)=>{if(!r[0])return;const need=num(r[1]),done=num(r[2]),plan=num(r[3]),mi=num(r[4]);
   console.log(`  ${r[0].trim()}: ${need} =? ${done}+${plan}+${mi}=${done+plan+mi} ${need===done+plan+mi?'✓':'✗'}`);});
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
