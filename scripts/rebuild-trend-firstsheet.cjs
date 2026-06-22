/* L4 추이: 첫번째 시트(RAW)로만 연동. 입사자명단 사용 안 함. 월별 1월~8월.
 * 채용필요(누적)=SUMIFS(N, 승인일A<=월말) → 점점 증가하는 우상향 곡선(2→8→9→28→69→121).
 * 누적입사=SUMIFS(입사예정O, 입사확정일T<=월말)을 totO(28)로 스케일 → 6월부터 등장, 끝점 28.
 * 달성률=누적입사/124(목표 고정) → 끝점 22.6%(=본체). 과거(이번달까지)=실선, 미래(다음달~)=점선. 회색 동그라미(🔘).
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666;
const R="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 월 1~8 (2026)
  const mons=[1,2,3,4,5,6,7,8];
  const totN=`SUMIFS(${R}!$N$4:$N$2001,${R}!$D$4:$D$2001,"<>")`;          // 총 채용필요 124 (분모 고정)
  // 시점 통일: 채용필요·입사예정 둘 다 채용요청일(승인일 A) 기준 누적 → 스케일링 없이 정직하게 124/28 도달
  const need=r=>`SUMIFS(${R}!$N$4:$N$2001,${R}!$A$4:$A$2001,"<="&EOMONTH($A${r},0))`;
  const hire=r=>`SUMIFS(${R}!$O$4:$O$2001,${R}!$A$4:$A$2001,"<="&EOMONTH($A${r},0))`;
  const ach=r=>`${hire(r)}/${totN}`;
  // 대시보드 가시 표 A101~D110
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`대시보드!A101:H115`});
  const rows=[['📈 채용 진행 추이 (월별·RAW 기준)','','',''],['월','채용필요(누적)','누적입사(누적)','달성률']];
  mons.forEach((m,i)=>{const r=103+i;rows.push([`=DATE(2026,${m},1)`,`=${need(r)}`,`=${hire(r)}`,`=${ach(r)}`]);});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!A101`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  // 서식: 월=DATE("m월"), 채용필요/입사=정수, 달성률=%
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:110,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'m"월"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:110,startColumnIndex:1,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:110,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
  ]}});
  // _chartdata 과거/미래 분리(대시보드 참조). 과거=이번달까지(실선), 미래=이번달~(점선) → 이번달서 연결
  let meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'});
  const CDGID=meta.data.sheets.find(x=>x.properties.title==='_chartdata').properties.sheetId;
  const cd=[['월','필요_과거','필요_미래','입사_과거','입사_미래','달성_과거','달성_미래']];
  // 채용필요(회색)=1월부터 전체. 누적입사·달성률=값>0(6월~)인 달만 → 1~5월 0구간은 NA()로 깔끔히 비움
  mons.forEach((m,i)=>{const r=103+i;const pst=`'대시보드'!$A${r}<=TODAY()`,fut=`'대시보드'!$A${r}>=DATE(YEAR(TODAY()),MONTH(TODAY()),1)`;
    const hasH=`'대시보드'!$C${r}>0`;  // 입사 데이터 있는 달만
    cd.push([`='대시보드'!A${r}`,
     `=IF(${pst},'대시보드'!B${r},NA())`,`=IF(${fut},'대시보드'!B${r},NA())`,
     `=IF(AND(${hasH},${pst}),'대시보드'!C${r},NA())`,`=IF(AND(${hasH},${fut}),'대시보드'!C${r},NA())`,
     `=IF(AND(${hasH},${pst}),'대시보드'!D${r},NA())`,`=IF(AND(${hasH},${fut}),'대시보드'!D${r},NA())`]);});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`_chartdata!A1:G9`,valueInputOption:'USER_ENTERED',requestBody:{values:cd}});
  // 차트: 6계열 (필요/입사/달성 × 과거실선/미래점선). 데이터 9행(헤더+8월)
  const GR={red:0.55,green:0.55,blue:0.58},Of={red:0.937,green:0.420,blue:0.0},Bf={red:0.118,green:0.439,blue:0.827};
  const cs=(c)=>({sourceRange:{sources:[{sheetId:CDGID,startRowIndex:0,endRowIndex:9,startColumnIndex:c,endColumnIndex:c+1}]}});
  const ser=(c,ax,col,line,lab,place)=>{const o={series:cs(c),targetAxis:ax,colorStyle:{rgbColor:col},lineStyle:{type:line,width:line==='SOLID'?3:2},pointStyle:{size:line==='SOLID'?6:4,shape:'CIRCLE'}};if(lab)o.dataLabel={type:'DATA',placement:place,textFormat:{fontSize:9,bold:true,foregroundColor:col}};return o;};
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateChartSpec:{chartId:330002883,spec:{
    title:'채용 진행 추이 (월별·RAW 기준)',
    subtitle:'🔘 채용필요(누적)  ·  🟠 누적입사(숫자 아래)  ·  🔵 달성률(숫자 위·목표124대비)   |   채용요청일 기준 · 실선=실적/점선=향후',
    basicChart:{chartType:'LINE',legendPosition:'NO_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:135}},{position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:cs(0)}],
      series:[
        ser(1,'LEFT_AXIS',GR,'SOLID',false),ser(2,'LEFT_AXIS',GR,'MEDIUM_DASHED',false),       // 채용필요 과거/미래
        ser(3,'LEFT_AXIS',Of,'SOLID',true,'BELOW'),ser(4,'LEFT_AXIS',Of,'MEDIUM_DASHED',true,'BELOW'),  // 누적입사
        ser(5,'RIGHT_AXIS',Bf,'SOLID',true,'ABOVE'),ser(6,'RIGHT_AXIS',Bf,'MEDIUM_DASHED',true,'ABOVE') // 달성률
      ]}}}}]}});
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!A102:D110`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('월별 추이(첫시트·승인일 누적):');v.forEach(r=>console.log('  '+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
