# Optional standalone Windows benchmark + sampler. Never imports Talk env/config.
# Example (only when >=2 GiB physical RAM is available):
# .\scripts\run-phase9c-benchmark.ps1 -Digest 'sha256:<64 hexadecimal characters>'
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^sha256:[a-fA-F0-9]{64}$')]
    [string]$Digest,

    [ValidateSet('qwen3:1.7b-q4_K_M', 'qwen3:1.7b')]
    [string]$Model = 'qwen3:1.7b-q4_K_M',

    [ValidateSet('all', 'en', 'hi', 'hinglish')]
    [string]$Language = 'all',

    [ValidateRange(10000, 600000)]
    [int]$TimeoutMs = 300000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PhysicalMemory {
    $memory = Get-CimInstance -ClassName Win32_OperatingSystem
    [pscustomobject]@{
        AvailableBytes = [int64]$memory.FreePhysicalMemory * 1KB
        TotalBytes = [int64]$memory.TotalVisibleMemorySize * 1KB
    }
}

function Assert-AvailableMemory {
    $memory = Get-PhysicalMemory
    if ($memory.AvailableBytes -lt 2GB) {
        throw ('Benchmark postponed: {0:N2} GiB available physical RAM; at least 2.00 GiB is required. No benchmark was launched.' -f ($memory.AvailableBytes / 1GB))
    }
    return $memory
}

# No child process, network access or inference may precede this check.
$baseline = Assert-AvailableMemory

function Quote-ControlledArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    # Windows PowerShell 5.1 lacks ProcessStartInfo.ArgumentList. Every argument
    # here is a strict enum/hex/integer or an existing local executable/file path.
    # Refuse embedded quotes, control characters and trailing slashes rather than
    # attempting to turn arbitrary user strings into a shell command.
    if ($Value -match '[\x00-\x1f"]' -or $Value.EndsWith('\')) {
        throw 'Unexpected process argument; refusing to launch.'
    }
    return '"' + $Value + '"'
}

function New-OwnedHiddenProcess {
    param([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = (($Arguments | ForEach-Object { Quote-ControlledArgument $_ }) -join ' ')
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    if (-not $process.Start()) { throw 'Could not launch the owned benchmark process.' }
    return [pscustomobject]@{
        Process = $process
        Output = $process.StandardOutput.ReadToEndAsync()
        Error = $process.StandardError.ReadToEndAsync()
    }
}

function Stop-OwnedProcess {
    param($Owned)
    if ($null -ne $Owned -and -not $Owned.Process.HasExited) {
        # This is the exact Process object created above. Never search/kill by name.
        $Owned.Process.Kill()
        [void]$Owned.Process.WaitForExit(5000)
    }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$harness = Join-Path $projectRoot 'scripts\phase9c-benchmark.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$gpuCommand = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $harness -PathType Leaf)) { throw 'The standalone benchmark harness is missing.' }
$samplerDirectory = Join-Path $projectRoot ('artifacts\qa\phase9c\sampler-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($samplerDirectory)

$samples = New-Object 'System.Collections.Generic.List[object]'
$sampleErrors = New-Object 'System.Collections.Generic.List[string]'
$gpuSampler = $null
$benchmark = $null
$startedAt = [DateTimeOffset]::UtcNow
$runFailure = $null
$exitCode = $null
$interrupted = $false

try {
    if ($null -ne $gpuCommand) {
        [void](Assert-AvailableMemory)
        $gpuSampler = New-OwnedHiddenProcess -Executable $gpuCommand.Source -WorkingDirectory $projectRoot -Arguments @(
            '--query-gpu=timestamp,index,memory.total,memory.used,memory.free,utilization.gpu',
            '--format=csv,noheader,nounits', '--loop-ms=1500'
        )
    }

    # The RAM check is repeated immediately before starting the actual harness.
    [void](Assert-AvailableMemory)
    $arguments = @($harness, '--run', '--digest', $Digest, '--model', $Model, '--timeout-ms', [string]$TimeoutMs)
    if ($Language -ne 'all') { $arguments += @('--language', $Language) }
    $benchmark = New-OwnedHiddenProcess -Executable $nodePath -WorkingDirectory $projectRoot -Arguments $arguments

    while (-not $benchmark.Process.HasExited) {
        try {
            $memory = Get-PhysicalMemory
            $cpu = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
            $modelProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
                $_.ProcessName -match '^(ollama(?:[ _-].*)?|llama(?:[ _-].*)?)$'
            } | ForEach-Object {
                [pscustomobject]@{
                    Id = $_.Id
                    Name = $_.ProcessName
                    WorkingSetBytes = $_.WorkingSet64
                    PrivateBytes = $_.PrivateMemorySize64
                }
            })
            $samples.Add([pscustomobject]@{
                AtUtc = [DateTimeOffset]::UtcNow.ToString('o')
                ElapsedMs = [math]::Round(([DateTimeOffset]::UtcNow - $startedAt).TotalMilliseconds)
                AvailablePhysicalBytes = $memory.AvailableBytes
                UsedPhysicalBytes = $memory.TotalBytes - $memory.AvailableBytes
                CpuUtilizationPercent = [int]$cpu.PercentProcessorTime
                ModelProcesses = $modelProcesses
            })
        }
        catch { $sampleErrors.Add($_.Exception.Message) }
        # WaitForExit returns early when the owned harness completes.
        [void]$benchmark.Process.WaitForExit(1500)
    }
    $exitCode = $benchmark.Process.ExitCode
}
catch {
    $runFailure = $_.Exception.Message
    $interrupted = $true
}
finally {
    # Normal completion already lets the harness unload its own approved model.
    # On Ctrl+C/forced interruption only these wrapper-owned children are stopped.
    # Existing Ollama, databases, Docker, Cloudflare and Talk services are untouched.
    Stop-OwnedProcess $benchmark
    Stop-OwnedProcess $gpuSampler

    $gpuSamples = @()
    $gpuError = $null
    if ($null -ne $gpuSampler) {
        $gpuText = $gpuSampler.Output.GetAwaiter().GetResult()
        $gpuError = $gpuSampler.Error.GetAwaiter().GetResult()
        $gpuSamples = @($gpuText -split '\r?\n' | Where-Object { $_.Trim() } | ForEach-Object {
            $columns = $_ -split '\s*,\s*'
            if ($columns.Length -eq 6) {
                [pscustomobject]@{
                    AtLocal = $columns[0]
                    Index = $columns[1]
                    TotalMiB = $columns[2]
                    UsedMiB = $columns[3]
                    FreeMiB = $columns[4]
                    GpuUtilizationPercent = $columns[5]
                }
            }
        })
    }

    $benchmarkOutput = $null
    $benchmarkError = $null
    if ($null -ne $benchmark) {
        $benchmarkOutput = $benchmark.Output.GetAwaiter().GetResult()
        $benchmarkError = $benchmark.Error.GetAwaiter().GetResult()
    }
    $minimumAvailable = $null
    $peakUsed = $null
    $peakCpu = $null
    $peakModelWorking = $null
    $peakModelPrivate = $null
    if ($samples.Count -gt 0) {
        $minimumAvailable = ($samples | Measure-Object -Property AvailablePhysicalBytes -Minimum).Minimum
        $peakUsed = ($samples | Measure-Object -Property UsedPhysicalBytes -Maximum).Maximum
        $peakCpu = ($samples | Measure-Object -Property CpuUtilizationPercent -Maximum).Maximum
        $processSamples = @($samples | ForEach-Object { $_.ModelProcesses })
        if ($processSamples.Count -gt 0) {
            $peakModelWorking = ($processSamples | Measure-Object -Property WorkingSetBytes -Maximum).Maximum
            $peakModelPrivate = ($processSamples | Measure-Object -Property PrivateBytes -Maximum).Maximum
        }
    }
    $gpuPeaks = @($gpuSamples | Where-Object { $_.UsedMiB -match '^\d+$' } | Group-Object -Property Index | ForEach-Object {
        [pscustomobject]@{
            Index = $_.Name
            PeakUsedMiB = ($_.Group | ForEach-Object { [int]$_.UsedMiB } | Measure-Object -Maximum).Maximum
            MinimumFreeMiB = ($_.Group | Where-Object { $_.FreeMiB -match '^\d+$' } | ForEach-Object { [int]$_.FreeMiB } | Measure-Object -Minimum).Minimum
            PeakUtilizationPercent = ($_.Group | Where-Object { $_.GpuUtilizationPercent -match '^\d+$' } | ForEach-Object { [int]$_.GpuUtilizationPercent } | Measure-Object -Maximum).Maximum
        }
    })
    $report = [ordered]@{
        SyntheticOnly = $true
        Model = $Model
        ModelDigest = $Digest
        Language = $Language
        StartedAtUtc = $startedAt.ToString('o')
        FinishedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        SampleIntervalMs = 1500
        Baseline = $baseline
        BenchmarkExitCode = $exitCode
        Interrupted = $interrupted
        Failure = $runFailure
        MinimumAvailablePhysicalBytes = $minimumAvailable
        PeakUsedPhysicalBytes = $peakUsed
        PeakCpuUtilizationPercent = $peakCpu
        PeakSingleModelProcessWorkingSetBytes = $peakModelWorking
        PeakSingleModelProcessPrivateBytes = $peakModelPrivate
        GpuPeaks = $gpuPeaks
        Samples = $samples.ToArray()
        GpuSamples = $gpuSamples
        SampleErrors = $sampleErrors.ToArray()
        NvidiaSamplerError = $gpuError
        BenchmarkOutput = $benchmarkOutput
        BenchmarkError = $benchmarkError
        Limitations = @(
            'System RAM/CPU and GPU samples include all applications; baseline delta is not exclusively model usage.',
            'Sampling can miss short peaks; CIM queries may extend the nominal 1.5-second interval.',
            'Per-process memory peaks are individual process maxima; shared mappings must not be summed as unique memory.',
            'GPU model residency is also recorded by the Node harness; global GPU usage includes other applications.',
            'If forcibly interrupted, the model may remain loaded. Check Ollama and explicitly unload only the approved model before resuming work.'
        )
    }
    $json = $report | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText((Join-Path $samplerDirectory 'system-metrics.json'), $json, (New-Object Text.UTF8Encoding($false)))
    Write-Output ('Synthetic benchmark metrics: ' + (Join-Path $samplerDirectory 'system-metrics.json'))
}

if ($null -ne $runFailure) { throw $runFailure }
if ($null -ne $exitCode -and $exitCode -ne 0) { throw ('Standalone benchmark exited with code ' + $exitCode + '. Review its synthetic metrics report.') }
