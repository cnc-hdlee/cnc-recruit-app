/* 이력서 접수일/리드타임을 맨뒤에서 → A·B열(앞)로 이동. A=접수일(달력), B=리드타임(자동). */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=660728561;
const HEADROW=2, DATAROW=3, MAXROW=2001;
const L=i=>{let r='';i+=1;while(i>0){const m=(i-1)%26;r=String.fromCharCode(65+m)+r;i=Math.floor((i-1)/26);}return r;};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  let meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title,gridProperties(columnCount)))'});
  let p=meta.data.sheets.find(x=>x.properties.sheetId===GID).properties; const title=p.title;
  let head=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A"+HEADROW+":"+L(p.gridProperties.columnCount-1)+HEADROW})).data.values[0]||[];
  // 1) 맨뒤 이력서접수일/리드타임 제거 (있으면)
  const rc=head.indexOf('이력서 접수일'), ld=head.indexOf('리드타임(일)');
  const del=[...new Set([rc,ld].filter(x=>x>=0))].sort((a,b)=>b-a);
  if(del.length){await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:del.map(i=>({deleteDimension:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:i,endIndex:i+1}}}))}});}
  // 입사확정일 위치 재확인
  head=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A"+HEADROW+":"+L((await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,gridProperties(columnCount)))'})).data.sheets.find(x=>x.properties.sheetId===GID).properties.gridProperties.columnCount-1)+HEADROW})).data.values[0]||[];
  const idxIpsa=head.indexOf('입사확정일'); const Ls=L(idxIpsa);
  console.log('입사확정일='+Ls);
  // 2) A=이력서접수일, B=리드타임 헤더(2행) + 리드타임 수식(3행)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:"'"+title+"'!A"+HEADROW,valueInputOption:'RAW',requestBody:{values:[['이력서 접수일','리드타임(일)']]}});
  const lead='=ARRAYFORMULA(IF($A$'+DATAROW+':$A$'+MAXROW+'="","",IF($'+Ls+'$'+DATAROW+':$'+Ls+'$'+MAXROW+'="",TODAY()-$A$'+DATAROW+':$A$'+MAXROW+',$'+Ls+'$'+DATAROW+':$'+Ls+'$'+MAXROW+'-$A$'+DATAROW+':$A$'+MAXROW+')))';
  await s.spreadsheets.values.update({spreadsheetId:ID,range:"'"+title+"'!B"+DATAROW,valueInputOption:'USER_ENTERED',requestBody:{values:[[lead]]}});
  // 3) 서식
  const navy={red:0.12,green:0.22,blue:0.39};
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:GID,startRowIndex:HEADROW-1,endRowIndex:HEADROW,startColumnIndex:0,endColumnIndex:2},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:10},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {setDataValidation:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:0,endColumnIndex:1},rule:{condition:{type:'DATE_IS_VALID'},showCustomUi:true,strict:false}}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0"일"'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:0,endIndex:2},properties:{pixelSize:105},fields:'pixelSize'}},
  ]}});
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A"+HEADROW+":B"+HEADROW})).data.values[0];
  console.log('A·B 헤더:',chk.join(' | '));
  const k=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A2",valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('대시보드(영향없음):',k);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
