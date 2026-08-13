' Manual interview-tracker mirror. Double-click (or the desktop shortcut) to run.
' No black console window: node runs hidden, then a message box reports the result.
' ASCII source only (per project rule); Korean text is read back from the UTF-8 log.
Option Explicit

Dim dir, logf, sh, fso, rc, msg
dir = "C:\Users\user\Desktop\CNC-Recruit-App\scripts"
logf = dir & "\sync-interview-tracker.log"

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Fresh marker so we only report THIS run's output.
If fso.FileExists(logf) Then fso.DeleteFile logf, True

' 0 = hidden window, True = wait until finished
rc = sh.Run("cmd /c chcp 65001 >nul & cd /d """ & dir & """ & node sync-interview-tracker.cjs >> """ & logf & """ 2>&1", 0, True)

msg = ReadUtf8(logf)
If rc <> 0 Then
  MsgBox "Mirror failed (exit " & rc & ")." & vbCrLf & vbCrLf & msg, 16, "CNC Interview Tracker"
Else
  MsgBox msg, 64, "CNC Interview Tracker"
End If

' Reads a UTF-8 file and returns the interesting lines (skips the per-calendar noise).
Function ReadUtf8(p)
  Dim st, all, lines, i, out
  On Error Resume Next
  Set st = CreateObject("ADODB.Stream")
  st.Type = 2
  st.Charset = "utf-8"
  st.Open
  st.LoadFromFile p
  all = st.ReadText
  st.Close
  If Err.Number <> 0 Then
    ReadUtf8 = "(no log)"
    Exit Function
  End If
  On Error GoTo 0
  lines = Split(Replace(all, vbCrLf, vbLf), vbLf)
  out = ""
  For i = 0 To UBound(lines)
    ' drop the timestamp prefix and the per-calendar progress lines
    If Len(lines(i)) > 20 And InStr(lines(i), "CAL ") = 0 Then
      out = out & Mid(lines(i), 21) & vbCrLf
    End If
  Next
  If Trim(out) = "" Then out = all
  ReadUtf8 = out
End Function
