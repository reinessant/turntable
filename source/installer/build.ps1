# Builds Turntable, embeds its NSIS setup into Turntable Setup, and puts the result in ..\release.
#   pwsh installer\build.ps1            (from the project root or anywhere)
#   pwsh installer\build.ps1 -SkipApp   (reuse the last app build)
param([switch]$SkipApp)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

if (-not $SkipApp) {
  Push-Location $root
  npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "app build failed" }
  Pop-Location
}
$version = (Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
$nsis = Get-ChildItem "$root\src-tauri\target\release\bundle\nsis" -Filter "Turntable_${version}_x64-setup.exe" | Select-Object -First 1
if (-not $nsis) { throw "NSIS setup for $version not found — build the app first" }
New-Item -ItemType Directory -Force "$PSScriptRoot\src-tauri\payload" | Out-Null
Copy-Item $nsis.FullName "$PSScriptRoot\src-tauri\payload\turntable-setup.exe" -Force

Push-Location $PSScriptRoot
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "setup build failed" }
Pop-Location

New-Item -ItemType Directory -Force "$root\release" | Out-Null
$out = "$root\release\Turntable-Setup-$version.exe"
Copy-Item "$PSScriptRoot\src-tauri\target\release\turntable-setup.exe" $out -Force
Write-Host "-> $out ($([math]::Round((Get-Item $out).Length / 1MB, 2)) MB)"
