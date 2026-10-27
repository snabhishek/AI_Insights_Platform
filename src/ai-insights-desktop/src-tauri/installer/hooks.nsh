; NSIS Hooks for Compass Installer
!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Preparing to install Compass..."
  DetailPrint "Stopping any running Compass services or processes..."
  ; Terminate any existing Compass or backend instances so DLLs/binaries are not locked
  nsExec::Exec 'taskkill /F /IM app.exe /T'
  nsExec::Exec 'taskkill /F /IM Compass.exe /T'
  nsExec::Exec 'powershell.exe -NoProfile -Command "Get-Process -Name node, python, app, Compass -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \"*$INSTDIR*\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Compass internal dependencies and services..."
  DetailPrint "Checking and provisioning Node.js, Python, WSL, and database services..."
  
  ; Execute setup-deps.ps1 to check and install missing runtimes & configure services
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\scripts\setup-deps.ps1" -InstallDir "$INSTDIR" -Silent'
  Pop $0

  ${If} $0 != 0
    DetailPrint "Dependency setup failed with exit code $0."
    IfFileExists "$INSTDIR\install-failure.txt" read_fail_msg no_fail_msg

  read_fail_msg:
    FileOpen $1 "$INSTDIR\install-failure.txt" r
    StrCpy $2 ""
    ${Do}
      FileRead $1 $3
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      StrCpy $2 "$2$3"
    ${Loop}
    FileClose $1
    MessageBox MB_ICONSTOP|MB_OK "$2"
    Goto abort_install

  no_fail_msg:
    MessageBox MB_ICONSTOP|MB_OK "One or more required dependencies (Node.js, Python, or Docker Desktop) could not be installed automatically.$\r$\n$\r$\nPlease install these services manually and run the installer again.$\r$\n$\r$\nInstallation will now abort."
    Goto abort_install

  abort_install:
    Abort "Installation aborted due to missing dependencies."
  ${EndIf}

  DetailPrint "Compass installed and services configured successfully."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Preparing to uninstall Compass..."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Compass has been removed."
!macroend
