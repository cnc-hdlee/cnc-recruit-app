/* G11:N60 서식까지 완전 초기화 후, 우측 블록을 일관 서식으로 재구성.
   본부별/우선순위/채용사유/근무지 = 5열(label·채용필요·입사완료·입사예정·달성률), 현황=2열(건수). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$3:$N$2026`,O=`${P}!$O$3:$O$2026`,Mh=`${P}!$M$3:$M$2026`;
const D={E:`${P}!$E$3:$E$2026`,C:`${P}!$C$3:$C$2026`,I:`${P}!$I$3:$I$2026`,K:`${P}!$K$3:$K$2026`};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const r5=(label,dc,key,rn)=>[label,`=SUMIF(${D[dc]},"${key}",${N})`,`=SUMIFS(${O},${D[dc]},"${key}",${Mh},"입사완료")`,`=SUMIF(${D[dc]},"${key}",${O})-I${rn}`,`=IFERROR((I${rn}+J${rn})/H${rn},0)`];
(async()=>{const s=await auth();
 // 1) 서식 완전 초기화 (G11:N60)
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {updateCells:{range:{sheetId:GID,startRowIndex:10,endRowIndex:60,startColumnIndex:6,endColumnIndex:14},fields:'userEnteredFormat,userEnteredValue'}}
 ]}});
 // 2) 블록 정의
 const HD=['채용필요','입사완료','입사예정','채용 달성률'];
 const B=[];
 let body=[['본부별',...HD]];['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부','CEO직속'].forEach((b,i)=>body.push(r5(b,'E',b,12+i)));B.push({row:11,h:11,d:[12,18],cols:5,body});
 body=[['우선순위',...HD]];['P0','P1','P2','P3'].forEach((b,i)=>body.push(r5(b,'C',b,21+i)));B.push({row:20,h:20,d:[21,24],cols:5,body});
 body=[['채용사유',...HD]];body.push(r5('결원','I','결원',27));body.push(r5('신규','I','신규',28));
 body.push(['미지정(유형 미입력)',`=SUMIFS(${P}!$N$5:$N$2029,${P}!$D$5:$D$2029,"<>")-H27-H28`,`=SUMIFS(${O},${Mh},"입사완료")-I27-I28`,`=(SUMIFS(${P}!$O$5:$O$2029,${P}!$D$5:$D$2029,"<>")-I27-J27-I28-J28)-I29`,`=IFERROR((I29+J29)/H29,0)`]);B.push({row:26,h:26,d:[27,29],cols:5,body});
 body=[['근무지',...HD]];['퍼플','그린','수원','서울','방교'].forEach((b,i)=>body.push(r5(b,'K',b,32+i)));B.push({row:31,h:31,d:[32,36],cols:5,body});
 const HY=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정','CPI 진행 중'];
 body=[['현황 단계','건수']];HY.forEach(h=>{const ex=h==='면접예정'?`+COUNTIF(${Mh},"면접에정")`:'';body.push([h,`=COUNTIF(${Mh},"${h}")${ex}`]);});B.push({row:38,h:38,d:[39,45],cols:2,body});
 // 3) 값 쓰기
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:B.map(b=>({range:`'${TAB}'!G${b.row}`,values:b.body}))}});
 // 4) 서식 일관 적용
 const navy={red:0.12,green:0.22,blue:0.39};const reqs=[];
 const border={style:'SOLID',color:{red:0.8,green:0.8,blue:0.8}};
 B.forEach(b=>{const w=b.cols;
   reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:b.h-1,endRowIndex:b.h,startColumnIndex:6,endColumnIndex:6+w},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
   if(w===5){
     reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:b.d[0]-1,endRowIndex:b.d[1],startColumnIndex:7,endColumnIndex:10},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
     reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:b.d[0]-1,endRowIndex:b.d[1],startColumnIndex:10,endColumnIndex:11},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
   }else{
     reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:b.d[0]-1,endRowIndex:b.d[1],startColumnIndex:7,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}});
   }
   reqs.push({updateBorders:{range:{sheetId:GID,startRowIndex:b.h-1,endRowIndex:b.d[1],startColumnIndex:6,endColumnIndex:6+w},top:border,bottom:border,left:border,right:border,innerHorizontal:border,innerVertical:border}});
 });
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!G11:K45`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 재구성 결과 ===');chk.forEach((r,i)=>{if(r&&r.some(c=>String(c).trim()!==''))console.log(`r${i+11}: ${JSON.stringify(r)}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
