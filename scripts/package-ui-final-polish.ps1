param([Parameter(Mandatory=$true)][string]$BaselinePath, [string]$ProjectRoot=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectPath=(Resolve-Path -LiteralPath $ProjectRoot).Path
$rootPrefix=$projectPath.TrimEnd('\')+'\'
$baseline=@{}
Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json | ForEach-Object { $baseline[$_.path]=$_.hash }
function Get-Records {
  @(Get-ChildItem -LiteralPath $projectPath -Recurse -File | ForEach-Object {
    if (-not $_.FullName.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'File escaped project' }
    $relative=$_.FullName.Substring($rootPrefix.Length).Replace('\','/')
    if ($relative -notmatch '(^|/)(\.git|node_modules|\.dist-stage-[^/]+)(/|$)' -and $_.Extension -ne '.zip') {
      [PSCustomObject]@{Relative=$relative; FullName=$_.FullName; Hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; Length=$_.Length}
    }
  } | Sort-Object Relative)
}
function Changed($record) { (-not $baseline.ContainsKey($record.Relative)) -or $baseline[$record.Relative] -ne $record.Hash }
$records=Get-Records
$changed=@($records | Where-Object { Changed $_ })
$frozen=@($changed | Where-Object { $_.Relative -match '^src/(core|adapters|controls|semantics|mappings)/|^src/storage/(indexeddb|material-library|resume-store)\.js$' })
if ($frozen.Count) { throw ('Frozen Core changed: '+($frozen.Relative -join ', ')) }
foreach ($required in @('JOBFILL_UI_FINAL_POLISH_REPORT.md','JOBFILL_UI_INFORMATION_ARCHITECTURE_REPORT.md','JOBFILL_UI_ACCESSIBILITY_REPORT.md','JOBFILL_UI_VISUAL_REGRESSION_REPORT.md','JOBFILL_UI_TEST_RESULT.txt','JOBFILL_UI_BUILD_RESULT.txt','dist/manifest.json','ui-review/popup-ready.png','ui-review/floating-task.png','ui-review/options-1440.png')) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectPath $required) -PathType Leaf)) { throw "Missing delivery artifact: $required" }
}
$changedNames=@($changed.Relative)+@('JOBFILL_UI_CHANGED_FILES.txt') | Sort-Object -Unique
[IO.File]::WriteAllLines((Join-Path $projectPath 'JOBFILL_UI_CHANGED_FILES.txt'),$changedNames,[Text.UTF8Encoding]::new($false))
$records=Get-Records
$changed=@($records | Where-Object { Changed $_ })
function Write-VerifiedZip([string]$name,[object[]]$entries) {
  $target=Join-Path $projectPath $name
  if (([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target))) -ne $projectPath) { throw 'Invalid ZIP target' }
  $file=[IO.File]::Open($target,[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    $zip=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$false)
    try {
      foreach ($record in $entries) {
        if ($record.Relative -match '(^|/)\.\.(/|$)|^/|^[A-Za-z]:') { throw 'Unsafe entry path' }
        $entry=$zip.CreateEntry($record.Relative,[IO.Compression.CompressionLevel]::Optimal)
        $input=[IO.File]::OpenRead($record.FullName)
        $output=$entry.Open()
        try {$input.CopyTo($output)} finally {$output.Dispose();$input.Dispose()}
      }
    } finally {$zip.Dispose()}
  } finally {$file.Dispose()}
  $archive=[IO.Compression.ZipFile]::OpenRead($target)
  try {
    if ($archive.Entries.Count -ne $entries.Count) { throw 'ZIP entry count mismatch' }
    $expected=@{};foreach($record in $entries){$expected[$record.Relative]=$record.Hash}
    $seen=@{}
    foreach($entry in $archive.Entries){
      if($seen.ContainsKey($entry.FullName)){throw 'Duplicate ZIP entry'}
      $seen[$entry.FullName]=$true
      $stream=$entry.Open();$hash=[Security.Cryptography.SHA256]::Create()
      try{$actual=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','')}finally{$hash.Dispose();$stream.Dispose()}
      if($actual -ne $expected[$entry.FullName]){throw "ZIP content mismatch: $($entry.FullName)"}
    }
  } finally {$archive.Dispose()}
  Write-Output "$name : $($entries.Count) files, verified SHA-256, $((Get-Item -LiteralPath $target).Length) bytes"
}
Write-VerifiedZip 'JobFill_ui_final_polish_replace.zip' $changed
Write-VerifiedZip 'JobFill_ui_final_polish_complete.zip' $records
Write-Output 'Frozen Core unchanged; source baseline diff and both archive contents verified.'
