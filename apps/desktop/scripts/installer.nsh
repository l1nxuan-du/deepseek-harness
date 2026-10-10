; The Windows installer uses the stock NSIS wizard pages, so it matches the uninstaller's own pages.
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define INSTALLER_SOURCE_DIR "${__FILEDIR__}\..\installer"
!define /ifndef INSTALLER_STRINGS_FILE "${INSTALLER_SOURCE_DIR}\strings.nsh"

ManifestDPIAware true

; MUI, nsDialogs, and the localized strings exist only after the stock template includes MUI2,
; so everything that uses them is spliced in through the header hook.
!macro customHeader
  !include "${INSTALLER_STRINGS_FILE}"
  !ifdef BUILD_UNINSTALLER
    !include "${INSTALLER_SOURCE_DIR}\uninstall.nsh"
  !endif
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
  InitPluginsDir
  File "/oname=$PLUGINSDIR\window-frame.dll" "${INSTALLER_BUILD_DIR}\window-frame.dll"
  ${If} ${Silent}
    StrCpy $InstallerPath $INSTDIR
    Call InstallerPreflight
    ${If} $InstallerError != ""
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; 7-Zip's exit code reaches the report through $R0 and its UTF-8 error output through the log file
; the helper wrote, so the report preserves the verbatim output on disk and in the clipboard.
!macro customInstallerExtract Archive
  System::Call '$PLUGINSDIR\window-frame.dll::InstallerExtract(p $HWNDPARENT, w "$PLUGINSDIR\dsh-7za.exe", w "${Archive}", w "$INSTDIR", w "$PLUGINSDIR\extract.log") i.R0 ?c'
!macroend

; The report outlives $PLUGINSDIR so a user can send it; silent installs keep only the file. The updater cache
; directory is never an installation target and leaves with the application on uninstall.
; The directory smoke fixture predefines DSH_INSTALLER_LOG_DIR to keep reports inside its scratch tree.
!ifndef DSH_INSTALLER_LOG_DIR
  !define DSH_INSTALLER_LOG_DIR "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}\installer-logs"
!endif

!macro customInstallerExtractFailed Archive
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  ; GetTime yields zero-padded day, month, year, weekday, hour, minute, second.
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  StrCpy $0 "${DSH_INSTALLER_LOG_DIR}\extract-failure-$2$1$0-$4$5$6.log"
  StrCpy $1 1
  ${If} ${Silent}
    StrCpy $1 0
  ${EndIf}
  System::Call '$PLUGINSDIR\window-frame.dll::InstallerReportExtractFailure(p $HWNDPARENT, i R0, w "${Archive}", w "$dshNewDirectory", w "$PLUGINSDIR\extract.log", w r0, i r1, w "$(^SetupCaption)", w "$(INSTALLER_EXTRACT_FAILED)", w "$(INSTALLER_EXTRACT_HINT)", w "$(INSTALLER_EXTRACT_COPY)", w "$(INSTALLER_EXTRACT_EXPAND)", w "$(INSTALLER_EXTRACT_COLLAPSE)", w "$(INSTALLER_EXTRACT_SAVED)", w "$(INSTALLER_EXTRACT_UNSAVED)", w "$(INSTALLER_EXTRACT_COPIED)") i.r2 ?c'
  ${If} $2 == 1
    DetailPrint $0
  ${EndIf}
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; The stock check stops the running application. This installation asks for a manual exit instead,
; because a running application keeps its directory as the replacement's rollback source.
!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    InitPluginsDir
    File "/oname=$PLUGINSDIR\window-frame.dll" "${INSTALLER_BUILD_DIR}\window-frame.dll"
  !endif
  System::Call '$PLUGINSDIR\window-frame.dll::InstallerFindProcess(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.R0 ?c'
  ${If} $R0 == 0
    ${If} ${isUpdated}
      ; An update waits for the quit path the updater already started.
      StrCpy $R1 0
      ${DoWhile} $R0 == 0
        Sleep 250
        System::Call '$PLUGINSDIR\window-frame.dll::InstallerFindProcess(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.R0 ?c'
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
  ${If} $R0 < 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_UI_ERROR)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstall
  Call un.CleanData
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
  ; Standard uninstall-entry metadata read by inventory tools; the upstream template records it only under its private key.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend
