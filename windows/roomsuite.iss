#ifndef StageDir
  #error StageDir must name a prepared installer staging directory.
#endif
#ifndef OutputDir
  #error OutputDir must name the installer output directory.
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SuiteAppId
  #define SuiteAppId "RoomSuite-1F4054C4-23EC-4D6E-A42E-9CA914A64516"
#endif

[Setup]
AppId={#SuiteAppId}
AppName=RoomSuite
AppVersion={#AppVersion}
AppPublisher=RoomSuite
AppPublisherURL=https://github.com/ElHombreAlex/RoomSuite
DefaultDirName={localappdata}\Programs\RoomSuite
DefaultGroupName=RoomSuite
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
AppMutex=Local\RoomSuite-Launcher
CloseApplications=yes
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename=RoomSuite-Setup
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\RoomSuite.exe

[Types]
Name: "typical"; Description: "RoomSuite"
Name: "full"; Description: "RoomSuite with MCP and headless rendering"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "core"; Description: "RoomSuite and its local Node.js runtime"; Types: typical full custom; Flags: fixed
Name: "mcp"; Description: "MCP tools and headless Chromium"; Types: full

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#StageDir}\RoomSuite.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\mcp-node-modules\*"; DestDir: "{app}\mcp\node_modules"; Components: mcp; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\browsers\*"; DestDir: "{app}\browsers"; Components: mcp; Excludes: ".links\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\RoomSuite"; Filename: "{app}\RoomSuite.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\RoomSuite"; Filename: "{app}\RoomSuite.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\RoomSuite.exe"; Description: "Launch RoomSuite"; Flags: nowait postinstall skipifsilent

[Code]
function NextButtonClick(CurPageID: Integer): Boolean;
var AppPath, DataPath: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    AppPath := Lowercase(AddBackslash(ExpandFileName(WizardDirValue)));
    DataPath := Lowercase(AddBackslash(ExpandConstant('{localappdata}\RoomSuite')));
    if (Pos(AppPath, DataPath) = 1) or (Pos(DataPath, AppPath) = 1) then begin
      MsgBox('Choose an application folder outside the RoomSuite data folder: ' + ExpandConstant('{localappdata}\RoomSuite'), mbError, MB_OK);
      Result := False;
    end;
  end;
end;
