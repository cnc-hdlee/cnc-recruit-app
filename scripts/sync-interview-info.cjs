/* 생산직 면접내용 ↔ RAW DATA 외국인 이름매칭 → 면접일(U)·유입경로(P)·센터지역(Q)·면접결과(T) 최신화. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SRC='1TtCbTyZ9XIItZ08APYNuYbxPppZHN3iAJGiWewmcJGw',TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='생산직 RAW DATA';
const C=x=>String(x==null?'':x).trim();
const norm=n=>C(n).replace(/[A-Za-z]+$/,'').replace(/\s+/g,'');
const ndate=d=>{const m=C(d).match(/(\d{2,4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);if(!m)return '';let y=m[1];if(y.length===2)y='20'+y;return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;};
function mapPath(p){p=C(p);if(p.includes('일자리센터')||p.includes('박람회')||p.includes('상설면접')){const reg=['화성','수원','오산','안성','용인','동탄'].find(r=>p.includes(r))||'기타';return{유입:'일자리센터',센터:reg};}if(p.includes('추천'))return{유입:'지인추천',센터:'해당없음'};return{유입:'기타',센터:'해당없음'};}
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const iv=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`생산직 면접 내용!A2:D1921`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const byNorm={};iv.forEach(r=>{const nm=C(r[3]);if(nm){const k=norm(nm);if(!byNorm[k])byNorm[k]={경로:C(r[0]),면접일:C(r[1])};}});
  const rv=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I2:I60`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const updates=[];const log=[];
  rv.forEach((row,i)=>{const r=2+i;const name=C(row&&row[0]);if(!name)return;const m=byNorm[norm(name)];if(!m)return;
    const mp=mapPath(m.경로);const fd=ndate(m.면접일);
    updates.push({range:`${TAB}!P${r}`,values:[[mp.유입]]});
    updates.push({range:`${TAB}!Q${r}`,values:[[mp.센터]]});
    if(fd)updates.push({range:`${TAB}!U${r}`,values:[[fd]]});
    updates.push({range:`${TAB}!T${r}`,values:[['합격']]});
    log.push(`R${r} ${name}: 면접일=${fd} 유입=${mp.유입} 센터=${mp.센터} 면접결과=합격 (원본경로:${m.경로})`);
  });
  if(!updates.length){console.log('매칭 없음');return;}
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data:updates}});
  console.log(`OK: ${log.length}명 면접정보 최신화`);log.forEach(l=>console.log('  '+l));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
