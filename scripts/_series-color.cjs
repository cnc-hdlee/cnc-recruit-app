const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const hex=c=>{if(!c)return'없음';const f=x=>Math.round((x||0)*255).toString(16).padStart(2,'0');return '#'+f(c.red)+f(c.green)+f(c.blue);};
(async()=>{const s=await auth();
 const full=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(charts(chartId,spec(title,basicChart(series,lineSmoothing))))'})).data.sheets;
 const labels=['필요_과거','필요_미래','입사_과거','입사_미래','달성_과거','달성_미래'];
 full.forEach(sh=>(sh.charts||[]).forEach(c=>{const bc=c.spec&&c.spec.basicChart;if(!bc||!/월별·RAW/.test((c.spec.title)||''))return;
   (bc.series||[]).forEach((se,i)=>{
     console.log(`series${i}(${labels[i]}): color=${hex(se.color)} colorStyle=${se.colorStyle?JSON.stringify(se.colorStyle):'-'} lineStyle=${se.lineStyle?JSON.stringify(se.lineStyle):'-'} pointStyle=${se.pointStyle?'set':'-'}`);
   });
 }));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
