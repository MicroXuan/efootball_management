[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Config,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$BridgeRoot = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $BridgeRoot "bridge.toml" }

function Assert-WindowsHost {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "WINDOWS_REQUIRED: Bridge installation only supports Windows 10/11."
    }
}

function Assert-BridgePrerequisites {
    if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
        throw "CONFIG_NOT_FOUND: $Config"
    }
    $resolvedConfig = (Resolve-Path -LiteralPath $Config).Path
    if ($resolvedConfig -match '[\\/]\.git[\\/]' -or [IO.Path]::GetFileName($resolvedConfig) -eq '.env') {
        throw "UNSAFE_CONFIG_PATH: use bridge.toml outside .git and .env files."
    }
    $content = Get-Content -LiteralPath $resolvedConfig -Raw
    if ($content -match '(?im)^\s*(token|bridge_token|efm_wechat_bridge_token)\s*=') {
        throw "TOKEN_IN_CONFIG: remove credentials and use EFM_WECHAT_BRIDGE_TOKEN."
    }
    if (-not $env:EFM_WECHAT_BRIDGE_TOKEN -or $env:EFM_WECHAT_BRIDGE_TOKEN.Length -lt 32) {
        throw "TOKEN_MISSING: set EFM_WECHAT_BRIDGE_TOKEN in the dedicated Windows user environment."
    }
    if (-not (Get-Command py.exe -ErrorAction SilentlyContinue)) {
        throw "PYTHON_LAUNCHER_NOT_FOUND: install 64-bit Python 3.12."
    }
    & py.exe -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12); assert sys.maxsize > 2**32"
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_312_REQUIRED: install 64-bit Python 3.12." }
    if (-not (Get-Command uv.exe -ErrorAction SilentlyContinue)) {
        throw "UV_NOT_FOUND: install uv, then rerun this script."
    }
}

Assert-WindowsHost
Assert-BridgePrerequisites
if ($ValidateOnly) {
    Write-Host "Validation passed; no files or tasks changed."
    exit 0
}

if ($PSCmdlet.ShouldProcess($BridgeRoot, "Create locked Bridge virtual environment")) {
    & uv.exe sync --project $BridgeRoot --python 3.12 --extra windows --frozen
    if ($LASTEXITCODE -ne 0) { throw "DEPENDENCY_INSTALL_FAILED" }
    & uv.exe run --project $BridgeRoot efm-wechat-bridge --config $Config doctor
    if ($LASTEXITCODE -ne 0) { throw "DOCTOR_FAILED" }
}

Write-Host "Bridge installed and doctor passed. Sending remains disabled until run.ps1 -EnableSend is used."

