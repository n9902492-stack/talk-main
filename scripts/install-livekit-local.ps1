$ErrorActionPreference = 'Stop'
$talkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$talkVersion = '1.13.10'
$talkFolder = Join-Path $talkRoot 'artifacts\qa\livekit'
$talkArchiveName = "livekit_${talkVersion}_windows_amd64.zip"
$talkRelease = "https://github.com/livekit/livekit/releases/download/v$talkVersion"
New-Item -ItemType Directory -Path $talkFolder -Force | Out-Null
$talkZip = Join-Path $talkFolder $talkArchiveName
$talkChecksums = Join-Path $talkFolder 'checksums.txt'
Invoke-WebRequest -Uri "$talkRelease/$talkArchiveName" -OutFile $talkZip -UseBasicParsing -TimeoutSec 120
Invoke-WebRequest -Uri "$talkRelease/checksums.txt" -OutFile $talkChecksums -UseBasicParsing -TimeoutSec 30
$talkChecksumLine = @(Get-Content -LiteralPath $talkChecksums | Where-Object { ($_ -split '\s+')[-1] -eq $talkArchiveName })
if ($talkChecksumLine.Count -ne 1) { throw 'The official LiveKit checksum was not found.' }
$talkExpectedHash = ($talkChecksumLine[0] -split '\s+')[0]
if ((Get-FileHash -LiteralPath $talkZip -Algorithm SHA256).Hash -ne $talkExpectedHash) { throw 'LiveKit download checksum validation failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$talkArchive = [IO.Compression.ZipFile]::OpenRead($talkZip)
try {
  $talkEntries = @($talkArchive.Entries | Where-Object { $_.FullName -eq 'livekit-server.exe' })
  if ($talkEntries.Count -ne 1) { throw 'The official download did not contain the expected server executable.' }
  [IO.Compression.ZipFileExtensions]::ExtractToFile($talkEntries[0], (Join-Path $talkFolder 'livekit-server.exe'), $true)
} finally { $talkArchive.Dispose() }
Write-Output "Installed official LiveKit $talkVersion for local testing; SHA-256 verified."
