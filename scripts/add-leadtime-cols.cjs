/* RAW DATA_채용진행상황(현재)에 '이력서 접수일' + '리드타임(일)' 추가 (맨뒤).
 * 현 구조: 헤더 2행, 데이터 3행~. GID로 탭이름 resolve(이름 바뀌어도 안전). */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=660728561;
const HEADROW=2, DATAROW=3, MAXROW=2001;
const L=i=>{let r='';i+=1;while(i>0){const m=(i-1)%26;r=String.fromCharCode(65+m)+r;i=Math.floor((i-1)/26);}return r;};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title,gridProperties(columnCount)))'});
  const p=meta.data.sheets.find(x=>x.properties.sheetId===GID).properties;
  const title=p.title, lastCol=L(p.gridProperties.columnCount-1);
  const head=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A"+HEADROW+":"+lastCol+HEADROW})).data.values[0]||[];
  const idxIpsa=head.indexOf('입사확정일'); const idxLast=head.length-1;
  console.log('탭:'+title+' / 입사확정일='+L(idxIpsa)+' / 마지막열='+L(idxLast));
  const cRcpt=idxLast+1, cLead=idxLast+2;            // 링크 뒤
  const Lr=L(cRcpt), Ll=L(cLead), Ls=L(idxIpsa);
  // 1) 맨뒤 2칸 추가
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{appendDimension:{sheetId:GID,dimension:'COLUMNS',length:2}}]}});
  // 2) 헤더(2행) + 리드타임 수식(3행 앵커)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:"'"+title+"'!"+Lr+HEADROW,valueInputOption:'RAW',requestBody:{values:[['이력서 접수일','리드타임(일)']]}});
  const lead='=ARRAYFORMULA(IF($'+Lr+'$'+DATAROW+':$'+Lr+'$'+MAXROW+'="","",IF($'+Ls+'$'+DATAROW+':$'+Ls+'$'+MAXROW+'="",TODAY()-$'+Lr+'$'+DATAROW+':$'+Lr+'$'+MAXROW+',$'+Ls+'$'+DATAROW+':$'+Ls+'$'+MAXROW+'-$'+Lr+'$'+DATAROW+':$'+Lr+'$'+MAXROW+')))';
  await s.spreadsheets.values.update({spreadsheetId:ID,range:"'"+title+"'!"+Ll+DATAROW,valueInputOption:'USER_ENTERED',requestBody:{values:[[lead]]}});
  // 3) 서식
  const navy={red:0.12,green:0.22,blue:0.39};
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:GID,startRowIndex:HEADROW-1,endRowIndex:HEADROW,startColumnIndex:cRcpt,endColumnIndex:cLead+1},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:10},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:cRcpt,endColumnIndex:cRcpt+1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {setDataValidation:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:cRcpt,endColumnIndex:cRcpt+1},rule:{condition:{type:'DATE_IS_VALID'},showCustomUi:true,strict:false}}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:DATAROW-1,endRowIndex:MAXROW,startColumnIndex:cLead,endColumnIndex:cLead+1},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0"일"'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:cRcpt,endIndex:cLead+1},properties:{pixelSize:105},fields:'pixelSize'}},
  ]}});
  const h2=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!"+Ls+HEADROW+":"+Ll+HEADROW})).data.values[0];
  console.log('추가완료 → 헤더:',h2.join(' | '));
  const k=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A2",valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('대시보드(영향없음):',k);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
