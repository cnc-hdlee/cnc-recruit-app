/* 외국인 RAW DATA(1CcRpw) 컨테이너 바운드 Apps Script 배포: onEdit 자동 탈락 캐스케이드.
 * 서류(S)불합격→면접(T)불합격·검진(V)부적합·최종(W)탈락·탈락단계(X)서류
 * 면접(T)불합격→검진(V)부적합·최종(W)탈락·탈락단계(X)면접
 * 검진(V)부적합→최종(W)탈락·탈락단계(X)건강검진
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return o;}
const CODE=`function onEdit(e){
  try{
    if(!e||!e.range)return;
    var sh=e.range.getSheet();
    if(sh.getName()!=='생산직 RAW DATA')return;
    var row=e.range.getRow(), col=e.range.getColumn();
    if(row<2)return;
    var v=String(e.value==null?'':e.value).trim();
    // 컬럼: S=19서류 T=20면접 V=22검진 W=23최종 X=24탈락단계
    if(col===19 && v==='불합격'){
      sh.getRange(row,20).setValue('불합격');
      sh.getRange(row,22).setValue('부적합');
      sh.getRange(row,23).setValue('탈락');
      sh.getRange(row,24).setValue('서류');
    } else if(col===20 && v==='불합격'){
      sh.getRange(row,22).setValue('부적합');
      sh.getRange(row,23).setValue('탈락');
      sh.getRange(row,24).setValue('면접');
    } else if(col===22 && v==='부적합'){
      sh.getRange(row,23).setValue('탈락');
      sh.getRange(row,24).setValue('건강검진');
    }
  }catch(err){}
}`;
const MANIFEST=JSON.stringify({timeZone:'Asia/Seoul',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8'});

async function main(){
  const o=await auth();const script=google.script({version:'v1',auth:o});
  // 기존 바운드 스크립트 있으면 재사용 위해 새로 생성(중복 시 onEdit이 둘 실행될 수 있어 주의 — 일단 신규)
  const cr=await script.projects.create({requestBody:{title:'외국인RAW 자동탈락캐스케이드',parentId:TGT}});
  const id=cr.data.scriptId;
  await script.projects.updateContent({scriptId:id,requestBody:{files:[
    {name:'appsscript',type:'JSON',source:MANIFEST},
    {name:'Code',type:'SERVER_JS',source:CODE},
  ]}});
  console.log('OK: 바운드 Apps Script 배포 완료. scriptId='+id);
  console.log('onEdit 단순트리거라 별도 설치 불필요 — 시트에서 서류=불합격 입력 시 자동 탈락 캐스케이드.');
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
