<#
.SYNOPSIS
    Automated Dependency Detection and Setup for Compass (AI Insights Platform Desktop).
.DESCRIPTION
    Detects and provisions WSL, Docker Desktop, PostgreSQL, LiteLLM, and Node.js.
    Requires the bundled standalone Python service; it never installs or discovers host Python.
    Supports host directory mounting for PostgreSQL in Docker, automated local PostgreSQL
    server initialization, and cleanly aborts if any required service fails to install.
#>

param (
    [string]$InstallDir = "",
    [switch]$CheckOnly,
    [switch]$Silent
)

function Write-Log {
    param([string]$Message, [string]$Type = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Type) {
        "SUCCESS" { "Green" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        Default { "Cyan" }
    }
    Write-Host "[$timestamp] [$Type] $Message" -ForegroundColor $color
}

Write-Log "=========================================================="
Write-Log "  Compass - Desktop Dependency Diagnostics & Provisioning "
Write-Log "=========================================================="

# Resolve target installation directory
if (-not $InstallDir) {
    $parentCandidate = (Resolve-Path (Join-Path $PSScriptRoot "..") -ErrorAction SilentlyContinue)
    if ($parentCandidate -and (Test-Path (Join-Path $parentCandidate.Path "Compass.exe"))) {
        $InstallDir = $parentCandidate.Path
    }
    else {
        $localAppData = Join-Path $env:LOCALAPPDATA "Compass"
        if (Test-Path $localAppData) {
            $InstallDir = $localAppData
        }
        else {
            $InstallDir = if ($parentCandidate) { $parentCandidate.Path } else { $PSScriptRoot }
        }
    }
}
Write-Log "Application Target Directory: $InstallDir"

# Track failed mandatory services for clean abort
$failedServices = [System.Collections.Generic.List[string]]::new()
$appDataDir = Join-Path $env:LOCALAPPDATA "com.compass.platform"
$runtimeEnvPath = Join-Path $appDataDir "desktop.env"
$legacyPostgresDir = Join-Path $InstallDir "data\postgres"
$legacyBackendEnvCandidates = @(
    (Join-Path $InstallDir "resources\services\backend\.env"),
    (Join-Path $PSScriptRoot "../services/backend/.env"),
    (Join-Path $PSScriptRoot "../../src/ai-insights-backend/.env")
)
$legacyDatabasePassword = $null
foreach ($legacyEnvPath in $legacyBackendEnvCandidates) {
    if (Test-Path $legacyEnvPath) {
        $legacyDatabaseEntry = Select-String -Path $legacyEnvPath -Pattern '^\s*DB_PASS\s*=' | Select-Object -First 1
        if ($legacyDatabaseEntry) {
            $legacyDatabasePassword = ($legacyDatabaseEntry.Line -split "=", 2)[1].Trim().Trim('"')
            break
        }
    }
}
$hasLegacyPostgresData = Test-Path (Join-Path $legacyPostgresDir "PG_VERSION")

function New-RandomSecret {
    param([int]$ByteCount = 32)
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
}

try {
    if (-not (Test-Path $appDataDir)) {
        if ($CheckOnly) {
            throw "Compass per-user data directory is not configured. Run dependency setup to initialize it."
        }
        New-Item -ItemType Directory -Path $appDataDir -Force -ErrorAction Stop | Out-Null
    }
    $runtimeValues = @{}
    if (Test-Path $runtimeEnvPath) {
        Get-Content -Path $runtimeEnvPath -ErrorAction Stop | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
                $parts = $line.Split("=", 2)
                $runtimeValues[$parts[0].Trim()] = $parts[1].Trim()
            }
        }
    }
    if ($CheckOnly -and (
        [string]::IsNullOrWhiteSpace($runtimeValues["COMPASS_DB_PASSWORD"]) -or
        [string]::IsNullOrWhiteSpace($runtimeValues["LITELLM_MASTER_KEY"]) -or
        [string]::IsNullOrWhiteSpace($runtimeValues["LITELLM_SALT_KEY"])
    )) {
        throw "Compass service credentials are missing. Run dependency setup to initialize them."
    }
    if (-not $CheckOnly -and [string]::IsNullOrWhiteSpace($runtimeValues["COMPASS_DB_PASSWORD"])) {
        if ($legacyDatabasePassword) {
            $runtimeValues["COMPASS_DB_PASSWORD"] = $legacyDatabasePassword
        }
        elseif ($hasLegacyPostgresData) {
            $runtimeValues["COMPASS_DB_PASSWORD"] = "123456"
        }
        else {
            $runtimeValues["COMPASS_DB_PASSWORD"] = New-RandomSecret
        }
    }
    if (-not $CheckOnly -and [string]::IsNullOrWhiteSpace($runtimeValues["LITELLM_MASTER_KEY"])) {
        $runtimeValues["LITELLM_MASTER_KEY"] = "sk-" + (New-RandomSecret)
    }
    if (-not $CheckOnly -and [string]::IsNullOrWhiteSpace($runtimeValues["LITELLM_SALT_KEY"])) {
        $runtimeValues["LITELLM_SALT_KEY"] = if ($hasLegacyPostgresData) {
            "sk-XXXXXXXXXXXXXXXX"
        }
        else {
            "sk-" + (New-RandomSecret)
        }
    }
    $runtimeContent = @(
        $runtimeValues.Keys | Sort-Object | ForEach-Object {
            "$_=$($runtimeValues[$_])"
        }
    ) -join "`n"
    if (-not $CheckOnly) {
        [System.IO.File]::WriteAllText($runtimeEnvPath, $runtimeContent + "`n", [System.Text.UTF8Encoding]::new($false))
    }
    $env:COMPASS_DB_PASSWORD = $runtimeValues["COMPASS_DB_PASSWORD"]
    $env:LITELLM_MASTER_KEY = $runtimeValues["LITELLM_MASTER_KEY"]
    $env:LITELLM_SALT_KEY = $runtimeValues["LITELLM_SALT_KEY"]
    Write-Log "Persistent per-user service credentials are configured." "SUCCESS"
}
catch {
    Write-Log "Could not create persistent service credentials in ${runtimeEnvPath}: $_" "ERROR"
    $failedServices.Add("Persistent per-user service configuration")
}

# Helper to refresh current process environment PATH from registry and known tool directories
function Refresh-ProcessPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

    $extraPaths = @(
        "$env:ProgramFiles\Docker\Docker\resources\bin",
        "$env:ProgramFiles\Docker\Docker\resources",
        "$env:ProgramW6432\Docker\Docker\resources\bin",
        "${env:ProgramFiles(x86)}\Docker\Docker\resources\bin",
        "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin",
        "C:\Program Files\Docker\Docker\resources\bin",
        "C:\Program Files\Docker\Docker\resources",
        "C:\Program Files (x86)\Docker\Docker\resources\bin"
    )

    $userDirs = Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue
    foreach ($u in $userDirs) {
        $extraPaths += (Join-Path $u.FullName "AppData\Local\Programs\DockerDesktop\resources\bin")
        $extraPaths += (Join-Path $u.FullName "AppData\Local\Programs\Docker\Docker\resources\bin")
    }

    $allParts = @()
    if ($machinePath) { $allParts += $machinePath.Split(';') }
    if ($userPath) { $allParts += $userPath.Split(';') }
    if ($env:Path) { $allParts += $env:Path.Split(';') }
    foreach ($ep in $extraPaths) {
        if ($ep -and (Test-Path $ep)) {
            $allParts += $ep
        }
    }

    $uniquePaths = $allParts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    $env:Path = ($uniquePaths -join ";")
}

# Immediately refresh process PATH so pre-installed tools in standard locations are discovered
Refresh-ProcessPath

# Helper for local TCP port connectivity checks
function Test-PortQuick {
    param([string]$ComputerName = "127.0.0.1", [int]$Port)
    $tcp = [System.Net.Sockets.TcpClient]::new()
    try {
        $tcp.Connect($ComputerName, $Port)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $tcp.Dispose()
    }
}

# -------------------------------------------------------------------------
# 0. Detect and set up Windows Subsystem for Linux (WSL)
# -------------------------------------------------------------------------
Write-Log "Checking Windows Subsystem for Linux (WSL)..."
function Setup-Wsl {
    $wslCmd = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wslCmd) {
        $message = "Windows Subsystem for Linux is unavailable because wsl.exe could not be found."
        Write-Log $message "ERROR"
        $failedServices.Add("Windows Subsystem for Linux ($message)")
        return $false
    }

    & wsl.exe --status 2>&1 | ForEach-Object { Write-Log "[WSL] $_" }
    if ($LASTEXITCODE -eq 0) {
        Write-Log "WSL is installed and responsive." "SUCCESS"
        return $true
    }

    if ($CheckOnly) {
        $message = "WSL is not ready. Run dependency setup to install or enable WSL2; Windows may require a restart."
        Write-Log $message "ERROR"
        $failedServices.Add("Windows Subsystem for Linux ($message)")
        return $false
    }

    Write-Log "WSL is not ready. Installing or enabling WSL2; Windows may ask for administrator approval..." "WARN"
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
        $isAdministrator = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
        $installParams = @{
            FilePath = $wslCmd.Source
            ArgumentList = @("--install", "--no-distribution")
            Wait = $true
            PassThru = $true
            ErrorAction = "Stop"
        }
        if (-not $isAdministrator) {
            $installParams.Verb = "RunAs"
        }

        $installProcess = Start-Process @installParams
        if ($installProcess.ExitCode -eq 3010) {
            throw "WSL setup requires a Windows restart. Restart Windows, then run Compass setup again."
        }
        if ($installProcess.ExitCode -ne 0) {
            throw "wsl.exe --install --no-distribution failed with exit code $($installProcess.ExitCode)."
        }

        & $wslCmd.Source --set-default-version 2 2>&1 | ForEach-Object { Write-Log "[WSL] $_" }
        if ($LASTEXITCODE -ne 0) {
            throw "Could not configure WSL2 as the default. Restart Windows if WSL requested it, then run Compass setup again."
        }

        & $wslCmd.Source --status 2>&1 | ForEach-Object { Write-Log "[WSL] $_" }
        if ($LASTEXITCODE -ne 0) {
            throw "WSL setup is pending. Restart Windows, then run Compass setup again."
        }

        Write-Log "WSL2 is installed and ready." "SUCCESS"
        return $true
    }
    catch {
        $message = "Could not set up WSL2: $_"
        Write-Log $message "ERROR"
        $failedServices.Add("Windows Subsystem for Linux ($message)")
        return $false
    }
}
$wslActive = Setup-Wsl

# -------------------------------------------------------------------------
# 1. Check & Setup Node.js Runtime
# -------------------------------------------------------------------------
Write-Log "Resolving packaged Node.js runtime from bin folder..."
function Find-NodeBinary {
    $packagedNode = Join-Path $InstallDir "resources\bin\node.exe"
    if (Test-Path $packagedNode) {
        return (Resolve-Path $packagedNode).Path
    }
    $devNode = Join-Path $PSScriptRoot "..\src-tauri\resources\bin\node.exe"
    if (Test-Path $devNode) {
        return (Resolve-Path $devNode).Path
    }
    return $null
}

$resolvedNode = Find-NodeBinary
if ($resolvedNode) {
    $nodeVersion = & $resolvedNode -v
    Write-Log "Packaged Node.js binary verified ($nodeVersion) at: $resolvedNode" "SUCCESS"
}
else {
    Write-Log "Packaged Node.js binary (node.exe) was not found in resources\bin\node.exe!" "ERROR"
    $failedServices.Add("Packaged Node.js binary (resources\bin\node.exe)")
}

# -------------------------------------------------------------------------
# 2. Python service is validated as a bundled executable below.
# -------------------------------------------------------------------------

# -------------------------------------------------------------------------
# 3. Check Docker Desktop / Engine
# -------------------------------------------------------------------------
Write-Log "Checking Docker Desktop / Daemon..."

$pgPort = 22003
$litellmPort = 22002
$litellmProxyUrl = "http://127.0.0.1:$litellmPort"
$litellmMasterKey = $env:LITELLM_MASTER_KEY

function Find-DockerBinary {
    $cmd = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $cmd) {
        $cmd = Get-Command docker -ErrorAction SilentlyContinue
    }
    if ($cmd -and $cmd.Source) {
        return (Resolve-Path $cmd.Source).Path
    }

    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
        "$env:ProgramFiles\Docker\Docker\resources\docker.exe",
        "$env:ProgramW6432\Docker\Docker\resources\bin\docker.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\resources\bin\docker.exe",
        "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin\docker.exe",
        "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        "C:\Program Files\Docker\Docker\resources\docker.exe",
        "C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe"
    )

    $userDirs = Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue
    foreach ($u in $userDirs) {
        $candidates += (Join-Path $u.FullName "AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe")
        $candidates += (Join-Path $u.FullName "AppData\Local\Programs\Docker\Docker\resources\bin\docker.exe")
    }

    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) {
            $resolved = (Resolve-Path $p).Path
            $binDir = Split-Path $resolved
            if ($env:Path -notlike "*$binDir*") {
                $env:Path = "$binDir;$env:Path"
            }
            return $resolved
        }
    }

    return $null
}

function Find-DockerDesktop {
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\frontend\Docker Desktop.exe",
        "$env:ProgramW6432\Docker\Docker\Docker Desktop.exe",
        "$env:ProgramW6432\Docker\Docker\frontend\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe",
        "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe"
    )

    $userDirs = Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue
    foreach ($u in $userDirs) {
        $candidates += (Join-Path $u.FullName "AppData\Local\Programs\DockerDesktop\Docker Desktop.exe")
        $candidates += (Join-Path $u.FullName "AppData\Local\Programs\Docker\Docker\Docker Desktop.exe")
    }

    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) {
            return (Resolve-Path $p).Path
        }
    }

    return $null
}

$dockerBin = Find-DockerBinary
$dockerDesktopBin = Find-DockerDesktop
$dockerRunning = $false

# Check Docker daemon health via binary if not already confirmed by listening ports
if (-not $dockerRunning -and $dockerBin) {
    try {
        $dockerInfo = & "$dockerBin" info 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerRunning = $true
            Write-Log "Docker daemon is running and healthy ($dockerBin)." "SUCCESS"
        }
    }
    catch {
        Write-Log "Could not query Docker daemon: $_" "WARN"
    }
}

if ($dockerRunning) {
    Write-Log "Docker daemon confirmed running and healthy." "SUCCESS"
}
elseif ($dockerBin -or $dockerDesktopBin) {
    Write-Log "Docker is installed ($dockerBin), but daemon is not running." "WARN"
    if (-not $CheckOnly) {
        Write-Log "Starting Docker Desktop..."
        if ($dockerBin) {
            & "$dockerBin" desktop start -d 2>&1 | ForEach-Object { Write-Log "[Docker] $_" }
        }

        # Start Docker background Windows service if present
        $dockerService = Get-Service "com.docker.service" -ErrorAction SilentlyContinue
        if ($dockerService -and $dockerService.Status -ne "Running") {
            try {
                Start-Service -InputObject $dockerService -ErrorAction Stop
            }
            catch {
                Write-Log "Could not start the Docker Windows service: $_" "WARN"
            }
        }

        if ($dockerDesktopBin) {
            $runningDesktop = Get-Process -Name "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
            if (-not $runningDesktop) {
                try {
                    Start-Process -FilePath "$dockerDesktopBin" -ErrorAction Stop | Out-Null
                }
                catch {
                    Write-Log "Could not launch Docker Desktop: $_" "ERROR"
                }
            }
        }

        Write-Log "Waiting for Docker daemon readiness..."
        while (-not $dockerRunning -and $dockerBin) {
            Start-Sleep -Seconds 3
            $dockerInfo = & "$dockerBin" info 2>&1
            if ($LASTEXITCODE -eq 0) {
                $dockerRunning = $true
                Write-Log "Docker daemon is now ready!" "SUCCESS"
            }
            else {
                Write-Log "Docker daemon is still starting: $dockerInfo" "WARN"
            }
        }
    }
}
else {
    Write-Log "Docker is NOT installed!" "WARN"
    if (-not $CheckOnly) {
        Write-Log "Attempting to install Docker Desktop via winget..."
        try {
            winget install Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) {
                Write-Log "Docker Desktop installation failed with winget exit code $LASTEXITCODE." "ERROR"
            }
        }
        catch {
            Write-Log "Could not install Docker Desktop with winget: $_" "ERROR"
        }
        Refresh-ProcessPath
        $dockerBin = Find-DockerBinary
        $dockerDesktopBin = Find-DockerDesktop
        if ($dockerBin -or $dockerDesktopBin) {
            Write-Log "Docker Desktop installed. Starting daemon..."
            if ($dockerBin) {
                & "$dockerBin" desktop start -d 2>$null
            }
            if ($dockerDesktopBin) {
                try {
                    Start-Process -FilePath "$dockerDesktopBin" -ErrorAction Stop | Out-Null
                }
                catch {
                    Write-Log "Could not launch Docker Desktop: $_" "ERROR"
                }
            }
            while (-not $dockerRunning -and $dockerBin) {
                Start-Sleep -Seconds 3
                $dockerInfo = & "$dockerBin" info 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $dockerRunning = $true
                    Write-Log "Docker daemon is now ready!" "SUCCESS"
                }
                else {
                    Write-Log "Docker daemon is still starting: $dockerInfo" "WARN"
                }
            }
        }
    }
}

function Setup-LiteLLMSearchTools {
    param(
        [Parameter(Mandatory = $true)][string]$NodeBin,
        [Parameter(Mandatory = $true)][string]$ProxyUrl,
        [Parameter(Mandatory = $true)][string]$MasterKey
    )
    Write-Log "Configuring DuckDuckGo and You.com search tools in LiteLLM Proxy..."

    # Single strict location: alongside setup-deps.ps1 in the scripts folder
    $toolScript = Join-Path $PSScriptRoot "setup-search-tools.cjs"
    if (-not (Test-Path $toolScript)) {
        Write-Log "Required LiteLLM search tools setup script not found at: $toolScript" "ERROR"
        $failedServices.Add("LiteLLM Search Tools Setup Script ($toolScript)")
        return
    }

    Write-Log "Executing search tools configuration with packaged Node ($NodeBin)..."
    & $NodeBin "$toolScript" "$ProxyUrl" "$MasterKey" 2>&1 | ForEach-Object { Write-Log "[LiteLLM-Tools] $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Failed to configure LiteLLM search tools via packaged Node!" "ERROR"
        $failedServices.Add("LiteLLM Search Tools Configuration")
    }
    else {
        Write-Log "LiteLLM search tools configured successfully!" "SUCCESS"
    }
}

# -------------------------------------------------------------------------
# 4. Unified Docker Compose Services (PostgreSQL :22003 & LiteLLM :22002)
# -------------------------------------------------------------------------
Write-Log "Checking unified Docker Compose services (PostgreSQL on port 22003, LiteLLM on port 22002)..."

$pgPort = 22003
$litellmPort = 22002
$litellmProxyUrl = "http://127.0.0.1:$litellmPort"
$litellmMasterKey = $env:LITELLM_MASTER_KEY

# Locate docker-compose.yml
$possibleComposePaths = @(
    (Join-Path $InstallDir "resources\docker\docker-compose.yml"),
    (Join-Path $InstallDir "docker\docker-compose.yml"),
    (Join-Path $PSScriptRoot "../docker/docker-compose.yml"),
    (Join-Path $PSScriptRoot "../../src/ai-insights-desktop/docker/docker-compose.yml"),
    (Join-Path $PSScriptRoot "../../ai-insights-desktop/docker/docker-compose.yml"),
    (Join-Path $PSScriptRoot "../../src/ai-insights-backend/logs/docker-compose.yml")
)

$composePath = $null
foreach ($cPath in $possibleComposePaths) {
    if (Test-Path $cPath) {
        $composePath = (Resolve-Path $cPath).Path
        break
    }
}

if (-not $dockerRunning) {
    Write-Log "Docker Desktop is NOT running. PostgreSQL and LiteLLM require Docker." "ERROR"
    $failedServices.Add("Docker Desktop (Required to run containerized PostgreSQL and LiteLLM)")
}
else {
    Write-Log "Docker daemon is active. Verifying containerized services..."

    $legacyDataMigrationFailed = $false
    $newPostgresDataDir = Join-Path $appDataDir "data\postgres"
    if ($hasLegacyPostgresData -and -not (Test-Path (Join-Path $newPostgresDataDir "PG_VERSION"))) {
        if ($CheckOnly) {
            Write-Log "Legacy PostgreSQL data exists at $legacyPostgresDir and will be migrated during dependency setup." "WARN"
        }
        else {
            Write-Log "Migrating existing PostgreSQL data to the per-user Compass data directory..."
            try {
                $runningContainer = & $dockerBin ps -q --filter "name=^/ai-insights-postgres$"
                if ($LASTEXITCODE -ne 0) {
                    throw "Could not check whether the existing PostgreSQL container is running."
                }
                if ($runningContainer) {
                    & $dockerBin stop ai-insights-postgres 2>&1 | ForEach-Object { Write-Log "[Docker] $_" }
                    if ($LASTEXITCODE -ne 0) {
                        throw "Could not stop the existing PostgreSQL container before migrating its data."
                    }
                }

                if (Test-Path $newPostgresDataDir) {
                    $existingTargetFiles = Get-ChildItem -Path $newPostgresDataDir -Force -ErrorAction Stop
                    if ($existingTargetFiles.Count -gt 0) {
                        throw "The new PostgreSQL data directory is not empty: $newPostgresDataDir"
                    }
                }
                else {
                    New-Item -ItemType Directory -Path $newPostgresDataDir -Force -ErrorAction Stop | Out-Null
                }

                $migrationOutput = & robocopy "$legacyPostgresDir" "$newPostgresDataDir" /E /COPY:DAT /DCOPY:DAT /R:0 /W:0 2>&1
                $migrationExitCode = $LASTEXITCODE
                $migrationOutput | ForEach-Object { Write-Log "[DataMigration] $_" }
                if ($migrationExitCode -ge 8 -or -not (Test-Path (Join-Path $newPostgresDataDir "PG_VERSION"))) {
                    throw "PostgreSQL data migration failed with robocopy exit code $migrationExitCode."
                }
                Write-Log "Existing PostgreSQL data was copied successfully. The original data was preserved at $legacyPostgresDir." "SUCCESS"
            }
            catch {
                $legacyDataMigrationFailed = $true
                Write-Log "Could not migrate existing PostgreSQL data: $_" "ERROR"
                $failedServices.Add("PostgreSQL data migration ($_)")
            }
        }
    }

    # Check if ports are already listening
    $pgListening = Test-PortQuick -Port $pgPort
    $llmListening = Test-PortQuick -Port $litellmPort

    if ((-not $pgListening -or -not $llmListening) -and -not $CheckOnly -and -not $legacyDataMigrationFailed) {
        if ($composePath) {
            $composeDir = Split-Path $composePath
            Write-Log "Deploying unified Docker Compose stack from: $composePath..."

            # Keep persistent service data in the current user's local application data.
            $dataDir = Join-Path $appDataDir "data\postgres"
            if (-not (Test-Path $dataDir)) {
                New-Item -ItemType Directory -Path $dataDir -Force -ErrorAction Stop | Out-Null
            }
            $env:POSTGRES_DATA_DIR = $dataDir.Replace('\', '/')
            $initScriptsDir = Join-Path $composeDir "init-scripts"
            if (-not (Test-Path $initScriptsDir)) {
                New-Item -ItemType Directory -Path $initScriptsDir -Force | Out-Null
                $initSql = @"
SELECT 'CREATE DATABASE docspyre_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'docspyre_app')\gexec
SELECT 'CREATE DATABASE litellm' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec
GRANT ALL PRIVILEGES ON DATABASE docspyre_app TO postgres;
GRANT ALL PRIVILEGES ON DATABASE litellm TO postgres;
"@
                Set-Content -Path (Join-Path $initScriptsDir "01-init-databases.sql") -Value $initSql -Encoding UTF8
            }

            # Ensure config.yaml for LiteLLM search tools exists
            $composeConfigYaml = Join-Path $composeDir "config.yaml"
            if (-not (Test-Path $composeConfigYaml)) {
                $defaultConfigYaml = @"
search_tools:
  - search_tool_name: duckduckgo
    litellm_params:
      search_provider: duckduckgo
    search_tool_info:
      description: "DuckDuckGo web search tool"
  - search_tool_name: you_com
    litellm_params:
      search_provider: you_com
    search_tool_info:
      description: "You.com web search tool"
"@
                Set-Content -Path $composeConfigYaml -Value $defaultConfigYaml -Encoding UTF8
            }

            # Start Compose services and wait for health without an arbitrary startup deadline.
            Push-Location $composeDir
            try {
                $dExe = if ($dockerBin) { $dockerBin } else { "docker" }
                & $dExe compose --env-file "$runtimeEnvPath" -f "$composePath" -p compass up -d --wait 2>&1 | ForEach-Object { Write-Log "[DockerCompose] $_" }
                if ($LASTEXITCODE -ne 0) {
                    Write-Log "Docker Compose failed with exit code $LASTEXITCODE." "ERROR"
                    $failedServices.Add("Docker Compose startup (exit code $LASTEXITCODE)")
                }
            }
            catch {
                Write-Log "Failed to execute docker compose: $_" "ERROR"
                $failedServices.Add("Docker Compose startup ($_)")
            }
            finally {
                Pop-Location
            }
        }
        else {
            Write-Log "Unified docker-compose.yml was not found in expected candidate locations!" "ERROR"
        }
    }

    # Verify PostgreSQL on port 22003
    $pgFinal = Test-PortQuick -Port $pgPort
    if ($pgFinal) {
        Write-Log "PostgreSQL container is active and listening on port $pgPort!" "SUCCESS"
    }
    else {
        Write-Log "PostgreSQL service is not responding on port $pgPort!" "ERROR"
        $failedServices.Add("PostgreSQL Container Service (port $pgPort via Docker)")
    }

    # Verify LiteLLM on port 22002
    $llmFinal = Test-PortQuick -Port $litellmPort
    if ($llmFinal) {
        Write-Log "LiteLLM Proxy is active and responding on port $litellmPort!" "SUCCESS"
        if (-not $CheckOnly) {
            Setup-LiteLLMSearchTools -NodeBin $resolvedNode -ProxyUrl $litellmProxyUrl -MasterKey $litellmMasterKey
        }
    }
    else {
        Write-Log "LiteLLM Proxy is not responding on port $litellmPort!" "ERROR"
        $failedServices.Add("LiteLLM Proxy Container Service (port $litellmPort via Docker)")
    }
}

# -------------------------------------------------------------------------
# 5. On-Demand Environment (.env) Configuration
# -------------------------------------------------------------------------
function Configure-OnDemandEnvFile {
    param([string]$TargetBackendDir)

    if (-not (Test-Path $TargetBackendDir)) { return }

    $envPath = Join-Path $TargetBackendDir ".env"
    Write-Log "Configuring on-demand environment file at: $envPath..."

    $cPort = "22000"
    $cHost = "127.0.0.1"
    $cServiceUrl = "http://127.0.0.1:22004"
    $cFileServer = $appDataDir
    $cDbHost = "127.0.0.1"
    $cDbPort = "22003"
    $cDbName = "docspyre_app"
    $cDbUser = "postgres"
    $cDbPass = $env:COMPASS_DB_PASSWORD
    $cProvider = "litellm"
    $cLiteLlmUrl = $litellmProxyUrl
    $cLiteLlmMaster = $litellmMasterKey
    # LiteLLM virtual key and active model must NOT be copied or inherited from project backend values.
    # The desktop app backend starts with empty model/virtual key state until explicitly configured in the UI.
    $cLiteLlmVirtual = ""
    $cLiteLlmModel = ""

    $envContent = @"
# Server Configuration (On-Demand Configured by Compass Installer)
PORT=$cPort
HOST=$cHost
AI_INSIGHTS_SERVICE_URL=$cServiceUrl
FILE_SERVER_PATH="$cFileServer"

# Database Configuration (Docker Compose Shared PostgreSQL)
DB_HOST=$cDbHost
DB_PORT=$cDbPort
DB_NAME=$cDbName
DB_USER=$cDbUser
DB_PASS=$cDbPass

# AI Provider Selection
AI_PROVIDER=$cProvider

# LiteLLM Configuration (Docker Compose Shared Service)
LITELLM_PROXY_URL=$cLiteLlmUrl
LITELLM_MASTER_KEY=$cLiteLlmMaster
LITELLM_VIRTUAL_KEY=$cLiteLlmVirtual
LITELLM_MODEL=$cLiteLlmModel
LITELLM_MODEL_NAME=$cLiteLlmModel

# Tracing
AI_LLM_TRACE_ENABLED=true
AI_LLM_TRACE_MAX_CHARS=400000
"@

    Set-Content -Path $envPath -Value $envContent -Encoding UTF8 -Force
    Write-Log "On-demand environment (.env) generated successfully at: $envPath" "SUCCESS"
}


# -------------------------------------------------------------------------
# 6. Backend Service Dependencies (node_modules)
# -------------------------------------------------------------------------
$possibleBackendDirs = @(
    (Join-Path $InstallDir "resources\services\backend"),
    (Join-Path $PSScriptRoot "../services/backend"),
    (Join-Path $PSScriptRoot "../../src/ai-insights-backend"),
    (Join-Path $PSScriptRoot "../../ai-insights-backend")
)

$backendDir = $null
foreach ($dir in $possibleBackendDirs) {
    if (Test-Path $dir) {
        $backendDir = $dir
        break
    }
}

if ($backendDir) {
    if (-not $CheckOnly) {
        Configure-OnDemandEnvFile -TargetBackendDir $backendDir
    }
    Write-Log "Checking Backend service dependencies in $backendDir..."
    $backendNodeModules = Join-Path $backendDir "node_modules"
    $backendArchiveGz = Join-Path $backendDir "node_modules.tar.gz"
    $backendArchiveTar = Join-Path $backendDir "node_modules.tar"
    $langchainCheck = Join-Path $backendNodeModules "@langchain\core\dist\callbacks\manager.cjs"
    $needsInstall = (-not (Test-Path $backendNodeModules)) -or (-not (Test-Path $langchainCheck))

    if ($needsInstall) {
        if (-not $CheckOnly) {
            $extractedOk = $false
            if (Test-Path $backendArchiveGz) {
                Write-Log "Extracting backend node_modules.tar.gz..."
                Push-Location $backendDir
                try {
                    tar -xzf node_modules.tar.gz
                    if ((Test-Path $langchainCheck)) {
                        $extractedOk = $true
                        Write-Log "Backend dependencies extracted and verified from archive!" "SUCCESS"
                    }
                }
                catch {
                    Write-Log "Tar extraction failed: $_" "WARN"
                }
                finally {
                    Pop-Location
                }
            }
            elseif (Test-Path $backendArchiveTar) {
                Write-Log "Extracting backend node_modules.tar..."
                Push-Location $backendDir
                try {
                    tar -xf node_modules.tar
                    if ((Test-Path $langchainCheck)) {
                        $extractedOk = $true
                        Write-Log "Backend dependencies extracted and verified from archive!" "SUCCESS"
                    }
                }
                catch {
                    Write-Log "Tar extraction failed: $_" "WARN"
                }
                finally {
                    Pop-Location
                }
            }

            if (-not $extractedOk) {
                Write-Log "Installing backend production dependencies via npm..."
                Push-Location $backendDir
                try {
                    $npmBin = if (Get-Command npm -ErrorAction SilentlyContinue) { "npm" } else { "npm.cmd" }
                    if (Test-Path (Join-Path $backendDir "package-lock.json")) {
                        & $npmBin ci --omit=dev --no-audit --no-fund
                    }
                    else {
                        & $npmBin install --omit=dev --no-audit --no-fund
                    }
                    if ($LASTEXITCODE -ne 0) {
                        Write-Log "Backend dependency installation failed with npm exit code $LASTEXITCODE!" "ERROR"
                        $failedServices.Add("Backend Service Dependencies (npm exit code $LASTEXITCODE)")
                    }
                    else {
                        Write-Log "Backend dependencies installed successfully via npm!" "SUCCESS"
                    }
                }
                catch {
                    Write-Log "Failed to install backend dependencies via npm: $_" "ERROR"
                    $failedServices.Add("Backend Service Dependencies ($_)")
                }
                finally {
                    Pop-Location
                }
            }
        }
    }

    if (-not (Test-Path $langchainCheck)) {
        Write-Log "Backend node_modules is missing or incomplete!" "ERROR"
        $failedServices.Add("Backend Service Dependencies (node_modules)")
    }
    else {
        Write-Log "Backend dependencies verified!" "SUCCESS"

        # -------------------------------------------------------------------------
        # 6b. Install Playwright Chrome Browser using packaged node.exe
        # -------------------------------------------------------------------------
        Write-Log "Installing Playwright Chrome browser using packaged node..."
        $playwrightCli = Join-Path $backendNodeModules "playwright\cli.js"

        if (-not (Test-Path $playwrightCli)) {
            Write-Log "Playwright CLI was not found at: $playwrightCli" "ERROR"
            $failedServices.Add("Playwright CLI ($playwrightCli)")
        }
        else {
            if (-not $CheckOnly) {
                Write-Log "Installing Chrome browser via Playwright with packaged node ($resolvedNode)..."
                Push-Location $backendDir
                try {
                    & $resolvedNode "$playwrightCli" install chrome 2>&1 | ForEach-Object { Write-Log "[Playwright] $_" }
                    if ($LASTEXITCODE -ne 0) {
                        Write-Log "Playwright Chrome installation failed with exit code $LASTEXITCODE!" "ERROR"
                        $failedServices.Add("Playwright Chrome Browser Installation")
                    }
                    else {
                        Write-Log "Playwright Chrome browser installation completed successfully!" "SUCCESS"
                    }
                }
                finally {
                    Pop-Location
                }
            }
            else {
                Write-Log "Playwright CLI verified at: $playwrightCli" "SUCCESS"
            }
        }
    }
}

# -------------------------------------------------------------------------
# 7. Python Service Dependencies
# -------------------------------------------------------------------------
$serviceExecutable = Join-Path $InstallDir "resources\services\python-service\ai-insights-service.exe"
if (Test-Path $serviceExecutable) {
    Write-Log "Bundled Python service executable found at $serviceExecutable." "SUCCESS"
}
else {
    Write-Log "Required bundled Python service executable is missing: $serviceExecutable" "ERROR"
    $failedServices.Add("Bundled Python service executable")
}

# -------------------------------------------------------------------------
# 8. Final Failure Evaluation & Abort Protocol
# -------------------------------------------------------------------------
if ($failedServices.Count -gt 0) {
    Write-Log "==========================================================" "ERROR"
    Write-Log "  Installation Prerequisites Failed: Missing Dependencies " "ERROR"
    Write-Log "==========================================================" "ERROR"
    foreach ($item in $failedServices) {
        Write-Log "  [X] $item" "ERROR"
    }

    $bulletList = ($failedServices | ForEach-Object { "  * $_" }) -join "`r`n"
    $failMsg = @"
The installer could not automatically install or configure the following required services:

$bulletList

Please install and set up these services manually on your system:
- Node.js (v20+ LTS): https://nodejs.org/
- Docker Desktop: https://www.docker.com/ (Required for PostgreSQL & LiteLLM)

The installation will now abort.
"@

    $failFile = Join-Path $InstallDir "install-failure.txt"
    try {
        Set-Content -Path $failFile -Value $failMsg -Encoding UTF8 -Force
    }
    catch {
        try {
            Set-Content -Path (Join-Path $env:TEMP "compass-install-failure.txt") -Value $failMsg -Encoding UTF8 -Force
        }
        catch {}
    }

    if (-not $Silent) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.MessageBox]::Show($failMsg, "Compass Setup - Missing Dependencies", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
        }
        catch {}
    }

    exit 1
}

# Clean any previous failure record
$cleanFailFile = Join-Path $InstallDir "install-failure.txt"
if (Test-Path $cleanFailFile) {
    Remove-Item -Path $cleanFailFile -Force -ErrorAction SilentlyContinue
}

Write-Log "=========================================================="
Write-Log "  All Dependency Checks & Setup Routines Completed!       "
Write-Log "=========================================================="
exit 0
