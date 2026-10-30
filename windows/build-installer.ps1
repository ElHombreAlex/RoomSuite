param(
  [string]$OutputDirectory = '',
  [string]$InnoCompiler = '',
  [string]$BrowserCache = '',
  [string]$SuiteAppId = '',
  [switch]$KeepStage
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repo 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$installer = Join-Path $OutputDirectory 'RoomSuite-Setup.exe'
if (Test-Path -LiteralPath $installer) { throw "Installer already exists: $installer. Choose an empty output directory." }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$major = & $node -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 20) { throw 'Node.js 20 or later is required to build the installer.' }
$nodeVersion = & $node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Could not determine the Node.js version.' }
$arch = & $node -p 'process.arch'
if ($LASTEXITCODE -ne 0 -or $arch -ne 'x64') { throw 'The Windows installer requires an x64 Node.js runtime.' }
if (-not (Test-Path -LiteralPath (Join-Path $repo 'mcp\node_modules\playwright\package.json'))) { throw 'Install the locked MCP dependencies first: npm ci --prefix mcp' }
if (-not $InnoCompiler) {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) { $InnoCompiler = $command.Source }
  else { $InnoCompiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }
}
if (-not (Test-Path -LiteralPath $InnoCompiler)) { throw 'Inno Setup compiler ISCC.exe was not found. Pass -InnoCompiler with its path.' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'The .NET Framework C# compiler was not found.' }
$stage = Join-Path $OutputDirectory ('roomsuite-stage-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$oldBrowsers = $env:PLAYWRIGHT_BROWSERS_PATH
$oldGc = $env:PLAYWRIGHT_SKIP_BROWSER_GC
try {
  & $node (Join-Path $PSScriptRoot 'prepare-bundle.cjs') (Join-Path $stage 'app')
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage RoomSuite files.' }
  New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') | Out-Null
  Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime\node.exe')
  $nodeLicense = Join-Path (Split-Path -Parent $node) 'LICENSE'
  if (Test-Path -LiteralPath $nodeLicense -PathType Leaf) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt') }
  else { Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/v$nodeVersion/LICENSE" -OutFile (Join-Path $stage 'runtime\NODE-LICENSE.txt') }
  Copy-Item -LiteralPath (Join-Path $repo 'mcp\node_modules') -Destination (Join-Path $stage 'mcp-node-modules') -Recurse
  $browserDest = Join-Path $stage 'browsers'
  New-Item -ItemType Directory -Path $browserDest | Out-Null
  if ($BrowserCache) {
    $BrowserCache = [IO.Path]::GetFullPath($BrowserCache)
    $versions = Get-Content -Raw -LiteralPath (Join-Path $repo 'mcp\node_modules\playwright-core\browsers.json') | ConvertFrom-Json
    foreach ($name in @('chromium-headless-shell','ffmpeg','winldd')) {
      $browser = $versions.browsers | Where-Object { $_.name -eq $name } | Select-Object -First 1
      if (-not $browser) { throw "Missing Playwright browser metadata: $name" }
      $folder = $name.Replace('-', '_') + '-' + $browser.revision
      $source = Join-Path $BrowserCache $folder
      if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "The browser cache is missing $folder." }
      Copy-Item -LiteralPath $source -Destination (Join-Path $browserDest $folder) -Recurse
    }
  } else {
    $env:PLAYWRIGHT_BROWSERS_PATH = $browserDest
    $env:PLAYWRIGHT_SKIP_BROWSER_GC = '1'
    & $node (Join-Path $repo 'mcp\node_modules\playwright\cli.js') install chromium --only-shell --no-remove
    if ($LASTEXITCODE -ne 0) { throw 'Could not download Playwright Chromium for the installer.' }
  }
  $env:PLAYWRIGHT_BROWSERS_PATH = $browserDest
  $env:PLAYWRIGHT_SKIP_BROWSER_GC = '1'
  & $node (Join-Path $PSScriptRoot 'check-browser.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'The staged browser does not match the MCP dependencies.' }
  & $csc /nologo /target:winexe /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll ("/out:" + (Join-Path $stage 'RoomSuite.exe')) (Join-Path $PSScriptRoot 'RoomSuiteLauncher.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the RoomSuite launcher.' }
  $version = (Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json).version
  $innoArgs = @("/DStageDir=$stage", "/DOutputDir=$OutputDirectory", "/DAppVersion=$version")
  if ($SuiteAppId) { $innoArgs += "/DSuiteAppId=$SuiteAppId" }
  $innoArgs += (Join-Path $PSScriptRoot 'roomsuite.iss')
  & $InnoCompiler @innoArgs
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installer)) { throw 'Could not build the RoomSuite installer.' }
  Write-Host "Installer created: $installer"
} finally {
  $env:PLAYWRIGHT_BROWSERS_PATH = $oldBrowsers
  $env:PLAYWRIGHT_SKIP_BROWSER_GC = $oldGc
  if (-not $KeepStage -and (Test-Path -LiteralPath $stage)) {
    $actual = (Resolve-Path -LiteralPath $stage).Path
    $allowed = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\roomsuite-stage-'
    if (-not $actual.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove an unexpected staging directory.' }
    Remove-Item -LiteralPath $actual -Recurse -Force
  }
}
