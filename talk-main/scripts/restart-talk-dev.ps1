param([switch]$TestEmailDelivery)

$ErrorActionPreference = 'Stop'
$talkProject = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedProject = 'C:\Users\ss828\Downloads\talk-main\talk-main'
if ($talkProject -ne $expectedProject) { throw 'This restart script only operates on the Talk workspace.' }
$talkNode = 'C:\Program Files\nodejs\node.exe'
$talkVite = Join-Path $talkProject 'node_modules\vite\bin\vite.js'
if (!(Test-Path -LiteralPath $talkNode) -or !(Test-Path -LiteralPath $talkVite)) { throw 'Talk Node/Vite installation is unavailable.' }

$talkPortErrors = @()
$listeners = @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue -ErrorVariable +talkPortErrors)
if (@($talkPortErrors | Where-Object { $_.CategoryInfo.Category -ne 'ObjectNotFound' }).Count) { throw 'Could not inspect port 3001 safely. No process was stopped.' }
$talkProcessIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
$talkServesWorkspace = $false
if ($talkProcessIds.Count) {
  $talkSource = (Invoke-WebRequest -Uri 'http://localhost:3001/src/pages/VerifyEmail.tsx' -UseBasicParsing -TimeoutSec 10).Content.Replace('/', '\')
  $talkServesWorkspace = $talkSource.IndexOf((Join-Path $talkProject 'src\pages\VerifyEmail.tsx'), [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (!$talkServesWorkspace) { throw 'Port 3001 does not serve this Talk workspace. No process was stopped.' }
}
foreach ($talkProcessId in $talkProcessIds) {
  $talkProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$talkProcessId"
  $talkCommand = if ($talkProcess) { $talkProcess.CommandLine.Replace('/', '\') } else { '' }
  $talkWorkspaceLauncher = $talkCommand.IndexOf($talkVite, [StringComparison]::OrdinalIgnoreCase) -ge 0
  $talkCachedViteLauncher = $talkCommand.IndexOf('\vite\bin\vite.js', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $talkServesWorkspace
  if (!$talkProcess -or $talkProcess.Name -ne 'node.exe' -or !($talkWorkspaceLauncher -or $talkCachedViteLauncher)) {
    throw 'Port 3001 belongs to another process. No process was stopped.'
  }
}
foreach ($talkProcessId in $talkProcessIds) { Stop-Process -Id $talkProcessId -Force }

$talkLogs = Join-Path $talkProject 'artifacts\qa'
New-Item -ItemType Directory -Path $talkLogs -Force | Out-Null
$talkRun = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$talkServer = Start-Process -FilePath $talkNode -ArgumentList @($talkVite, '--port=3001', '--host=127.0.0.1', '--strictPort') -WorkingDirectory $talkProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $talkLogs "talk-dev-$talkRun.log") -RedirectStandardError (Join-Path $talkLogs "talk-dev-$talkRun-error.log") -PassThru

$talkReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($talkServer.HasExited) { throw 'Talk exited before localhost became ready; inspect the private local server log.' }
  try {
    $talkStatus = Invoke-RestMethod -Uri 'http://localhost:3001/api/auth/email/config' -TimeoutSec 2
    $talkActivePort = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($talkStatus.configured -eq $true -and $talkActivePort.OwningProcess -eq $talkServer.Id) { $talkReady = $true; break }
  } catch { }
}
if (!$talkReady) { throw 'Talk did not become ready on localhost:3001.' }
Write-Output 'Talk localhost backend restarted. Email settings are loaded; credentials are withheld.'
if ($TestEmailDelivery) {
  & $talkNode (Join-Path $talkProject 'server\test-smtp-delivery.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'The live delivery test failed. Credentials and code were withheld.' }
}
