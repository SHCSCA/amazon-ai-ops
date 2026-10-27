!include "common.nsh"
!include "extractAppPackage.nsh"
!include "MUI2.nsh"
!include "FileFunc.nsh"

# Keep the portable launcher visible while the embedded application package is
# extracted. The upstream electron-builder template deliberately calls
# silent mode, which makes a 1-3 minute first launch look like a broken EXE.
CRCCheck off
WindowIcon On
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}
Caption "${PRODUCT_NAME} · 正在准备"
BrandingText "首次启动约需 1–3 分钟，请勿重复点击"
ShowInstDetails nevershow

!define MUI_PAGE_HEADER_TEXT "正在准备 ${PRODUCT_NAME}"
!define MUI_PAGE_HEADER_SUBTEXT "正在解压运行文件；后续启动仍请等待主窗口出现。"
!insertmacro MUI_PAGE_INSTFILES
# electron-builder's shared header already creates language tables for every
# bundled locale (including custom status strings). Populate the MUI page for
# the same set so makensis does not leave any locale with missing page text.
!insertmacro addLangs

Function .onInit
  # Hold one process-wide launcher mutex. Repeated double-clicks previously
  # started several 735 MiB extractions concurrently and made every launch
  # slower while still showing no window.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\AmazonAIOpsAgentPortableLauncher-v1") p .r8 ?e'
  Pop $R9
  ${If} $R9 = 183
    MessageBox MB_OK|MB_ICONINFORMATION|MB_TOPMOST "运营智能体正在解压或启动，请勿重复点击。"
    Abort
  ${EndIf}

  !insertmacro check64BitAndSetRegView
FunctionEnd

Section "正在解压运行文件"
  InitPluginsDir
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  DetailPrint "正在清理上一次临时运行目录…"
  RMDir /r $INSTDIR
  SetOutPath $INSTDIR
  DetailPrint "正在解压运行文件，首次启动约需 1–3 分钟…"

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        ${endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  DetailPrint "解压完成，正在打开主窗口…"
  HideWindow
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0

  ${If} $0 != 0
    # Hide the launcher only while the real app owns the foreground. If app
    # startup fails, restore the launcher before opening the error dialog;
    # otherwise an owned MessageBox can remain behind an invisible parent.
    ShowWindow $HWNDPARENT ${SW_SHOW}
    BringToFront
    ${If} $0 = 78
      MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "运营智能体未能启动（安全校验错误 78）。$\r$\n$\r$\n正式数据目录尚未通过安全迁移或权限校验。请不要反复双击；保留此提示并联系项目维护流程完成数据库迁移。"
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "运营智能体启动失败，错误码：$0。$\r$\n$\r$\n请保留此提示并导出诊断信息。"
    ${EndIf}
  ${EndIf}
  SetErrorLevel $0

  SetOutPath $EXEDIR
  # 主进程结束后，辅助进程或扫描器仍可能短暂占用程序文件。
  StrCpy $R5 $0
  StrCpy $1 0
portable_cleanup_retry:
  IntOp $1 $1 + 1
  ClearErrors
  RMDir /r "$INSTDIR"
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r2 ?e'
  Pop $3
  ${If} $2 = -1
    ${If} $3 = 2
    ${OrIf} $3 = 3
      Goto portable_cleanup_done
    ${EndIf}
  ${EndIf}
  ${If} $1 < 40
    Sleep 500
    Goto portable_cleanup_retry
  ${EndIf}

  # 清理耗尽必须保留失败状态，日志写在解压目录之外。
  DetailPrint "临时运行目录清理失败：$INSTDIR；尝试 $1 次；应用退出码 $R5；系统错误 $3。"
  System::Call 'kernel32::GetCurrentProcessId() i .r6'
  # LS 使用 GetSystemTime 获取 UTC，输出寄存器避开退出码和清理诊断。
  ${GetTime} "" "LS" $4 $5 $7 $8 $9 $R0 $R1
  ${If} ${Errors}
    DetailPrint "无法读取 UTC 时间，保留清理失败状态。"
    Goto portable_cleanup_log_done
  ${EndIf}
  IntFmt $9 "%02d" $9
  StrCpy $R2 "$7-$5-$4T$9:$R0:$R1Z"
  ClearErrors
  FileOpen $R7 "$TEMP\amazon-ai-ops-portable-cleanup.jsonl" a
  ${IfNot} ${Errors}
    FileWrite $R7 '{"timestamp":"$R2","level":"error","event":"portable.cleanup_failed","context":{"launcherPid":$6,"attempts":$1,"childExitCode":$R5,"win32Error":$3}}$\r$\n'
    FileClose $R7
  ${Else}
    DetailPrint "便携清理诊断日志写入失败。"
  ${EndIf}
portable_cleanup_log_done:
  ${If} $R5 = 0
    SetErrorLevel 79
  ${Else}
    SetErrorLevel $R5
  ${EndIf}
  Goto portable_cleanup_end
portable_cleanup_done:
  SetErrorLevel $R5
portable_cleanup_end:
SectionEnd
