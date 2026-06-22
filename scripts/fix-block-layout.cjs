/* 블록 컬럼 너비 정상화(K 24px→70) + 헤더 남색을 트리(#284772)와 통일. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=500969666;
const TREE_NAVY={red:0x28/255,green:0x47/255,blue:0x72/255}; // #284772
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const reqs=[];
 // 컬럼 너비: G=150,H=60,I=60,J=60,K=72  (col index G=6..K=10)
 const W={6:150,7:60,8:60,9:62,10:72};
 Object.entries(W).forEach(([ci,px])=>reqs.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:+ci,endIndex:+ci+1},properties:{pixelSize:px},fields:'pixelSize'}}));
 // 헤더 남색 통일 (5개 블록 헤더행)
 [11,20,26,31,38].forEach(r=>{const w=(r===38)?2:5;reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:r-1,endRowIndex:r,startColumnIndex:6,endColumnIndex:6+w},cell:{userEnteredFormat:{backgroundColor:TREE_NAVY}},fields:'userEnteredFormat.backgroundColor'}});});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 console.log('컬럼 너비 + 헤더색 통일 완료');
 // 차트 위치 확인 (너비 변경으로 밀렸을 수 있음)
 const m=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(title),charts(spec(title),position(overlayPosition(anchorCell))))'})).data.sheets.find(x=>x.properties.title==='대시보드');
 console.log('차트 anchor:');(m.charts||[]).forEach(c=>{const a=c.position&&c.position.overlayPosition&&c.position.overlayPosition.anchorCell;console.log(`  ${(c.spec&&c.spec.title)}: R${(a&&a.rowIndex||0)+1}C${(a&&a.columnIndex||0)+1}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
