; Custom NSIS script for APS Admin installer
; Features:
; 1. Skip false-positive running app check (Issue #894)
; 2. Force kill existing app process before install/uninstall
; 3. Do not auto-add to Windows startup during install.
;    Users can enable startup later from app settings.
; Reference: https://github.com/electron-userland/electron-builder/issues/894

; Registry key for startup
!define STARTUP_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define APP_NAME "APS Admin"

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var StartWithWindowsCheckbox
  Var StartWithWindowsChecked
  Var StartupPageShown
!endif

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
  StrCpy $StartupPageShown "0"
  StrCpy $StartWithWindowsChecked "0"
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom StartupOptionsPage StartupOptionsPageLeave
  !macroend

  Function StartupOptionsPage
    ${If} ${Silent}
      Abort
    ${EndIf}

    StrCpy $StartupPageShown "1"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "시작 옵션"
    Pop $0

    ${NSD_CreateCheckbox} 0 38u 100% 14u "Windows 시작 시 APS Admin 자동 실행"
    Pop $StartWithWindowsCheckbox

    ReadRegStr $1 HKCU "${STARTUP_REG_KEY}" "${APP_NAME}"
    ${If} $1 != ""
      ${NSD_Check} $StartWithWindowsCheckbox
    ${EndIf}

    ${NSD_CreateLabel} 0 62u 100% 30u "설치 후에도 APS Admin 설정에서 변경할 수 있습니다."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function StartupOptionsPageLeave
    ${NSD_GetState} $StartWithWindowsCheckbox $StartWithWindowsChecked
  FunctionEnd
!endif

; After install: no startup registry write.
; Security products may flag installers that register auto-start entries.
!macro customInstall
  ${If} $StartupPageShown == "1"
    ${If} $StartWithWindowsChecked == ${BST_CHECKED}
      WriteRegStr HKCU "${STARTUP_REG_KEY}" "${APP_NAME}" '"$INSTDIR\${APP_NAME}.exe"'
    ${Else}
      DeleteRegValue HKCU "${STARTUP_REG_KEY}" "${APP_NAME}"
    ${EndIf}
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
