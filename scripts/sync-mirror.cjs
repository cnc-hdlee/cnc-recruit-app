/* 원본 → TEST/_src 미러 동기화 (오리지날 4단 분류: 부문 ▸ 본부 ▸ 실/부 ▸ 팀)
 * 윈도우 작업스케줄러 주기 실행. 대시보드 수식 자동 재계산.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const DST='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TEST='RAW DATA_정리본(test)';
const clean=x=>{x=String(x==null?'':x).trim();return x==='-'?'':x;};
const num=x=>{if(x===''||x==null)return '';const v=Number(x);return isNaN(v)?'':v;};

// 채용요청 Org1 → 본부(센터급) 정규화 (하위조직은 상위 본부로 끌어올림)
const CENTER_OF={'생산본부':'생산본부','생산기획부':'생산본부','품질경영본부':'생산본부','제조부':'생산본부',
  '경영기획본부':'경영기획본부','People&culture실':'경영기획본부','people&culture실':'경영기획본부',
  '영업본부':'영업본부','Makeup Center':'Makeup Center','Skin Science Center':'Skin Science Center',
  '크리에이티브솔루션본부':'크리에이티브솔루션본부','OD본부':'OD본부','CEO 직속':'CEO직속'};
// 본부 → 부문
const BUMUN_OF={'생산본부':'COO','경영기획본부':'CFO','영업본부':'CBO','Makeup Center':'CRIO','Skin Science Center':'CRIO',
  '크리에이티브솔루션본부':'크리에이티브솔루션','OD본부':'OD','CEO직속':'CEO'};
const centerOf=x=>CENTER_OF[x]||x;
const bumunOf=c=>BUMUN_OF[c]||c;
const fixSilbu=x=>({'품질경영본부':'품질경영부문','people&culture실':'People&Culture실','People&culture실':'People&Culture실'}[x]||x);

// 헤더 (18컬럼): A번호 B우선 C부문 D본부 E실/부 F팀 G직무 H채용유형 I상세사유 J근무지 K직간접 L채용필요 M입사예정 N잔여 O예정충원율 P현황 Q후보자명 R링크
const HEADERS=['채용요청번호','우선순위','부문','본부','실/부','팀','직무','채용유형','채용상세사유','근무지','직/간접','채용 필요 (건)','입사예정','잔여','예정충원율','채용현황','후보자명','채용요청링크'];

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // ===== 채용요청DB → TEST =====
  const src=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'채용요청(정규직)DB'!A1:Q1026`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  const body=src.slice(1).filter(r=>r&&(clean(r[2])||clean(r[5])));
  const rows=body.map((r,i)=>{const rn=i+2;
    const org1=clean(r[2]);const center=centerOf(org1);const bumun=bumunOf(center);
    const silbu=fixSilbu((center===org1)?clean(r[3]):org1); // 하위조직이면 실/부로
    const team=clean(r[4]);
    const q=clean(r[16]),n=clean(r[13]);const qn=/\d+\.\s*[가-힣]/.test(q);
    return [clean(r[0]),clean(r[1]),bumun,center,silbu,team,clean(r[5]),clean(r[8]),clean(r[9]),clean(r[10]),clean(r[11]),num(r[6]),num(r[14]),num(r[15]),`=IFERROR(M${rn}/L${rn},"")`,clean(r[12]),qn?q:n,qn?'':q];});
  await s.spreadsheets.values.update({spreadsheetId:DST,range:`'${TEST}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:[HEADERS,...rows]}});
  await s.spreadsheets.values.clear({spreadsheetId:DST,range:`'${TEST}'!A${rows.length+2}:R2000`});

  // ===== 입사예정DB → _src (A입사일 B부문 C본부 D팀 E성명 F실/부매핑) =====
  const HIRE_CENTER={'생산본부':'생산본부','제조부':'생산본부','Makeup Center':'Makeup Center','Skin Science Center':'Skin Science Center','영업본부':'영업본부','경영기획본부':'경영기획본부','크리에이티브솔루션본부':'크리에이티브솔루션본부'};
  const h=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'입사예정(정규직)DB'!A2:G2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const hire=h.filter(r=>r&&r[6]&&String(r[6]).trim()).map(r=>{const center=HIRE_CENTER[String(r[1]||'').trim()]||String(r[1]||'').trim();return [String(r[0]||''),bumunOf(center),center,String(r[2]||''),String(r[6]||'')];});
  await s.spreadsheets.values.clear({spreadsheetId:DST,range:'_src!A2:E2000'});
  await s.spreadsheets.values.update({spreadsheetId:DST,range:'_src!A1',valueInputOption:'RAW',requestBody:{values:[['입사일','부문','본부','팀','성명'],...hire]}});
  // _src!F : 팀 → 실/부 (TEST에서 VLOOKUP)
  await s.spreadsheets.values.update({spreadsheetId:DST,range:'_src!F1',valueInputOption:'USER_ENTERED',requestBody:{values:[['실/부'],[`=ARRAYFORMULA(IF(D2:D="","",IFERROR(VLOOKUP(D2:D,{'${TEST}'!F2:F2000,'${TEST}'!E2:E2000},2,FALSE),"")))`]]}});

  console.log(new Date().toISOString(),`동기화 OK: 채용요청 ${rows.length}행 / 실제입사 ${hire.length}명`);
}
main().catch(e=>{console.error(new Date().toISOString(),'ERR',e.message);process.exit(1);});
