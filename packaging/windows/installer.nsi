; Instalador do servidor RPG Play para Windows (NSIS 3, Unicode).
;
;   makensis /DVERSION=0.3.1 /DSRC=<pasta rpgplay-server do PyInstaller> /DOUTFILE=<saída.exe> installer.nsi
;
; Instala em "Arquivos de Programas\RPG Play Servidor", guarda campanhas em "ProgramData\RPG Play\servidor"
; (mantidas ao desinstalar, a não ser que a pessoa peça para apagar), cria os atalhos do menu Iniciar,
; opcionalmente abre o servidor junto com o Windows e libera o programa no Firewall do Windows só para a
; rede local. Silencioso: /S (o teste do CI usa assim).

Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!include "Sections.nsh"

!ifndef VERSION
  !error "Passe /DVERSION=x.y.z"
!endif
!ifndef SRC
  !error "Passe /DSRC=<pasta do executável gerado pelo PyInstaller>"
!endif
!ifndef OUTFILE
  !define OUTFILE "RPG-Play-Servidor-Setup-${VERSION}.exe"
!endif

!define APP "RPG Play Servidor"
!define EXE "rpgplay-server.exe"
!define RULE "RPG Play Servidor"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APP}"
InstallDirRegKey HKLM "Software\${APP}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "RPG Play ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${APP}"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do servidor RPG Play"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "RPG Play"

!define MUI_ICON "rpgplay.ico"
!define MUI_UNICON "rpgplay.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Servidor RPG Play ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Este computador vai ser o servidor da mesa: guarda as campanhas e conversa com o painel do Mestre e com o app dos jogadores pela rede de casa.$\r$\n$\r$\nDepois de instalar, abra $\"RPG Play Servidor$\" no menu Iniciar e deixe a janela aberta enquanto jogam.$\r$\n$\r$\nSe já houver uma versão instalada, ela é atualizada e as campanhas continuam."
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o servidor agora"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenServer
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir o painel do Mestre no navegador (com o servidor aberto)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenPanel

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Var DataDir

!macro StopServer
  ; Um servidor aberto trava os arquivos. /F: programa de console não responde ao pedido de fechar.
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Pop $0
  Sleep 800
!macroend

Function .onInit
  SetShellVarContext all
  StrCpy $DataDir "$APPDATA\RPG Play\servidor"
FunctionEnd

Function un.onInit
  SetShellVarContext all
  StrCpy $DataDir "$APPDATA\RPG Play\servidor"
FunctionEnd

; Abre sem os privilégios de administrador do instalador (pelo Explorer, como se fosse um clique).
Function OpenServer
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXE}"'
FunctionEnd

Function OpenPanel
  ExecShell "open" "http://localhost:8080/mestre/"
FunctionEnd

Section "Servidor RPG Play" SecMain
  SectionIn RO
  !insertmacro StopServer
  SetOutPath "$INSTDIR"
  ; Atualização: limpa a pasta do programa (as campanhas ficam em ProgramData, fora daqui).
  RMDir /r "$INSTDIR\_internal"
  File /r "${SRC}\*.*"
  File "rpgplay.ico"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  ; Pasta das campanhas: todo usuário do computador pode abrir o servidor (mesmas campanhas).
  CreateDirectory "$DataDir"
  nsExec::ExecToLog 'icacls "$APPDATA\RPG Play" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
  Pop $0
  IfFileExists "$DataDir\servidor.env" +2 0
    File "/oname=$DataDir\servidor.env" "servidor.env"

  ; Menu Iniciar.
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortCut "$SMPROGRAMS\${APP}\RPG Play Servidor.lnk" "$INSTDIR\${EXE}" "serve" "$INSTDIR\rpgplay.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP}\Diagnóstico de rede.lnk" "$SYSDIR\cmd.exe" '/k ""$INSTDIR\${EXE}" diagnostico"' "$INSTDIR\rpgplay.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP}\Liberar no firewall.lnk" "$SYSDIR\cmd.exe" '/k ""$INSTDIR\${EXE}" liberar-firewall"' "$INSTDIR\rpgplay.ico" 0
  ; Este atalho precisa de administrador: liga "Executar como administrador" (bit 0x2000 dos LinkFlags).
  FileOpen $0 "$SMPROGRAMS\${APP}\Liberar no firewall.lnk" a
  FileSeek $0 0x15 SET
  FileReadByte $0 $1
  IntOp $1 $1 | 0x20
  FileSeek $0 0x15 SET
  FileWriteByte $0 $1
  FileClose $0
  CreateShortCut "$SMPROGRAMS\${APP}\Pasta das campanhas.lnk" "$DataDir"
  WriteINIStr "$SMPROGRAMS\${APP}\Painel do Mestre (navegador).url" "InternetShortcut" "URL" "http://localhost:8080/mestre/"
  CreateShortCut "$SMPROGRAMS\${APP}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"

  ; Firewall do Windows: libera o programa (TCP dos celulares e UDP da descoberta) só para a rede local.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${RULE}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow program="$INSTDIR\${EXE}" enable=yes profile=any remoteip=localsubnet description="Celulares e painel do Mestre na rede de casa (RPG Play)"'
  Pop $0
  StrCmp $0 "0" +2 0
    DetailPrint "Aviso: não consegui criar a regra no firewall. Depois use $\"Liberar no firewall$\" no menu Iniciar."

  ; Programas e Recursos.
  WriteRegStr HKLM "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "RPG Play"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\rpgplay.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Abrir o servidor junto com o Windows" SecStartup
  ; Minimizado, para não atrapalhar: fica na barra de tarefas.
  CreateShortCut "$SMSTARTUP\RPG Play Servidor.lnk" "$INSTDIR\${EXE}" "serve" "$INSTDIR\rpgplay.ico" 0 SW_SHOWMINIMIZED
SectionEnd

Section /o "Atalho na área de trabalho" SecDesktop
  CreateShortCut "$DESKTOP\RPG Play Servidor.lnk" "$INSTDIR\${EXE}" "serve" "$INSTDIR\rpgplay.ico" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "O servidor, os atalhos do menu Iniciar e a liberação no Firewall do Windows (só para a rede de casa)."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Liga o servidor sozinho quando o computador inicia, numa janela minimizada."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Um atalho para abrir o servidor pela área de trabalho."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro StopServer
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${RULE}"'
  Pop $0
  Delete "$SMSTARTUP\RPG Play Servidor.lnk"
  Delete "$DESKTOP\RPG Play Servidor.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\rpgplay.ico"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${APP}"
  ; Campanhas: ficam, a não ser que a pessoa peça (no modo silencioso, sempre ficam).
  IfSilent keep
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar também as campanhas, contas e imagens guardadas em$\r$\n$DataDir ?$\r$\n$\r$\nEscolha Não para manter (dá para reinstalar depois e continuar de onde parou)." IDYES wipe IDNO keep
  wipe:
    RMDir /r "$DataDir"
    RMDir "$APPDATA\RPG Play"
  keep:
SectionEnd
