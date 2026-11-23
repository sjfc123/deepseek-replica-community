param(
    [Parameter(Mandatory)]
    [string]$Device,

    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [ValidateRange(0, 1079)]
    [int]$StartX = 100,

    [ValidateRange(0, 2339)]
    [int]$Y = 820,

    [int[]]$Offsets = @(100, 300, 550, 800, 120),

    [ValidateRange(200, 5000)]
    [int]$PauseMs = 250
)

$ErrorActionPreference = 'Stop'
$adb = if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe' } else { 'adb' }
$size = & $adb -s $Device shell wm size
if ($LASTEXITCODE -ne 0 -or $size.Trim() -ne 'Physical size: 1080x2340') {
    throw 'This touch path uses the 1080x2340 reference profile.'
}
if (!$Offsets.Count -or $Offsets.Where({ ($StartX + $_) -lt 0 -or ($StartX + $_) -gt 1079 }).Count) {
    throw 'Each touch position must be inside the reference display.'
}

$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$remote = '/data/local/tmp/deepseek-pauses-' + [Guid]::NewGuid().ToString('N')
$pause = ([double]$PauseMs / 1000).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
$names = for ($index = 0; $index -lt $Offsets.Count; $index++) {
    '{0:d2}-offset-{1}.png' -f ($index + 1), $Offsets[$index]
}
$commands = @('set -e', "mkdir $remote", "input motionevent DOWN $StartX $Y", "sleep 0.1")
for ($index = 0; $index -lt $Offsets.Count; $index++) {
    $commands += "input motionevent MOVE $($StartX + $Offsets[$index]) $Y"
    $commands += "sleep $pause"
    $commands += "screencap -p $remote/$($names[$index])"
}
$lastX = $StartX + $Offsets[-1]
$commands += "input motionevent UP $lastX $Y"
$commands += 'sleep 0.45'
$commands += "screencap -p $remote/settled.png"
$names = @($names) + 'settled.png'

try {
    & $adb -s $Device shell ("su -c '" + ($commands -join '; ') + "'")
    if ($LASTEXITCODE -ne 0) { throw 'Could not replay the touch path.' }
    foreach ($file in $names) {
        & $adb -s $Device pull "$remote/$file" (Join-Path $OutputDirectory $file)
        if ($LASTEXITCODE -ne 0) { throw "Could not pull $file." }
    }
} finally {
    $cleanup = @("input motionevent UP $lastX $Y")
    $cleanup += $names | ForEach-Object { "rm -f $remote/$_" }
    $cleanup += "rmdir $remote"
    & $adb -s $Device shell ("su -c '" + ($cleanup -join '; ') + "'") | Out-Null
}
