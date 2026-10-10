[CmdletBinding()]
param(
    [string]$Config,
    [switch]$EnableSend
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$BridgeRoot = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $BridgeRoot "bridge.toml" }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "WINDOWS_REQUIRED" }
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw "CONFIG_NOT_FOUND" }
if (-not $env:EFM_WECHAT_BRIDGE_TOKEN -or $env:EFM_WECHAT_BRIDGE_TOKEN.Length -lt 32) { throw "TOKEN_MISSING" }
if (-not (Get-Command uv.exe -ErrorAction SilentlyContinue)) { throw "UV_NOT_FOUND" }

$Mode = "--dry-send"
if ($EnableSend) { $Mode = "--enable-send" }
& uv.exe run --project $BridgeRoot efm-wechat-bridge --config $Config run $Mode
exit $LASTEXITCODE

