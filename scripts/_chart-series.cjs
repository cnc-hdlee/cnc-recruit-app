const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const nm={};
(async()=>{const s=await auth();
 (await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title))'})).data.sheets.forEach(x=>nm[x.properties.sheetId]=x.properties.title);
 const full=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(charts(chartId,spec(title,basicChart(series,domains,axis))))'})).data.sheets;
 const A1=src=>{if(!src||!src.sources)return'?';return src.sources.map(x=>`${nm[x.sheetId]}!C${(x.startColumnIndex||0)+1}R${(x.startRowIndex||0)+1}:R${x.endRowIndex}`).join(',');};
 full.forEach(sh=>(sh.charts||[]).forEach(c=>{const bc=c.spec&&c.spec.basicChart;if(!bc||!/월별·RAW/.test((c.spec.title)||''))return;
   console.log('차트:',c.spec.title);
   (bc.domains||[]).forEach(d=>console.log('  domain:',A1(d.domain&&d.domain.sourceRange)));
   (bc.series||[]).forEach((se,i)=>console.log(`  series${i}: ${A1(se.series&&se.series.sourceRange)} axis=${se.targetAxis} type=${se.type||'(기본)'} color=${se.color?'set':'-'}`));
   (bc.axis||[]).forEach(a=>console.log(`  axis ${a.position}: viewWindow=${JSON.stringify(a.viewWindowOptions||{})}`));
 }));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
