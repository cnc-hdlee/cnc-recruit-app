/* 외국인 RAW DATA: 전원(=정규직/도급직DB 입사자) 서류·면접·건강검진 합격/적합, 채용유형 충원, 최종상태 빈칸→입사. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='생산직 RAW DATA';
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  const iv=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I2:I600`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let last=1;for(let i=0;i<iv.length;i++){if(C(iv[i]&&iv[i][0]))last=2+i;else if(last>1)break;}
  const n=last-1;if(n<1){console.log('데이터 없음');return;}
  const wv=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!W2:W${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const S=[],T=[],V=[],G=[],W=[];let wf=0;
  for(let i=0;i<n;i++){S.push(['합격']);T.push(['합격']);V.push(['적합']);G.push(['결원']);const cur=C(wv[i]&&wv[i][0]);if(!cur){W.push(['입사']);wf++;}else W.push([cur]);}
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:`${TAB}!S2:S${last}`,values:S},{range:`${TAB}!T2:T${last}`,values:T},{range:`${TAB}!V2:V${last}`,values:V},
    {range:`${TAB}!G2:G${last}`,values:G},{range:`${TAB}!W2:W${last}`,values:W},
  ]}});
  console.log(`합격처리: ${n}명 서류/면접=합격·검진=적합·채용유형=결원, 최종상태 빈칸 ${wf}명 입사`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
