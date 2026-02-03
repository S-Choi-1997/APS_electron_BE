; Custom NSIS script for APS Admin installer
; Features:
; 1. Skip false-positive running app check (Issue #894)
; 2. Force kill existing app process before install/uninstall
; 3. Add to Windows startup on install, remove on uninstall
; Reference: https://github.com/electron-userland/electron-builder/issues/894

; Registry key for startup
!define STARTUP_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define APP_NAME "APS Admin"

; Override the default running app check (it incorrectly detects installer itself)
!macro customCheckAppRunning
  ; Empty - skip the check entirely
  ; The installer falsely detects itself as a running app instance
!macroend

; Before install: force kill any existing app process
!macro customInit
  ; Silent taskkill - ignore errors if app not running
  nsExec::ExecToStack 'cmd /c taskkill /F /IM "APS Admin.exe" 2>nul || exit /b 0'
  Pop $0
  Pop $0
!macroend

; After install: add to Windows startup
!macro customInstall
  ; Check if already registered
  ReadRegStr $0 HKCU "${STARTUP_REG_KEY}" "${APP_NAME}"

  ${If} $0 == ""
    ; Not registered - add to startup
    WriteRegStr HKCU "${STARTUP_REG_KEY}" "${APP_NAME}" '"$INSTDIR\${APP_NAME}.exe"'
  ${Else}
    ; Already registered - update path (in case install location changed)
    WriteRegStr HKCU "${STARTUP_REG_KEY}" "${APP_NAME}" '"$INSTDIR\${APP_NAME}.exe"'
  ${EndIf}
!macroend

; Before uninstall: force kill any existing app process
!macro customUnInit
  nsExec::ExecToStack 'cmd /c taskkill /F /IM "APS Admin.exe" 2>nul || exit /b 0'
  Pop $0
  Pop $0
!macroend

; Uninstall: remove from startup
!macro customUnInstall
  ; Remove from Windows startup
  DeleteRegValue HKCU "${STARTUP_REG_KEY}" "${APP_NAME}"
!macroend
