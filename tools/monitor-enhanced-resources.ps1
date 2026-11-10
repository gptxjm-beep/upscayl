# Read-only Windows acceptance helper. Run separately from performance benchmarks.
param([int]$DurationSeconds=600,[int]$IntervalSeconds=1,[string]$OutputCsv='upscayl-resources.csv')
$ErrorActionPreference='Stop'
if($DurationSeconds -lt 1 -or $IntervalSeconds -lt 1){throw 'Duration and interval must be positive.'}
$endAt=(Get-Date).AddSeconds($DurationSeconds)
$observed=@{}
while((Get-Date) -lt $endAt){
    $engines=@(Get-Process -Name 'upscayl-jm' -ErrorAction SilentlyContinue)
    foreach($engine in $engines){$observed[$engine.Id]=$true}
    $counterState='available';$counters=@()
    try{$counters=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction Stop)}
    catch{$counterState='unavailable: '+$_.Exception.Message}
    if($observed.Count -eq 0){
        [pscustomobject]@{Utc=(Get-Date).ToUniversalTime().ToString('o');EnginePid='';EnginePresent=$false;CpuSeconds='';WorkingSetBytes='';GpuCounterState=$counterState;GpuCountersJson='[]'} | Export-Csv -Path $OutputCsv -Append -NoTypeInformation -Encoding UTF8
    }
    foreach($enginePid in @($observed.Keys)){
        $engine=$engines | Where-Object Id -eq $enginePid | Select-Object -First 1
        $rows=@($counters | Where-Object {$_.Name -like "pid_${enginePid}_*"} | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted)
        $state=$counterState
        if($state -eq 'available' -and $rows.Count -eq 0){$state='no matching GPU counter; not a zero-memory measurement'}
        [pscustomobject]@{Utc=(Get-Date).ToUniversalTime().ToString('o');EnginePid=$enginePid;EnginePresent=[bool]$engine;CpuSeconds=$(if($engine){$engine.CPU}else{''});WorkingSetBytes=$(if($engine){$engine.WorkingSet64}else{''});GpuCounterState=$state;GpuCountersJson=(ConvertTo-Json -InputObject $rows -Compress)} | Export-Csv -Path $OutputCsv -Append -NoTypeInformation -Encoding UTF8
    }
    Start-Sleep -Seconds $IntervalSeconds
}
Write-Host "Saved observations to $OutputCsv. Missing WDDM counters do not prove zero VRAM use."
