// Electron safeStorage(Windows, v10) 복호화: Local State의 os_crypt.encrypted_key(DPAPI) → AES-256-GCM
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const DIR='C:/Users/user/AppData/Roaming/cnc-recruit-app';
function dpapiUnprotect(buf){
  const ps=`$b=[Convert]::FromBase64String('${buf.toString('base64')}');Add-Type -AssemblyName System.Security;[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8'}).trim(),'base64');
}
function getKey(){
  const ls=JSON.parse(fs.readFileSync(DIR+'/Local State','utf8'));
  const raw=Buffer.from(ls.os_crypt.encrypted_key,'base64');
  return dpapiUnprotect(raw.subarray(5)); // strip "DPAPI"
}
function decrypt(rec,key){
  if(!rec) return null;
  if(!rec.enc) return rec.v;
  const b=Buffer.from(rec.v,'base64');
  if(b.subarray(0,3).toString()!=='v10') return dpapiUnprotect(b).toString('utf8');
  const nonce=b.subarray(3,15), tag=b.subarray(b.length-16), ct=b.subarray(15,b.length-16);
  const d=crypto.createDecipheriv('aes-256-gcm',key,nonce); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct),d.final()]).toString('utf8');
}
module.exports={getKey,decrypt,
  appTokens(){
    const cfg=JSON.parse(fs.readFileSync(DIR+'/cnc-recruit-config.json','utf8'));
    const key=getKey();
    return { client: cfg.googleClient, tokens: JSON.parse(decrypt(cfg.googleTokens,key)) };
  }};
if(require.main===module){
  const {client,tokens}=module.exports.appTokens();
  console.log('clientId', client.clientId.slice(0,24)+'...');
  console.log('token keys', Object.keys(tokens));
  console.log('has refresh_token', !!tokens.refresh_token);
  console.log('scope', tokens.scope);
}
