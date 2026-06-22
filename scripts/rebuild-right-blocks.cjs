/* 우측 블록 전체 재구성: r11부터 연속 배치(빈칸 제거) + 입사완료 칸 추가(5열 G~K).
   본부별(E)/우선순위(C)/채용사유(I)/근무지(K) = 5열, 현황(M COUNTIF) = 2열. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$3:$N$2026`,O=`${P}!$O$3:$O$2026`,Mh=`${P}!$M$3:$M$2026`;
const DIM={E:`${P}!$E$3:$E$2026`,C:`${P}!$C$3:$C$2026`,I:`${P}!$I$3:$I$2026`,K:`${P}!$K$3:$K$2026`};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
// 5열 행: label | 채용필요 | 입사완료 | 입사예정 | 달성률
const r5=(label,dimCol,key,rn)=>{const d=DIM[dimCol];
  return [label,
   `=SUMIF(${d},"${key}",${N})`,
   `=SUMIFS(${O},${d},"${key}",${Mh},"입사완료")`,
   `=SUMIF(${d},"${key}",${O})-I${rn}`,
   `=IFERROR((I${rn}+J${rn})/H${rn},0)`];};
async function main(){const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!G1:K55`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_rblocks_20260622.json'),JSON.stringify(bak,null,1));
 await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${TAB}'!G11:K60`]});
 const HDR=['','채용필요','입사완료','입사예정','채용 달성률'];
 const blocks=[];
 // 본부별 r11
 let body=[['본부별',...HDR.slice(1)]];
 ['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부','CEO직속'].forEach((b,i)=>body.push(r5(b,'E',b,12+i)));
 blocks.push({row:11,body});
 // 우선순위 r20
 body=[['우선순위',...HDR.slice(1)]];['P0','P1','P2','P3'].forEach((b,i)=>body.push(r5(b,'C',b,21+i)));
 blocks.push({row:20,body});
 // 채용사유 r26 (결원/신규 + 미지정 special)
 body=[['채용사유',...HDR.slice(1)]];
 body.push(r5('결원','I','결원',27)); body.push(r5('신규','I','신규',28));
 body.push(['미지정(유형 미입력)',
   `=SUMIFS(${P}!$N$5:$N$2029,${P}!$D$5:$D$2029,"<>")-H27-H28`,
   `=SUMIFS(${O},${Mh},"입사완료")-I27-I28`,
   `=(SUMIFS(${P}!$O$5:$O$2029,${P}!$D$5:$D$2029,"<>")-J27-I27-J28-I28)-I29`,
   `=IFERROR((I29+J29)/H29,0)`]);
 blocks.push({row:26,body});
 // 근무지 r31
 body=[['근무지',...HDR.slice(1)]];['퍼플','그린','수원','서울','방교'].forEach((b,i)=>body.push(r5(b,'K',b,32+i)));
 blocks.push({row:31,body});
 // 현황 단계 r38 (2열 count)
 const HY=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정','CPI 진행 중'];
 body=[['현황 단계','건수']];
 HY.forEach((h,i)=>{const extra=h==='면접예정'?`+COUNTIF(${Mh},"면접에정")`:'';body.push([h,`=COUNTIF(${Mh},"${h}")${extra}`]);});
 blocks.push({row:38,body});
 // 쓰기
 const data=blocks.map(b=>({range:`'${TAB}'!G${b.row}`,values:b.body}));
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 // 서식: 각 헤더행 네이비, 달성률% , 숫자
 const navy={red:0.12,green:0.22,blue:0.39};const reqs=[];
 [11,20,26,31,38].forEach(r=>reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:r-1,endRowIndex:r,startColumnIndex:6,endColumnIndex:11},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}}));
 // 달성률 % (K열) for 5열블록 데이터행
 [[12,18],[21,24],[27,29],[32,36]].forEach(([a,b])=>reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:a-1,endRowIndex:b,startColumnIndex:10,endColumnIndex:11},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}}));
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!G11:K45`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 우측 블록 (재구성) ===');chk.forEach((r,i)=>{if(r&&r.some(c=>String(c).trim()!==''))console.log(`r${i+11}: ${JSON.stringify(r)}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
