[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Config,
    [string]$TaskName = "EFM WeChat Bridge",
    [switch]$EnableSend,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$BridgeRoot = Split-Path -Parent $PSScriptRoot
$RunScript = Join-Path $PSScriptRoot "run.ps1"
if (-not $Config) { $Config = Join-Path $BridgeRoot "bridge.toml" }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "WINDOWS_REQUIRED" }
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw "CONFIG_NOT_FOUND" }
if (-not $env:EFM_WECHAT_BRIDGE_TOKEN -or $env:EFM_WECHAT_BRIDGE_TOKEN.Length -lt 32) { throw "TOKEN_MISSING" }
if ($ValidateOnly) {
    Write-Host "Task validation passed. Logon type will be Interactive; Session 0 is not supported."
    exit 0
}

$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`" -Config `"$Config`""
if ($EnableSend) { $Arguments += " -EnableSend" }
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Arguments -WorkingDirectory $BridgeRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

if ($PSCmdlet.ShouldProcess($TaskName, "Register interactive-at-logon scheduled task")) {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
}
Write-Host "Registered '$TaskName' for the current logged-on user only."

