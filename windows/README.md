# Windows installer

The per-user installer bundles RoomSuite, an x64 Node.js runtime, and an optional MCP component with the matching Playwright Chromium headless browser. It targets x64-compatible Windows 10 and 11. The optional MCP browser follows [Playwright's system requirements](https://playwright.dev/docs/intro#system-requirements), which currently list Windows 11 or newer; it may work on Windows 10 but is not guaranteed there. An installed user does not need Git, Node, npm, PowerShell or an internet connection to run RoomSuite or install the included MCP component.

Download the `RoomSuite-Windows` artifact from the latest successful [Windows installer workflow](https://github.com/ElHombreAlex/RoomSuite/actions/workflows/windows-installer.yml), unzip it, and open `RoomSuite-Setup.exe`. GitHub requires sign-in for Actions artifacts; artifacts expire after 90 days. The installer is currently unsigned and may show an unfamiliar-publisher warning. The included `SHA256SUMS.txt` can detect accidental download corruption but is not a publisher signature.

Choose **RoomSuite with MCP and headless rendering** during setup to include agent tools. Start RoomSuite from the Start menu, then use **MCP setup** in its launcher to copy the JSON or Codex TOML configuration. Add it to the agent's own settings and restart that agent; the installer does not change existing agent configuration. RoomSuite must remain running while the agent uses it. The JSON paths point to the bundled runtime, MCP server, private workspace and bundled browser. You can rerun the installer to add MCP later. The default port is 8090.

The launcher keeps the local server running while its window is open. Close it to stop RoomSuite. Program files default to `%LOCALAPPDATA%\Programs\RoomSuite`, while Cliproom data, notes, artwork, shared files, and the agent workspace live under `%LOCALAPPDATA%\RoomSuite`. Keep a separate backup of that data folder. Uninstalling from Windows Apps removes installed program files and shortcuts but leaves the data. Close RoomSuite before updating, uninstalling or backing up. Download and run a newer installer to update; select the MCP component again if you use it. There is no automatic update service.

For advanced use, the launcher honors `CLIPROOM_PORT` and `ROOMSUITE_APP_DATA` from its environment; its MCP configuration reflects those values. Run the launcher and agent with compatible settings. It binds only to loopback and has no built-in login. For access from other devices, use the protected Tailscale setup in the [main README](../README.md#use-it-on-other-devices).

Automation can also run `RoomSuite.exe --export-mcp-config <new-file.json>` to write the same JSON shown in the launcher. The parent folder must exist; an existing file is never replaced. It returns a nonzero exit code when the MCP component is missing or the file cannot be created. The configuration does not start RoomSuite or change an agent's settings.

## Build from source

Build from a **clean checkout** so unrelated local files cannot be included. You need Windows, x64 Node.js 20 or newer, npm, Inno Setup 6, and the Windows .NET Framework C# compiler. The build downloads the locked MCP dependencies and matching Playwright headless browser; the resulting installer includes them, even though users can choose whether to install MCP. No code-signing key is included.

~~~powershell
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
npm ci --prefix mcp
./windows/build-installer.ps1
~~~

The result is `dist/RoomSuite-Setup.exe`. The script refuses to replace an existing installer; choose an empty `-OutputDirectory` for another build. Pass `-InnoCompiler` if `ISCC.exe` is not on PATH or at Inno Setup 6's default location. `-BrowserCache` can point to a matching, already downloaded Playwright browser directory. The build verifies that the staged browser launches and removes only its own temporary staging directory.

The [GitHub Actions workflow](../.github/workflows/windows-installer.yml) builds the installer, installs both the basic and MCP variants into temporary folders, verifies launch and MCP rendering, checks that uninstall preserves data, and uploads the installer and checksum. To run the same smoke test yourself, use a test installer built with a unique `-SuiteAppId` so it cannot interfere with an existing RoomSuite installation:

~~~powershell
./windows/build-installer.ps1 -OutputDirectory ./dist/test -SuiteAppId RoomSuite-Test-YourUniqueId
node windows/installer-smoke.cjs ./dist/test/RoomSuite-Setup.exe ./dist/test/smoke
~~~

The smoke test creates and uninstalls only its temporary test copies. Do not use a production AppId on a computer with an existing installation. See the [main README](../README.md#windows-setup) for normal use and Linux setup.
