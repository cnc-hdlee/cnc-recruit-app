/* 추이 차트: 우축(달성률) 범위 0~1 → 0~0.5로 변경. 누적입사선과 달성률선 분리. 선/시리즈는 그대로. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const full=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(charts(chartId,spec))'})).data.sheets;
 let t=null;full.forEach(sh=>(sh.charts||[]).forEach(c=>{if(/월별·RAW/.test((c.spec&&c.spec.title)||''))t=c;}));
 if(!t){console.log('차트 못찾음');return;}
 const spec=t.spec;const bc=spec.basicChart;
 // 우축 viewWindow 0~0.5
 bc.axis=(bc.axis||[]).map(a=>a.position==='RIGHT_AXIS'?{...a,viewWindowOptions:{viewWindowMin:0,viewWindowMax:0.5}}:a);
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{updateChartSpec:{chartId:t.chartId,spec}}]}});
 console.log('우축(달성률) 0~50%로 변경 → 입사선/달성률선 분리');
 const after=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(charts(chartId,spec(title,basicChart(series,axis(position,viewWindowOptions)))))'})).data.sheets;
 after.forEach(sh=>(sh.charts||[]).forEach(c=>{if(c.chartId===t.chartId){const b=c.spec.basicChart;console.log('series수:',b.series.length);b.axis.forEach(a=>console.log(`  ${a.position}: ${JSON.stringify(a.viewWindowOptions||{})}`));}}));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
