# Developer helper: starts the app with extra Chromium switches and reports memory/CPU, first as a calm notch, then while she is busy (open + agent working).
#   powershell -File scripts\flagtest.ps1 "--in-process-gpu" "--enable-low-end-device-mode"
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Flags)
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 3
$root = Split-Path $PSScriptRoot
$args2 = @(".", "--remote-debugging-port=9223") + @($Flags | Where-Object { $_ })
Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList $args2 -WorkingDirectory $root
Start-Sleep 14
node "$PSScriptRoot\ping.js" Stop | Out-Null
node "$PSScriptRoot\cdp.js" "vortex._mode('notch');'n'" | Out-Null
Start-Sleep 6
node "$PSScriptRoot\ping.js" Stop | Out-Null
Start-Sleep 8
"== flags: $($Flags -join ' ') =="
"-- calm notch --"
powershell -NoProfile -File "$PSScriptRoot\perf.ps1" 15 | Select-String 'TOTAL'
node "$PSScriptRoot\cdp.js" "vortex._mode('open');'o'" | Out-Null
node "$PSScriptRoot\ping.js" UserPromptSubmit | Out-Null
Start-Sleep 4
"-- open, agent working (full speed) --"
powershell -NoProfile -File "$PSScriptRoot\perf.ps1" 15 | Select-String 'TOTAL'
node "$PSScriptRoot\ping.js" Stop | Out-Null
