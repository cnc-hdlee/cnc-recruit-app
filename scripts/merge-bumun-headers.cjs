/* ■ 부문 헤더행을 A~V 병합(텍스트 안잘리게). 리드타임은 ARRAYFORMULA→데이터행 개별수식으로 전환(병합충돌 방지). */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=660728561;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title,gridProperties(columnCount)))'});
  const p=meta.data.sheets.find(x=>x.properties.sheetId===GID).properties; const title=p.title; const lastColIdx=p.gridProperties.columnCount-1;
  // A열(■ 헤더) + C열(채용요청번호=데이터행) 읽기
  const A=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A1:A100"})).data.values||[];
  const C=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!C1:C100"})).data.values||[];
  const N=Math.max(A.length,C.length);
  const hdrRows=[], dataRows=[];
  for(let i=0;i<N;i++){const a=String((A[i]&&A[i][0])||'');const c=String((C[i]&&C[i][0])||'');
    if(a.startsWith('■'))hdrRows.push(i+1); else if(c&&c.trim()!=='')dataRows.push(i+1);}
  const lastRow=Math.max(...hdrRows,...dataRows);
  console.log('■ 헤더행:'+hdrRows.join(',')+' / 데이터행수:'+dataRows.length+' / 마지막행:'+lastRow);

  // 1) 기존 리드타임 ARRAYFORMULA 제거
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'"+title+"'!B3:B"+(lastRow+5)});
  // 2) 데이터행에만 개별 리드타임 수식 (헤더행 B는 비움)
  const data=dataRows.map(r=>({range:"'"+title+"'!B"+r,values:[['=IF(ISNUMBER(A'+r+'),IF($U'+r+'="",TODAY()-A'+r+',$U'+r+'-A'+r+'),"")']]}));
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  // 3) ■ 헤더행 A~마지막열 병합 + 왼쪽정렬
  const reqs=[];
  hdrRows.forEach(r=>{
    reqs.push({mergeCells:{range:{sheetId:GID,startRowIndex:r-1,endRowIndex:r,startColumnIndex:0,endColumnIndex:lastColIdx+1},mergeType:'MERGE_ALL'}});
    reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:r-1,endRowIndex:r,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(horizontalAlignment,verticalAlignment)'}});
  });
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('■ 헤더 '+hdrRows.length+'개 병합완료 + 리드타임 데이터행 개별수식 전환');
  // 검증
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A3",valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('행3:',String(chk).slice(0,55));
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A1:X80",valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let errs=0;v.forEach(r=>(r||[]).forEach(c=>{if(/#(VALUE|REF|N\/A|ERROR)/.test(String(c)))errs++;}));
  console.log('에러:',errs);
  const k=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A2",valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('대시보드:',k);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
