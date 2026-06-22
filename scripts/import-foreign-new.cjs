/* 정규직+도급직 외국인(입사 2026-05-01~) 중 타겟에 없는 신규만 추가(이름 중복 제외). 전 항목 매핑(본부/실부 포함). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY',TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='생산직 RAW DATA';
const C=x=>String(x==null?'':x).trim();
const isF=n=>{n=C(n);return n&&n!=='내국인';};
const nd=d=>{const m=C(d).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`:'';};
const recent=d=>{const x=nd(d);return x&&x>='2026-05-01';};
const gender=g=>{g=C(g);return g==='남자'?'남':g==='여자'?'여':g;};
const BUMAP={'생산1팀':'생산1부','포장1팀':'생산1부','생산3팀':'생산1부','포장3팀':'생산1부','생산2팀':'생산2부','포장2팀':'생산2부','생산4팀':'생산2부'};
function birth(rrn){const d=C(rrn).replace(/[^0-9]/g,'');if(d.length<7)return '';const yy=d.slice(0,2),mm=d.slice(2,4),dd=d.slice(4,6),g=d[6];const mi=+mm,di=+dd;if(mi<1||mi>12||di<1||di>31)return '';let c;if('1256'.includes(g))c='19';else if('3478'.includes(g))c='20';else if('90'.includes(g))c='18';else return '';return `${c}${yy}-${mm}-${dd}`;}
const abF=r=>`=IF($I${r}="","",IFS($W${r}="퇴사","퇴사",$W${r}="입사","입사",$W${r}="포기","포기",$X${r}<>"","탈락("&$X${r}&")",$V${r}="적합","건강검진 통과",$T${r}="합격","면접 합격",$S${r}="합격","서류 합격",$R${r}<>"","접수",TRUE,"-"))`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
function row(rn,o){const r=new Array(29).fill('');r[1]='COO';r[2]='생산본부';r[3]=BUMAP[o.team]||'';r[4]=o.team;r[5]=o.job;r[7]=o.loc;r[8]=o.name;r[9]=gender(o.sex);r[10]=o.bd;r[11]=`=IF($K${rn}="","",DATEDIF($K${rn},TODAY(),"Y"))`;r[12]=o.nat;r[13]=o.visa;r[14]=o.visaEnd;r[25]=o.join;r[26]=o.note;r[27]=abF(rn);r[28]=`=IF($R${rn}="","",IF($Z${rn}<>"",$Z${rn}-$R${rn},TODAY()-$R${rn}))`;return r;}

async function main(){
  const s=await auth();
  const jv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`정규직DB!A2:AJ2026`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`도급직DB!A2:U1920`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const jr=jv.filter(r=>isF(r[13])&&recent(r[19])).map(r=>({name:C(r[3]),team:C(r[1]),job:C(r[5]),loc:C(r[11]),sex:C(r[12]),bd:birth(r[4]),nat:C(r[13]),visa:C(r[14]),visaEnd:nd(r[15]),join:nd(r[19]),note:'정규직'}));
  const dr=dv.filter(r=>isF(r[11])&&recent(r[15])).map(r=>({name:C(r[3]),team:C(r[1]),job:C(r[5]),loc:C(r[9]),sex:C(r[10]),bd:birth(r[4]),nat:C(r[11]),visa:C(r[12]),visaEnd:nd(r[13]),join:nd(r[15]),note:('도급'+(C(r[0])?`(${C(r[0])})`:''))+(C(r[20])?` ${C(r[20])}`:'')}));
  const src=[...jr,...dr];
  // 타겟 기존 이름
  const iv=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!I2:I600`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const have=new Set();let last=1;iv.forEach((r,i)=>{const n=C(r&&r[0]);if(n){have.add(n);last=2+i;}});
  const news=src.filter(o=>o.name&&!have.has(o.name));
  console.log(`소스 외국인 ${src.length}명 / 타겟 기존 ${have.size}명 / 신규 ${news.length}명`);
  if(!news.length){console.log('추가할 신규 없음.');return;}
  const start=last+1;
  const rows=news.map((o,i)=>row(start+i,o));
  await s.spreadsheets.values.update({spreadsheetId:TGT,range:`${TAB}!A${start}:AC${start+rows.length-1}`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  console.log(`OK: 신규 ${rows.length}명 추가 (R${start}~R${start+rows.length-1})`);
  news.forEach((o,i)=>console.log(`  R${start+i}: ${o.name} | ${o.team} | ${o.nat} | 입사 ${o.join}`));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
