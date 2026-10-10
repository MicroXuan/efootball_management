[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$TaskName = "EFM WeChat Bridge")

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "WINDOWS_REQUIRED" }

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Task) {
    Write-Host "Task '$TaskName' is not registered."
    exit 0
}
if ($PSCmdlet.ShouldProcess($TaskName, "Unregister scheduled task")) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Write-Host "Unregistered '$TaskName'. Local state was preserved."

