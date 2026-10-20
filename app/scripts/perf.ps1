# Measures the app's memory and CPU over a few seconds (developer helper).  powershell -File scripts\perf.ps1 [seconds]
param([int]$Seconds = 15)
function Snap {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
    $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'main' }
    $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if ($p) { [pscustomobject]@{ Id = $_.ProcessId; Type = $t; MB = [int]($p.WorkingSet64 / 1MB); Priv = [int]($p.PrivateMemorySize64 / 1MB); Cpu = $p.CPU } }
  }
}
$a = Snap; Start-Sleep $Seconds; $b = Snap
$tot = 0; $cpu = 0
foreach ($x in $b) { $y = $a | Where-Object Id -eq $x.Id; $d = if ($y) { ($x.Cpu - $y.Cpu) / $Seconds * 100 } else { 0 }; $cpu += $d; $tot += $x.Priv
  '{0,-12} {1,5} MB ws  {2,5} MB private  {3,5:N1}% of one core' -f $x.Type, $x.MB, $x.Priv, $d }
'TOTAL private {0} MB, CPU {1:N1}% of one core (over {2}s)' -f $tot, $cpu, $Seconds
