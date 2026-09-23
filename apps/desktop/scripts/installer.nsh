; The Windows installer reuses the stock NSIS pages that the uninstaller already shows.
!include "LogicLib.nsh"
!define INSTALLER_SOURCE_DIR "${__FILEDIR__}\..\installer"
!define /ifndef INSTALLER_STRINGS_FILE "${INSTALLER_SOURCE_DIR}\strings.nsh"

!ifndef BUILD_UNINSTALLER
  ManifestDPIAware true
!endif

; MUI, nsDialogs, and the localized strings exist only after the stock template includes MUI2,
; so everything that uses them is spliced in through the header hook.
!macro customHeader
  !include "${INSTALLER_STRINGS_FILE}"
  !ifndef BUILD_UNINSTALLER
    Var dshDesktopShortcut
    Var dshStartMenuShortcut
    Var dshShortcutPageDesktop
    Var dshShortcutPageStartMenu
    !include "${INSTALLER_SOURCE_DIR}\path.nsh"

    Function dshShortcutPageCreate

      !insertmacro MUI_HEADER_TEXT "$(INSTALLER_SHORTCUTS_HEADER)" "$(INSTALLER_SHORTCUTS_SUBTEXT)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateCheckbox} 0 0 100% 12u "$(INSTALLER_DESKTOP_SHORTCUT)"
      Pop $dshShortcutPageDesktop
      ${NSD_Check} $dshShortcutPageDesktop
      ${NSD_CreateCheckbox} 0 20u 100% 12u "$(INSTALLER_START_MENU_SHORTCUT)"
      Pop $dshShortcutPageStartMenu
      ${NSD_Check} $dshShortcutPageStartMenu
      nsDialogs::Show
    FunctionEnd

    Function dshShortcutPageLeave

      ${NSD_GetState} $dshShortcutPageDesktop $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $dshDesktopShortcut "1"
      ${Else}
        StrCpy $dshDesktopShortcut "0"
      ${EndIf}
      ${NSD_GetState} $dshShortcutPageStartMenu $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $dshStartMenuShortcut "1"
      ${Else}
        StrCpy $dshStartMenuShortcut "0"
      ${EndIf}
      ; The directory page accepts any folder and the stock installer appends the product folder when it
      ; is missing, so the folder that the progress page replaces is validated before it starts.
      StrCpy $InstallerPath $INSTDIR
      StrCpy $0 $InstallerPath 1 -1
      ${If} $0 == "\"
        StrCpy $InstallerPath $InstallerPath -1
      ${EndIf}
      ${GetFileName} $InstallerPath $0
      ${If} $0 != "${APP_FILENAME}"
        StrCpy $InstallerPath "$InstallerPath\${APP_FILENAME}"
      ${EndIf}
      Call InstallerPreflight

      ${If} $InstallerError != ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "$InstallerError" /SD IDOK
        Abort
      ${EndIf}
    FunctionEnd
  !endif
!macroend

; The welcome page is the stock one, so it matches the uninstaller's own pages.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The two shortcut choices share one plain page between the directory and progress pages.
!macro customPageAfterChangeDir
  Page custom dshShortcutPageCreate dshShortcutPageLeave
!macroend

!macro customInit
  ; A silent installation skips the pages and keeps both shortcuts.
  StrCpy $dshDesktopShortcut "1"
  StrCpy $dshStartMenuShortcut "1"
  ${If} ${Silent}
    StrCpy $InstallerPath $INSTDIR
    Call InstallerPreflight
    ${If} $InstallerError != ""
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; The stock check stops the running application. This installation asks for a manual exit instead,
; because a running application keeps its directory as the replacement's rollback source.
!macro customCheckAppRunning
  ; The stock macro declared the command paths before this hook runs.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    ${If} ${isUpdated}
      ; An update waits for the quit path the updater already started.
      StrCpy $R1 0
      ${DoWhile} $R0 == 0
        Sleep 250
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        IntOp $R1 $R1 + 1
        ${If} $R1 >= 40
          ${ExitDo}
        ${EndIf}
      ${Loop}
    ${EndIf}
    ${If} $R0 == 0
      MessageBox MB_OK|MB_ICONINFORMATION "$(INSTALLER_RUNNING)" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  !include "${__FILEDIR__}\installer-directories.nsh"
!endif

!macro customInstall
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  !insertmacro dshFinishDirectories
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend