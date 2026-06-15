/* 입사예정(정규직)DB → "입사자 명단" 탭에 기존 입사자 채워넣기 (1회). 부문 자동 분류. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const SRC_TAB='입사예정(정규직)DB';
const DST='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='입사자 명단';
const clean=x=>String(x==null?'':x).trim();
// 본부명 정규화 + 부문
const CENTER={'생산본부':'생산본부','제조부':'생산본부','Makeup Center':'Makeup Center','Skin Science Center':'Skin Science Center','영업본부':'영업본부','경영기획본부':'경영기획본부','크리에이티브솔루션본부':'크리에이티브솔루션본부'};
const BUMUN={'생산본부':'COO','경영기획본부':'CFO','영업본부':'CBO','Makeup Center':'CRIO','Skin Science Center':'CRIO','크리에이티브솔루션본부':'크리에이티브솔루션','OD본부':'OD','CEO직속':'CEO'};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // 입사예정DB: A입사일 B본부명 C팀명 D직무 E직급 F신입경력 G성명 H성별 I출생연도 J근무지 K직간접 L비고(전자결재링크) M연락처
  // 비고 하이퍼링크까지 가져오려 includeGridData 사용
  const g=await s.spreadsheets.get({spreadsheetId:SRC,ranges:[`'${SRC_TAB}'!A2:M2000`],includeGridData:true,fields:'sheets(data(rowData(values(formattedValue,hyperlink))))'});
  const rd=(g.data.sheets[0].data[0].rowData||[]).map(r=>r.values||[]);
  const hire=rd.filter(c=>c[6]&&clean(c[6].formattedValue)); // 성명 있는 행
  const V=(c,i)=>clean(c[i]&&c[i].formattedValue);
  // → 입사자명단 B~P (입사확정일·부문·본부·실/부·팀·직무·성명·직급·신입경력·성별·근무지·직간접·채용유형·연락처·비고)
  const rows=hire.map(c=>{
    const rawB=V(c,1);const center=CENTER[rawB]||rawB;const bumun=BUMUN[center]||'';
    const silbu=(center!==rawB)?rawB:''; // 제조부 등 하위면 실/부로
    const link=c[11]&&c[11].hyperlink;const bigo=link?`=HYPERLINK(\"${String(link).replace(/\"/g,'%22')}\",\"전자결재\")`:V(c,11);
    return [V(c,0),bumun,center,silbu,V(c,2),V(c,3),V(c,6),V(c,4),V(c,5),V(c,7),V(c,9),V(c,10),'',V(c,12),bigo];
  });
  // B4부터 쓰기 (A는 자동번호 수식이라 건드리지 않음)
  await s.spreadsheets.values.clear({spreadsheetId:DST,range:`'${TAB}'!B4:P2000`});
  await s.spreadsheets.values.update({spreadsheetId:DST,range:`'${TAB}'!B4`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  console.log(`입사자 ${rows.length}명 채워넣음`);
  // 부문 분포
  const bm={};rows.forEach(r=>{bm[r[1]]=(bm[r[1]]||0)+1;});
  console.log('부문 분포:',JSON.stringify(bm));
  const sum=(await s.spreadsheets.values.get({spreadsheetId:DST,range:`'${TAB}'!A2`,valueRenderOption:'FORMATTED_VALUE'})).data.values[0][0];
  console.log('요약:',sum);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
