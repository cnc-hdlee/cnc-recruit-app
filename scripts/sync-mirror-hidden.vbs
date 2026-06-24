' Runs sync-mirror.bat with NO terminal window (window style 0 = hidden).
' Used by CNC_RecruitMirror scheduled task so the 30-min sync never pops a console.
CreateObject("WScript.Shell").Run """C:\Users\user\Desktop\CNC-Recruit-App\scripts\sync-mirror.bat""", 0, False
