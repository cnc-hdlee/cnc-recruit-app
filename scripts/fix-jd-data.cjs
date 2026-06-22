const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const CD='_chartdata';const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$5:$N$2029`,O=`${P}!$O$5:$O$2029`,A=`${P}!$A$5:$A$2029`,L=`${P}!$L$5:$L$2029`,V=`${P}!$V$5:$V$2029`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const ME=m=>`EOMONTH(DATE(2026,${m},1),0)`,cur=m=>`${ME(m)}>=EOMONTH(TODAY(),0)`;
const cum=(rng,m,extra='')=>`(SUMIFS(${rng},${A},"<="&${ME(m)}${extra})+IF(${cur(m)},SUMIFS(${rng},${A},""${extra}),0))`;
const dogup=(rng,m)=>cum(rng,m,`,${L},"직접",${V},">0"`);
(async()=>{const s=await auth();
 const cdId=(await s.spreadsheets.get({spreadsheetId:PROG})).data.sheets.find(x=>x.properties.title===CD).properties.sheetId;
 const rows=[['월','정규 채용필요','정규 입사','도급 채용필요','도급 입사']];
 for(let m=1;m<=8;m++){const jdN=dogup(N,m),jdO=dogup(O,m),totN=cum(N,m),totO=cum(O,m);
   rows.push([`${m}월`,`=${totN}-${jdN}`,`=${totO}-${jdO}`,`=${jdN}`,`=${jdO}`]);}
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${CD}'!A16:E24`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
 // 테스트 셀 정리
 await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${CD}'!G16:I19`]});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${CD}'!A16:E24`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 정규/도급 월별 (수정후) ===');chk.forEach((r,i)=>console.log(`r${i+16}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
