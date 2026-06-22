const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const SIZE=13;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const bump=f=>{f=f||{};f.fontSize=SIZE;if(!f.fontFamily)f.fontFamily='Roboto';return f;};
(async()=>{const s=await auth();
 const sh=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(title),charts(chartId,spec))'})).data.sheets;
 const reqs=[];const done=[];
 sh.forEach(x=>(x.charts||[]).forEach(c=>{const t=(c.spec&&c.spec.title)||'';const bc=c.spec&&c.spec.basicChart;if(!bc)return;
   if(/추이|진행/.test(t)){(bc.axis||[]).forEach(a=>{a.format=bump(a.format);});
     if(c.spec.titleTextFormat)c.spec.titleTextFormat.fontSize=Math.max(c.spec.titleTextFormat.fontSize||12,14);
     reqs.push({updateChartSpec:{chartId:c.chartId,spec:c.spec}});done.push(`#${c.chartId} ${t} (${x.properties.title})`);}
 }));
 if(!reqs.length){console.log('대상 없음');return;}
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 console.log('축 폰트 '+SIZE+'px 확대 완료:');done.forEach(d=>console.log('  '+d));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
