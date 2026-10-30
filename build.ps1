<#
.SYNOPSIS
  Builds and packages the SBOM Tool extension, mirroring the `build` job in
  .github/workflows/tfx-extension.yml exactly, so it can be run identically from CI or locally.

.DESCRIPTION
  1. Removes any previous build output (`dist/`), so repeated local runs don't leave older-versioned
     `.vsix` files sitting alongside the new ones.
  2. Computes the version with GitVersion (installing GitVersion.Tool if it isn't already
     available), matching the `gitversion/setup` + `gitversion/execute` steps in CI.
  3. Stamps `{MajorMinorPatch}.{BuildNumber}` into every `vss-extension.overrides.*.json`,
     replacing their `#{MAJOR_MINOR_PATCH}#`/`#{BUILD_NUMBER}#` placeholders (matches the
     `cschleiden/replace-tokens` step in CI).
  4. Stamps `Major`/`Minor`/`BuildNumber` into `task/task.json`'s own version block (matches the
     `jq` step in CI).
  5. Runs `npm install`, `npm run build`, `npm test`, `npm run package:dev`, `npm run package:prod`
     -- identical to the remaining steps of the CI `build` job.

  Steps 3 and 4 mutate tracked source files in place (`task/task.json`, the override files) --
  this is intentional and matches what the CI job already does in its own (throwaway) checkout.
  Don't commit those mutations unless you actually mean to permanently bump the checked-in
  version; `git checkout -- task/task.json vss-extension.overrides.*.json` reverts them.

.PARAMETER BuildNumber
  The 4th version component (Major.Minor.Patch.BuildNumber) and the task's Patch number. In CI
  this is `github.run_number`. Locally, defaults to a date-based 9-digit number (YMMDDHHmm) --
  the same convention `vss-extension.version.increment.js` already uses elsewhere in this repo --
  so repeated local builds always get a strictly increasing number without any bookkeeping.

.PARAMETER SkipTests
  Skip `npm test`. Off by default, to match CI.

.EXAMPLE
  ./build.ps1
  Local build with an auto-generated, always-increasing build number.

.EXAMPLE
  ./build.ps1 -BuildNumber $env:GITHUB_RUN_NUMBER
  What CI runs.
#>
[CmdletBinding()]
param(
  [int]$BuildNumber = [int]([DateTime]::UtcNow.ToString('yyyyMMddHHmm').Substring(3)),
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSCommandPath
Set-Location $repoRoot

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(ValueFromRemainingArguments)][string[]]$CommandArgs
  )
  Write-Host "> $Command $($CommandArgs -join ' ')" -ForegroundColor Cyan
  & $Command @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command $($CommandArgs -join ' ')"
  }
}

# --- 1. Remove previous build output ------------------------------------------------------------
$distPath = Join-Path $repoRoot 'dist'
if (Test-Path $distPath) {
  Write-Host 'Removing previous build output (dist/)...' -ForegroundColor Cyan
  Remove-Item -Path $distPath -Recurse -Force
}

# --- 2. Ensure GitVersion is available ---------------------------------------------------------
if (-not (Get-Command dotnet-gitversion -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'The .NET SDK (dotnet) is required to install GitVersion.Tool, but was not found on PATH.'
  }
  Write-Host 'Installing GitVersion.Tool...' -ForegroundColor Yellow
  Invoke-Checked dotnet tool install --global GitVersion.Tool
  $dotnetToolsPath = Join-Path $HOME '.dotnet/tools'
  if ($env:PATH -notlike "*$dotnetToolsPath*") {
    $env:PATH = "$env:PATH$([System.IO.Path]::PathSeparator)$dotnetToolsPath"
  }
}

# --- 3. Compute the version with GitVersion ------------------------------------------------------
Write-Host 'Determining version with GitVersion...' -ForegroundColor Cyan
$gitVersion = dotnet-gitversion | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "dotnet-gitversion failed with exit code $LASTEXITCODE"
}
$majorMinorPatch = $gitVersion.MajorMinorPatch
$major = $gitVersion.Major
$minor = $gitVersion.Minor
Write-Host "MajorMinorPatch: $majorMinorPatch   BuildNumber: $BuildNumber   (full: $majorMinorPatch.$BuildNumber)" -ForegroundColor Green

# --- 4. Stamp the version into vss-extension.overrides.*.json (token replacement) ---------------
Get-ChildItem -Path $repoRoot -Filter 'vss-extension.overrides.*.json' | ForEach-Object {
  Write-Host "Updating $($_.Name)..." -ForegroundColor Cyan
  $content = Get-Content -Raw -Path $_.FullName
  $content = $content -replace '#\{MAJOR_MINOR_PATCH\}#', $majorMinorPatch
  $content = $content -replace '#\{BUILD_NUMBER\}#', $BuildNumber
  Set-Content -Path $_.FullName -Value $content -NoNewline
}

# --- 5. Stamp the version into task/task.json ----------------------------------------------------
$taskJsonPath = Join-Path $repoRoot 'task/task.json'
Write-Host "Updating task/task.json version to $major.$minor.$BuildNumber..." -ForegroundColor Cyan
$taskJson = Get-Content -Raw -Path $taskJsonPath | ConvertFrom-Json
$taskJson.version.Major = $major
$taskJson.version.Minor = $minor
$taskJson.version.Patch = $BuildNumber
($taskJson | ConvertTo-Json -Depth 20) | Set-Content -Path $taskJsonPath -NoNewline

# --- 6. Install, build, test ----------------------------------------------------------------------
Invoke-Checked npm install
Invoke-Checked npm run build
if (-not $SkipTests) {
  Invoke-Checked npm test
}

# --- 7. Package dev + prod -------------------------------------------------------------------------
Invoke-Checked npm run package:dev
Invoke-Checked npm run package:prod

Write-Host "`nDone. Packages:" -ForegroundColor Green
Get-ChildItem -Path (Join-Path $repoRoot 'dist') -Recurse -Filter '*.vsix' | ForEach-Object {
  Write-Host "  $($_.FullName)"
}
