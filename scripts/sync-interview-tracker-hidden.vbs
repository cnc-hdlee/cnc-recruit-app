' Runs sync-interview-tracker.cjs with NO terminal window (window style 0 = hidden).
' Used by the CNC_InterviewTrackerSync scheduled task.
' chcp 65001 first so the Korean log lines are written as UTF-8 (the shared run-hidden.vbs
' inherits the ANSI codepage and mangles them).
Dim d
d = "C:\Users\user\Desktop\CNC-Recruit-App\scripts"
CreateObject("WScript.Shell").Run _
  "cmd /c chcp 65001 >nul & cd /d """ & d & """ & node sync-interview-tracker.cjs >> """ & d & "\sync-interview-tracker.log"" 2>&1", 0, False
