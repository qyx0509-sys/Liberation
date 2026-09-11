param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$baselinePath = Join-Path $projectPath 'JobFill_phase3_5_completion_complete.zip'
$completePath = Join-Path $projectPath 'JobFill_phase3_5_runtime_closure_complete.zip'
$replacePath = Join-Path $projectPath 'JobFill_phase3_5_runtime_closure_replace.zip'

$legacyReports = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
@(
  'PHASE3_5_AUTHOR_RANK_VOCABULARY_REPORT.md',
  'PHASE3_5_CASCADER_LEVEL_TRANSITION_REPORT.md',
  'PHASE3_5_COMPLETION_BUILD_RESULT.txt',
  'PHASE3_5_COMPLETION_CHANGED_FILES.txt',
  'PHASE3_5_COMPLETION_MATRIX_REPORT.md',
  'PHASE3_5_COMPLETION_TEST_RESULT.txt',
  'PHASE3_5_EDUCATION_SCHEMA_COVERAGE_REPORT.md',
  'PHASE3_5_LEGACY_ANT_DATE_REPORT.md',
  'PHASE3_5_REPEATABLE_ACTION_OWNERSHIP_REPORT.md',
  'PHASE3_5_SINGLETON_ARRAY_BINDING_REPORT.md',
  'PHASE3_5_STABLE_SCAN_TELEMETRY_REPORT.md'
) | ForEach-Object { [void]$legacyReports.Add($_) }

function Convert-ToArchivePath([string]$fullPath) {
  $rootPrefix = $projectPath.TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside project root: $fullPath"
  }
  return $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
}

function Test-Excluded([string]$relativePath) {
  if ($relativePath -match '(^|/)(\.git|node_modules|\.dist-stage-[^/]+)(/|$)') { return $true }
  if ([System.IO.Path]::GetExtension($relativePath) -ieq '.zip') { return $true }
  return $legacyReports.Contains($relativePath)
}

function Get-StreamSha256([System.IO.Stream]$stream) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
}

function Get-FileRecord([System.IO.FileInfo]$file) {
  $relative = Convert-ToArchivePath $file.FullName
  return [pscustomobject]@{
    Relative = $relative
    FullName = $file.FullName
    Length = $file.Length
    Hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  }
}

function Read-BaselineMap([string]$path) {
  $map = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    foreach ($entry in $archive.Entries) {
      if ([string]::IsNullOrEmpty($entry.Name)) { continue }
      if ($map.ContainsKey($entry.FullName)) {
        throw "Baseline contains a duplicate entry: $($entry.FullName)"
      }
      $stream = $entry.Open()
      try {
        $hash = Get-StreamSha256 $stream
      } finally {
        $stream.Dispose()
      }
      $map.Add($entry.FullName, [pscustomobject]@{
        Length = $entry.Length
        Hash = $hash
      })
    }
  } finally {
    $archive.Dispose()
  }
  return $map
}

function Write-VerifiedZip([string]$path, [object[]]$records) {
  $fileStream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  try {
    $archive = [System.IO.Compression.ZipArchive]::new($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      foreach ($record in $records) {
        $entry = $archive.CreateEntry($record.Relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
        $input = [System.IO.File]::OpenRead($record.FullName)
        $output = $entry.Open()
        try {
          $input.CopyTo($output)
        } finally {
          $output.Dispose()
          $input.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $fileStream.Dispose()
  }
}

function Assert-ZipMatches([string]$path, [object[]]$records) {
  $expected = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
  foreach ($record in $records) { $expected.Add($record.Relative, $record) }

  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    if ($archive.Entries.Count -ne $records.Count) {
      throw "Archive entry count mismatch for $path"
    }
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName
      if ([string]::IsNullOrEmpty($entry.Name)) { throw "Directory entry is forbidden: $name" }
      if ($name.Contains('\') -or $name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)') {
        throw "Unsafe archive path: $name"
      }
      if ([System.IO.Path]::GetExtension($name) -ieq '.zip') { throw "Nested ZIP is forbidden: $name" }
      if (-not $seen.Add($name)) { throw "Duplicate archive entry: $name" }
      if (-not $expected.ContainsKey($name)) { throw "Unexpected archive entry: $name" }
      $stream = $entry.Open()
      try {
        $hash = Get-StreamSha256 $stream
      } finally {
        $stream.Dispose()
      }
      if ($entry.Length -ne $expected[$name].Length -or $hash -ne $expected[$name].Hash) {
        throw "Archive content mismatch: $name"
      }
    }
  } finally {
    $archive.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) {
  throw "Missing frozen baseline: $baselinePath"
}

$records = @(
  Get-ChildItem -LiteralPath $projectPath -File -Recurse -Force |
    ForEach-Object {
      $relative = Convert-ToArchivePath $_.FullName
      if (-not (Test-Excluded $relative)) { Get-FileRecord $_ }
    } |
    Sort-Object -Property Relative
)

$recordMap = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
foreach ($record in $records) {
  if ($recordMap.ContainsKey($record.Relative)) { throw "Duplicate source path: $($record.Relative)" }
  $recordMap.Add($record.Relative, $record)
}

$baseline = Read-BaselineMap $baselinePath
$unexpectedBaselineOnly = @(
  foreach ($name in $baseline.Keys) {
    if (-not $recordMap.ContainsKey($name) -and -not $legacyReports.Contains($name)) { $name }
  }
)
if ($unexpectedBaselineOnly.Count -gt 0) {
  throw "Unexpected files missing from current complete package: $($unexpectedBaselineOnly -join ', ')"
}

$added = @($records | Where-Object { -not $baseline.ContainsKey($_.Relative) })
$modified = @($records | Where-Object {
  $baseline.ContainsKey($_.Relative) -and (
    $baseline[$_.Relative].Length -ne $_.Length -or $baseline[$_.Relative].Hash -ne $_.Hash
  )
})
$unchanged = @($records | Where-Object {
  $baseline.ContainsKey($_.Relative) -and
  $baseline[$_.Relative].Length -eq $_.Length -and
  $baseline[$_.Relative].Hash -eq $_.Hash
})
$replaceRecords = @($added + $modified | Sort-Object -Property Relative)

$distRecords = @($records | Where-Object { $_.Relative.StartsWith('dist/', [System.StringComparison]::Ordinal) })
foreach ($distRecord in $distRecords) {
  $sourceRelative = $distRecord.Relative.Substring(5)
  if (-not $recordMap.ContainsKey($sourceRelative)) { throw "dist has no source counterpart: $($distRecord.Relative)" }
  $sourceRecord = $recordMap[$sourceRelative]
  if ($sourceRecord.Length -ne $distRecord.Length -or $sourceRecord.Hash -ne $distRecord.Hash) {
    throw "src/root to dist mismatch: $sourceRelative"
  }
}

$popupText = Get-Content -LiteralPath (Join-Path $projectPath 'popup.js') -Raw
$injectionBlock = [regex]::Match($popupText, 'const INJECTION_FILES\s*=\s*Object\.freeze\(\[(.*?)\]\);', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $injectionBlock.Success) { throw 'Unable to parse popup INJECTION_FILES' }
$injectionFiles = @([regex]::Matches($injectionBlock.Groups[1].Value, "'([^']+)'" ) | ForEach-Object { $_.Groups[1].Value })
$uniqueInjection = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($file in $injectionFiles) {
  if (-not $uniqueInjection.Add($file)) { throw "Duplicate popup injection: $file" }
  if (-not $recordMap.ContainsKey($file)) { throw "Missing popup injection source: $file" }
  if (-not $recordMap.ContainsKey("dist/$file")) { throw "Missing popup injection dist file: $file" }
}
$requiredOrder = @(
  'src/core/field-matcher.js',
  'src/controls/adapters/cascader-adapter.js',
  'src/controls/adapters/date-like-adapter.js',
  'src/core/array-handler.js',
  'src/core/autofill-engine.js',
  'src/content-controller.js'
)
$previousIndex = -1
foreach ($file in $requiredOrder) {
  $index = [array]::IndexOf($injectionFiles, $file)
  if ($index -le $previousIndex) { throw "Popup dependency order mismatch at $file" }
  $previousIndex = $index
}

if (-not $recordMap.ContainsKey('manifest.json') -or -not $recordMap.ContainsKey('dist/manifest.json')) {
  throw 'Complete package must contain root and dist manifests'
}

Write-VerifiedZip $completePath $records
Write-VerifiedZip $replacePath $replaceRecords
Assert-ZipMatches $completePath $records
Assert-ZipMatches $replacePath $replaceRecords

$completeInfo = Get-Item -LiteralPath $completePath
$replaceInfo = Get-Item -LiteralPath $replacePath
$completeHash = (Get-FileHash -LiteralPath $completePath -Algorithm SHA256).Hash
$replaceHash = (Get-FileHash -LiteralPath $replacePath -Algorithm SHA256).Hash

Write-Output "BASELINE_ENTRY_COUNT=$($baseline.Count)"
Write-Output "COMPLETE_ENTRY_COUNT=$($records.Count)"
Write-Output "REPLACE_ENTRY_COUNT=$($replaceRecords.Count)"
Write-Output "ADDED_COUNT=$($added.Count)"
Write-Output "MODIFIED_COUNT=$($modified.Count)"
Write-Output "UNCHANGED_COUNT=$($unchanged.Count)"
Write-Output "SUPERSEDED_REPORT_COUNT=$($legacyReports.Count)"
Write-Output "SRC_DIST_PARITY_COUNT=$($distRecords.Count)"
Write-Output "INJECTION_FILE_COUNT=$($injectionFiles.Count)"
Write-Output "COMPLETE_SIZE=$($completeInfo.Length)"
Write-Output "COMPLETE_SHA256=$completeHash"
Write-Output "REPLACE_SIZE=$($replaceInfo.Length)"
Write-Output "REPLACE_SHA256=$replaceHash"
Write-Output 'ADDED_BEGIN'
$added.Relative | ForEach-Object { Write-Output $_ }
Write-Output 'ADDED_END'
Write-Output 'MODIFIED_BEGIN'
$modified.Relative | ForEach-Object { Write-Output $_ }
Write-Output 'MODIFIED_END'
