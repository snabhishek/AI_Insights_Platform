; NSIS Custom Hooks for AI Insights Platform Installer

!macro customInstall
  DetailPrint "Setting up AI Insights Platform Internal Services..."
  ; Note: Auto-dependency bootstrap can be invoked during installation if desired:
  ; ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\scripts\setup-deps.ps1"'
!macroend

!macro customUnInstall
  DetailPrint "Stopping AI Insights Platform background processes if any..."
  nsExec::Exec 'taskkill /F /IM node.exe /FI "WINDOWTITLE eq AI Insights Backend*"'
!macroend
