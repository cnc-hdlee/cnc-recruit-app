// Windows "휴대폰과 연결"(Phone Link)로 문자 대화창을 번호·문구가 채워진 채로 연다.
//
// 왜 이렇게 하나 —
//   그냥 shell.openExternal('sms:...') 을 쓰면 Windows가 기본 앱 설정을 보고 브라우저로 넘겨버린다.
//   (형도님 PC에서 실제로 웹페이지만 뜨고 보내기 버튼이 없었다)
//   WinRT Launcher.LaunchUriAsync 에 TargetApplicationPackageFamilyName 을 지정하면
//   기본 앱 설정과 무관하게 "휴대폰과 연결"이 그 URI를 받도록 강제할 수 있다.
//   요금은 본인 요금제 안이고 발신번호 사전등록도 필요 없다.
const { spawn } = require('node:child_process');

const PFN = 'Microsoft.YourPhone_8wekyb3d8bbwe';

/** PowerShell 리터럴 안전 처리 — 작은따옴표만 이스케이프하면 된다 */
function psQuote(v) {
  return String(v == null ? '' : v).replace(/'/g, "''");
}

function runPowerShell(script, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      try {
        ps.kill();
      } catch {}
      resolve({ code: -1, out, err: err || '시간 초과' });
    }, timeoutMs);
    ps.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
    ps.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
  });
}

/** 휴대폰과 연결이 설치돼 있는지 */
async function installed() {
  const r = await runPowerShell(
    `$p = Get-AppxPackage -Name Microsoft.YourPhone -ErrorAction SilentlyContinue; if ($p) { 'yes|' + $p.Version } else { 'no' }`
  );
  const [ok, version] = (r.out || 'no').split('|');
  return { installed: ok === 'yes', version: version || '' };
}

// 대화창이 뜬 뒤 휴대폰과 연결 창을 앞으로 끌어와 엔터를 눌러 발송한다.
// sms: URI로 열면 문구가 입력칸에 들어간 채 포커스가 잡히므로 엔터 한 번이면 나간다.
// (문자열 안에 PowerShell here-string이 들어가므로 템플릿 리터럴을 쓰지 않고 배열로 조립한다)
// Windows는 백그라운드 프로세스의 SetForegroundWindow를 막는다(포커스 훔치기 방지).
// 그래서 ① AttachThreadInput으로 현재 포그라운드 스레드에 붙고 ② ALT 키를 눌러 잠금을 풀고
// ③ SetForegroundWindow를 호출하는, 널리 쓰이는 우회를 쓴다. 그래도 안 되면 WScript.Shell
// AppActivate로 한 번 더 시도하고, 실제로 앞에 왔는지 GetForegroundWindow로 확인한 뒤에만 엔터를 친다.
// (확인 없이 엔터를 치면 엉뚱한 창에 입력이 들어간다 — 그건 절대 안 된다)
const PRESS_SEND_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$sig = @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class CncW32 {',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
  '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, int extra);',
  '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '}',
  '"@',
  'Add-Type -TypeDefinition $sig',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$deadline = (Get-Date).AddMilliseconds(__WAIT__)',
  '$p = $null',
  'while ((Get-Date) -lt $deadline) {',
  '  $p = Get-Process -Name PhoneExperienceHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
  '  if ($p) { break }',
  '  Start-Sleep -Milliseconds 250',
  '}',
  "if (-not $p) { 'ERR:휴대폰과 연결 창을 찾지 못했습니다'; exit }",
  '$h = $p.MainWindowHandle',
  'if ([CncW32]::IsIconic($h)) { [CncW32]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 400 }',
  'function Bring-Front($hwnd) {',
  '  $fg = [CncW32]::GetForegroundWindow()',
  '  if ($fg -eq $hwnd) { return $true }',
  '  $dummy = 0',
  '  $fgThread = [CncW32]::GetWindowThreadProcessId($fg, [ref]$dummy)',
  '  $me = [CncW32]::GetCurrentThreadId()',
  '  [CncW32]::AttachThreadInput($me, $fgThread, $true) | Out-Null',
  '  # ALT 눌렀다 떼기 — 포그라운드 잠금 해제',
  '  [CncW32]::keybd_event(0xA4, 0, 0, 0)',
  '  [CncW32]::keybd_event(0xA4, 0, 2, 0)',
  '  [CncW32]::ShowWindow($hwnd, 5) | Out-Null',
  '  [CncW32]::SetForegroundWindow($hwnd) | Out-Null',
  '  [CncW32]::AttachThreadInput($me, $fgThread, $false) | Out-Null',
  '  Start-Sleep -Milliseconds 350',
  '  return ([CncW32]::GetForegroundWindow() -eq $hwnd)',
  '}',
  '$front = $false',
  'for ($i = 0; $i -lt 4 -and -not $front; $i++) {',
  '  $front = Bring-Front $h',
  '  if (-not $front) {',
  '    try { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null } catch {}',
  '    Start-Sleep -Milliseconds 400',
  '    $front = ([CncW32]::GetForegroundWindow() -eq $h)',
  '  }',
  '}',
  "if (-not $front) { 'ERR:창을 앞으로 가져오지 못했습니다 (다른 창이 화면을 잡고 있습니다)'; exit }",
  '# 번호·문구가 대화창에 채워질 시간을 준다',
  'Start-Sleep -Milliseconds __SETTLE__',
  '# 엔터 직전에 한 번 더 확인 — 그 사이 다른 창이 앞으로 왔으면 치지 않는다',
  "if ([CncW32]::GetForegroundWindow() -ne $h) { 'ERR:발송 직전 다른 창이 앞으로 나왔습니다'; exit }",
  "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
  "'OK'",
].join('\n');

/**
 * 대화창을 앞으로 가져와 엔터를 눌러 실제로 발송한다.
 * @param {number} waitMs  창이 뜰 때까지 기다릴 시간
 * @param {number} settleMs 문구가 채워질 때까지 기다릴 시간
 */
async function pressSend(waitMs = 6000, settleMs = 1600) {
  const script = PRESS_SEND_PS.replace('__WAIT__', String(Math.round(waitMs))).replace(
    '__SETTLE__',
    String(Math.round(settleMs))
  );
  const r = await runPowerShell(script, waitMs + 20000);
  const out = (r.out || '').trim();
  if (out.endsWith('OK')) return { pressed: true };
  return {
    pressed: false,
    message: out.startsWith('ERR:') ? out.slice(4) : r.err || out || '알 수 없는 오류',
  };
}

/**
 * 문자 대화창 열기 — 번호와 문구가 채워진 상태.
 * autoSend면 앱이 보내기(엔터)까지 눌러 실제로 발송한다.
 */
async function compose(to, text, { autoSend = false } = {}) {
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) throw new Error('휴대폰 번호가 없습니다');

  // sms:번호?body=문구 — 인코딩은 여기서 끝내고 PowerShell에는 완성된 URI만 넘긴다
  const uri = `sms:${num}?body=${encodeURIComponent(text || '')}`;

  const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  [void][Windows.System.Launcher,Windows.System,ContentType=WindowsRuntime]
  [void][Windows.System.LauncherOptions,Windows.System,ContentType=WindowsRuntime]
  $opts = New-Object Windows.System.LauncherOptions
  $opts.TargetApplicationPackageFamilyName = '${psQuote(PFN)}'
  $uri = New-Object System.Uri('${psQuote(uri)}')
  $op = [Windows.System.Launcher]::LaunchUriAsync($uri, $opts)
  $task = $asTask.MakeGenericMethod([bool]).Invoke($null, @($op))
  $task.Wait(15000) | Out-Null
  if ($task.Result) { 'OK' } else { 'FALSE' }
} catch {
  'ERR:' + $_.Exception.Message
}`;

  const r = await runPowerShell(script);
  const out = (r.out || '').trim();
  if (out.endsWith('OK')) {
    if (!autoSend) return { opened: true, to: num, via: 'phonelink' };
    const sent = await pressSend();
    if (sent.pressed) return { sent: true, to: num, via: 'phonelink' };
    // 엔터를 못 눌렀어도 대화창은 떠 있다 — 사람이 마무리할 수 있게 알린다
    return { opened: true, to: num, via: 'phonelink', autoSendFailed: sent.message };
  }

  // 강제 지정이 막히면 일반 sms: 로 한 번 더 — 기본 앱이 잡혀 있으면 이쪽으로 열린다
  const fb = await runPowerShell(
    `try { Start-Process '${psQuote(uri)}' -ErrorAction Stop; 'OK' } catch { 'ERR:' + $_.Exception.Message }`
  );
  if ((fb.out || '').trim().endsWith('OK')) {
    if (!autoSend) return { opened: true, to: num, via: 'phonelink', fallback: true };
    const sent = await pressSend();
    if (sent.pressed) return { sent: true, to: num, via: 'phonelink', fallback: true };
    return { opened: true, to: num, via: 'phonelink', fallback: true, autoSendFailed: sent.message };
  }

  const why = out.startsWith('ERR:') ? out.slice(4) : r.err || fb.err || out || '알 수 없는 오류';
  throw new Error(`휴대폰과 연결을 열지 못했습니다: ${why.slice(0, 200)}`);
}

module.exports = { compose, installed, pressSend };
