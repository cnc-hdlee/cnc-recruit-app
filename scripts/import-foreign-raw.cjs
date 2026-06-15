/* 정규직DB+도급직DB에서 외국인(국적≠내국인) & 입사 2026-05-01 이후 추출 → 생산직 외국인 RAW DATA 시트에 추가.
 * 타겟 항목(A~AC) 절대 변경 안 함. 채울 수 있는 칸만. 기존행 미터치, 빈 행부터 append.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY',TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const TAB='생산직 RAW DATA';
const C=x=>String(x==null?'':x).trim();
const isForeign=n=>{n=C(n);return n&&n!=='내국인';};
const normDate=d=>{const m=C(d).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`:'';};
const recent=d=>{const x=normDate(d);return x&&x>='2026-05-01';};
const gender=g=>{g=C(g);return g==='남자'?'남':g==='여자'?'여':g;};
function birth(rrn){const d=C(rrn).replace(/[^0-9]/g,'');if(d.length<7)return '';const yy=d.slice(0,2),mm=d.slice(2,4),dd=d.slice(4,6),g=d[6];
  const mi=+mm,di=+dd;if(mi<1||mi>12||di<1||di>31)return '';
  let c;if('1256'.includes(g))c='19';else if('3478'.includes(g))c='20';else if('90'.includes(g))c='18';else return '';
  return `${c}${yy}-${mm}-${dd}`;}
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

// 타겟 29열(A=0..AC=28). 자동수식 L/AB/AC는 행번호로 생성.
function buildRow(rn,{team,job,loc,name,sex,bd,nat,visa,visaEnd,join,note}){
  const r=new Array(29).fill('');
  r[4]=team; r[5]=job; r[7]=loc; r[8]=name; r[9]=gender(sex); r[10]=bd;
  r[11]=`=IF($K${rn}="","",DATEDIF($K${rn},TODAY(),"Y"))`;
  r[12]=nat; r[13]=visa; r[14]=visaEnd; r[25]=join; r[26]=note||'';
  r[27]=`=IF($I${rn}="","",IFS($W${rn}="입사","입사",$W${rn}="포기","포기",$X${rn}<>"","탈락("&$X${rn}&")",$V${rn}="적합","건강검진 통과",$T${rn}="합격","면접 합격",$S${rn}="합격","서류 합격",$R${rn}<>"","접수",TRUE,"-"))`;
  r[28]=`=IF($R${rn}="","",IF($Z${rn}<>"",$Z${rn}-$R${rn},TODAY()-$R${rn}))`;
  return r;
}
async function main(){
  const s=await auth();
  const jv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`정규직DB!A2:AJ2026`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`도급직DB!A2:U1920`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // 정규직: B1부서 D3성명 E4주민 F5직무 L11근무지 M12성별 N13국적 O14코드 P15체류종료 T19입사
  const jr=jv.filter(r=>isForeign(r[13])&&recent(r[19])).map(r=>({team:C(r[1]),job:C(r[5]),loc:C(r[11]),name:C(r[3]),sex:C(r[12]),bd:birth(r[4]),nat:C(r[13]),visa:C(r[14]),visaEnd:normDate(r[15]),join:normDate(r[19]),note:'정규직'}));
  // 도급직: B1부서 D3성명 E4주민 F5직무 J9근무지 K10성별 L11국적 M12코드 N13체류종료 P15입사 A0업체 U20비고
  const dr=dv.filter(r=>isForeign(r[11])&&recent(r[15])).map(r=>({team:C(r[1]),job:C(r[5]),loc:C(r[9]),name:C(r[3]),sex:C(r[10]),bd:birth(r[4]),nat:C(r[11]),visa:C(r[12]),visaEnd:normDate(r[13]),join:normDate(r[15]),note:('도급'+(C(r[0])?`(${C(r[0])})`:''))+(C(r[20])?` ${C(r[20])}`:'')}));
  const all=[...jr,...dr];
  console.log(`정규직 ${jr.length} + 도급직 ${dr.length} = ${all.length}명`);

  // 기존 데이터 끝 행 탐지 (A열)
  const a=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!A1:A600`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let lastData=1;for(let i=1;i<a.length;i++){if(a[i]&&C(a[i][0]))lastData=i+1;}
  // A열이 비어도 다른 열 있을 수 있어 I(성명)도 체크
  const iv=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I1:I600`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  for(let i=1;i<iv.length;i++){if(iv[i]&&C(iv[i][0]))lastData=Math.max(lastData,i+1);}
  const startRow=lastData+1;
  console.log(`기존 마지막 데이터행=${lastData}, 추가 시작행=${startRow}`);

  const rows=all.map((o,i)=>buildRow(startRow+i,o));
  await s.spreadsheets.values.update({spreadsheetId:TGT,range:`${TAB}!A${startRow}:AC${startRow+rows.length-1}`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  console.log(`OK: ${rows.length}행 추가 (A${startRow}:AC${startRow+rows.length-1})`);
  // 검증
  const chk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!E${startRow}:N${startRow+rows.length-1}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('검증(E~N 팀/직무/채용/근무지/성명/성별/생년월일/나이/국적/비자):');
  chk.forEach((r,i)=>console.log(`  R${startRow+i}: `+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
