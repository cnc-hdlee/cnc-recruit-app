/* 병합으로 깨진 잔여(Q)·달성률(R)·마감(S) 복구: 데이터행 개별수식. (헤더 병합과 충돌 안나게) */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=660728561;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const title=(await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'})).data.sheets.find(x=>x.properties.sheetId===GID).properties.title;
  // 헤더 위치 확인 (O채용필요 P입사예정 Q잔여 R달성률 S마감)
  const head=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A2:V2"})).data.values[0];
  const col=n=>'ABCDEFGHIJKLMNOPQRSTUV'[head.indexOf(n)];
  const cNeed=col('채용필요인원(명)'),cIpsa=col('입사예정'),cRem=col('잔여'),cAch=col('채용달성율'),cClose=col('마감');
  console.log('필요='+cNeed+' 입사='+cIpsa+' 잔여='+cRem+' 달성률='+cAch+' 마감='+cClose);
  // 데이터행 = C(채용요청번호)에 값, A에 ■아님
  const A=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!A1:A100"})).data.values||[];
  const C=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!C1:C100"})).data.values||[];
  const N=Math.max(A.length,C.length);const dataRows=[];
  for(let i=0;i<N;i++){const a=String((A[i]&&A[i][0])||'');const c=String((C[i]&&C[i][0])||'');if(!a.startsWith('■')&&c.trim()!=='')dataRows.push(i+1);}
  console.log('데이터행:'+dataRows.length+'개 (행'+dataRows[0]+'~'+dataRows[dataRows.length-1]+')');
  // 개별수식 작성
  const data=[];
  dataRows.forEach(r=>{
    data.push({range:"'"+title+"'!"+cRem+r,values:[['='+cNeed+r+'-'+cIpsa+r]]});                              // 잔여=필요-입사
    data.push({range:"'"+title+"'!"+cAch+r,values:[['=IF('+cNeed+r+'=0,"",'+cIpsa+r+'/'+cNeed+r+')']]});      // 달성률=입사/필요
    data.push({range:"'"+title+"'!"+cClose+r,values:[['=IF(AND(ISNUMBER('+cAch+r+'),'+cAch+r+'>=1),"CLOSE","")']]}); // 마감=100%면 CLOSE
  });
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log('잔여·달성률·마감 '+dataRows.length+'행 복구 완료');
  // 검증
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'"+title+"'!"+cNeed+"4:"+cClose+"8",valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach((r,i)=>console.log(' 행'+(i+4)+': 필요'+r[0]+' 입사'+r[1]+' 잔여'+r[2]+' 달성'+r[3]+' 마감'+(r[4]||'-')));
  const k=(await s.spreadsheets.values.get({spreadsheetId:ID,range:"'대시보드'!A2",valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('대시보드:',k);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
