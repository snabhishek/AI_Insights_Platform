<#
.SYNOPSIS
    Root Desktop Builder for AI Insights Platform.
.DESCRIPTION
    Automates building the webapp, compiling the backend, bundling internal services,
    and generating the Tauri desktop application and installer.
.PARAMETER Dev
    Runs the desktop application in development mode with live reload.
.PARAMETER CheckDeps
    Runs dependency diagnostics.
.PARAMETER SetupDeps
    Runs automated dependency installation and configuration.
#>

param (
    [switch]$Dev,
    [switch]$CheckDeps,
    [switch]$SetupDeps
)

$desktopDir = Join-Path $PSScriptRoot "src\ai-insights-desktop"

if ($CheckDeps) {
    powershell -ExecutionPolicy Bypass -File (Join-Path $desktopDir "scripts\setup-deps.ps1") -CheckOnly
    exit $LASTEXITCODE
}

if ($SetupDeps) {
    powershell -ExecutionPolicy Bypass -File (Join-Path $desktopDir "scripts\setup-deps.ps1")
    exit $LASTEXITCODE
}

if ($Dev) {
    Write-Host "[Desktop] Starting Tauri dev server..." -ForegroundColor Cyan
    Set-Location $desktopDir
    npx @tauri-apps/cli dev
    exit $LASTEXITCODE
}

Write-Host "[Desktop] Starting full desktop build and installer packaging..." -ForegroundColor Cyan
Set-Location $desktopDir
node scripts\build.mjs
exit $LASTEXITCODE
