' Runs hyeongdo-week-border.cjs with NO terminal window (window style 0 = hidden).
' Used by the CNC_HyeongdoWeekBorder scheduled task.
' chcp 65001 keeps the Korean log readable as UTF-8.
Dim d
d = "C:\Users\user\Desktop\CNC-Recruit-App\scripts"
CreateObject("WScript.Shell").Run _
  "cmd /c chcp 65001 >nul & cd /d """ & d & """ & node hyeongdo-week-border.cjs >> """ & d & "\hyeongdo-week-border.log"" 2>&1", 0, False
