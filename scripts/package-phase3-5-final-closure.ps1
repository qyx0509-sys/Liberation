param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$expectedVersion = '3.0.3'
$expectedRuntimeRevision = 'jiefang-page-runtime-v2'
$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$baselinePath = Join-Path $projectPath 'JobFill_phase3_5_runtime_closure_complete.zip'
$completePath = Join-Path $projectPath 'JobFill_phase3_5_final_closure_complete.zip'
$replacePath = Join-Path $projectPath 'JobFill_phase3_5_final_closure_replace.zip'

$requiredFinalReports = @(
  'PHASE3_5_FINAL_CLOSURE_REPORT.md',
  'PHASE3_5_REAL_DOM_SINGLETON_REPORT.md',
  'PHASE3_5_REPEATABLE_ACTION_BOUNDARY_REPORT.md',
  'PHASE3_5_LEGACY_ANT_DATE_SAFETY_REPORT.md',
  'PHASE3_5_CASCADER_FINAL_REPORT.md',
  'PHASE3_5_ANNOTATED_LABEL_GPA_REPORT.md',
  'PHASE3_5_STABLE_SCAN_FINAL_REPORT.md',
  'PHASE3_5_FINAL_TEST_RESULT.txt',
  'PHASE3_5_FINAL_BUILD_RESULT.txt',
  'PHASE3_5_FINAL_CHANGED_FILES.txt'
)

$supersededReports = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
@(
  'PHASE3_5_CASCADER_RUNTIME_REPORT.md',
  'PHASE3_5_GPA_COVERAGE_REPORT.md',
  'PHASE3_5_LEGACY_ANT_RUNTIME_REPORT.md',
  'PHASE3_5_REPEATABLE_ACTION_RUNTIME_REPORT.md',
  'PHASE3_5_RUNTIME_CLOSURE_BUILD_RESULT.txt',
  'PHASE3_5_RUNTIME_CLOSURE_CHANGED_FILES.txt',
  'PHASE3_5_RUNTIME_CLOSURE_TEST_RESULT.txt',
  'PHASE3_5_RUNTIME_PATCH_PRESENCE_AUDIT.md',
  'PHASE3_5_SEMANTIC_COLLECTION_BINDING_REPORT.md'
) | ForEach-Object { [void]$supersededReports.Add($_) }

function Convert-ToArchivePath([string]$fullPath) {
  $rootPrefix = $projectPath.TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside project root: $fullPath"
  }
  return $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
}

function Test-Excluded([string]$relativePath) {
  if ($relativePath -match '(^|/)(\.git|node_modules|\.phase3_5_baseline_audit)(/|$)') { return $true }
  if ($relativePath -match '(^|/)(\.dist-stage-[^/]+|\.phase3_5[^/]*stage[^/]*|\.package-stage-[^/]+|\.zip-stage-[^/]+)(/|$)') { return $true }
  if ([System.IO.Path]::GetExtension($relativePath) -ieq '.zip') { return $true }
  return $supersededReports.Contains($relativePath)
}

function Assert-SafeArchivePath([string]$name, [string]$archiveLabel) {
  if ([string]::IsNullOrWhiteSpace($name)) { throw "Empty archive path in $archiveLabel" }
  if ($name.Contains('\') -or $name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or $name -match '^[A-Za-z]:') {
    throw "Unsafe archive path in $archiveLabel`: $name"
  }
  if ([System.IO.Path]::GetExtension($name) -ieq '.zip') {
    throw "Nested ZIP is forbidden in $archiveLabel`: $name"
  }
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
      if ([string]::IsNullOrEmpty($entry.Name)) { throw "Directory entry is forbidden in baseline: $($entry.FullName)" }
      Assert-SafeArchivePath $entry.FullName 'baseline'
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
  foreach ($record in $records) {
    if ($expected.ContainsKey($record.Relative)) { throw "Duplicate expected archive path: $($record.Relative)" }
    $expected.Add($record.Relative, $record)
  }

  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    if ($archive.Entries.Count -ne $records.Count) {
      throw "Archive entry count mismatch for $path"
    }
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName
      if ([string]::IsNullOrEmpty($entry.Name)) { throw "Directory entry is forbidden: $name" }
      Assert-SafeArchivePath $name $path
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

  foreach ($record in $records) {
    if (-not $seen.Contains($record.Relative)) { throw "Archive is missing expected entry: $($record.Relative)" }
  }
}

function Read-JsonObject([string]$relativePath) {
  $path = Join-Path $projectPath $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing JSON file: $relativePath" }
  try {
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    throw "Invalid JSON in $relativePath`: $($_.Exception.Message)"
  }
}

function Assert-ManifestContract([object]$manifest, [string]$label) {
  if ([int]$manifest.manifest_version -ne 3) { throw "$label must use Manifest V3" }
  if ([string]$manifest.version -ne $expectedVersion) { throw "$label version must be $expectedVersion" }
  if ([string]$manifest.background.service_worker -ne 'background.js') { throw "$label service worker mismatch" }
  if ([string]$manifest.action.default_popup -ne 'popup.html') { throw "$label popup entry mismatch" }
  if ([string]$manifest.options_page -ne 'options.html') { throw "$label options entry mismatch" }
}

function Get-InjectionFiles([string]$source, [string]$label) {
  $block = [regex]::Match(
    $source,
    'const\s+INJECTION_FILES\s*=\s*Object\.freeze\(\s*\[(.*?)\]\s*\);',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $block.Success) { throw "Unable to parse INJECTION_FILES in $label" }
  $files = @(
    [regex]::Matches($block.Groups[1].Value, '([''"])([^''"\r\n]+\.js)\1') |
      ForEach-Object { $_.Groups[2].Value }
  )
  if ($files.Count -eq 0) { throw "INJECTION_FILES is empty in $label" }
  return $files
}

function Assert-InjectionOrder([string[]]$files, [string]$dependency, [string]$consumer) {
  $dependencyIndex = [array]::IndexOf($files, $dependency)
  $consumerIndex = [array]::IndexOf($files, $consumer)
  if ($dependencyIndex -lt 0) { throw "Missing browser dependency: $dependency" }
  if ($consumerIndex -lt 0) { throw "Missing browser consumer: $consumer" }
  if ($dependencyIndex -ge $consumerIndex) { throw "$dependency must load before $consumer" }
}

function Assert-RuntimeRevision([string]$popupText, [string]$controllerText, [string]$label) {
  $popupContract = [regex]::Match(
    $popupText,
    'const\s+PAGE_RUNTIME_CONTRACT\s*=\s*Object\.freeze\(\s*\{(.*?)\}\s*\);',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $popupContract.Success) { throw "Unable to parse PAGE_RUNTIME_CONTRACT in $label popup" }
  $escapedRevision = [regex]::Escape($expectedRuntimeRevision)
  $popupRevisionPattern = ('revision\s*:\s*[''"]{0}[''"]' -f $escapedRevision)
  $controllerRevisionPattern = ('const\s+RUNTIME_REVISION\s*=\s*[''"]{0}[''"]' -f $escapedRevision)
  if ($popupContract.Groups[1].Value -notmatch $popupRevisionPattern) {
    throw "$label popup runtime revision must be $expectedRuntimeRevision"
  }
  if ($controllerText -notmatch $controllerRevisionPattern) {
    throw "$label content controller runtime revision must be $expectedRuntimeRevision"
  }
}

if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) {
  throw "Missing frozen baseline: $baselinePath"
}

foreach ($report in $requiredFinalReports) {
  $reportPath = Join-Path $projectPath $report
  if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { throw "Missing required final report: $report" }
  if ((Get-Item -LiteralPath $reportPath).Length -le 0) { throw "Required final report is empty: $report" }
}

$packageJson = Read-JsonObject 'package.json'
$rootManifest = Read-JsonObject 'manifest.json'
$distManifest = Read-JsonObject 'dist/manifest.json'
if ([string]$packageJson.version -ne $expectedVersion) { throw "package.json version must be $expectedVersion" }
Assert-ManifestContract $rootManifest 'root manifest'
Assert-ManifestContract $distManifest 'dist manifest'

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
  Assert-SafeArchivePath $record.Relative 'source tree'
  if ($recordMap.ContainsKey($record.Relative)) { throw "Duplicate source path: $($record.Relative)" }
  $recordMap.Add($record.Relative, $record)
}

foreach ($report in $requiredFinalReports) {
  if (-not $recordMap.ContainsKey($report)) { throw "Required final report was excluded from package: $report" }
}

$baseline = Read-BaselineMap $baselinePath
$unexpectedBaselineOnly = @(
  foreach ($name in $baseline.Keys) {
    if (-not $recordMap.ContainsKey($name) -and -not $supersededReports.Contains($name)) { $name }
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
if ($replaceRecords.Count -eq 0) { throw 'Final closure replace package would be empty' }

$distRecords = @($records | Where-Object { $_.Relative.StartsWith('dist/', [System.StringComparison]::Ordinal) })
if ($distRecords.Count -eq 0) { throw 'dist package is empty or missing' }
foreach ($distRecord in $distRecords) {
  $sourceRelative = $distRecord.Relative.Substring(5)
  if (-not $recordMap.ContainsKey($sourceRelative)) { throw "dist has no source counterpart: $($distRecord.Relative)" }
  $sourceRecord = $recordMap[$sourceRelative]
  if ($sourceRecord.Length -ne $distRecord.Length -or $sourceRecord.Hash -ne $distRecord.Hash) {
    throw "src/root to dist mismatch: $sourceRelative"
  }
}

$manifestResources = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
@(
  [string]$rootManifest.background.service_worker,
  [string]$rootManifest.action.default_popup,
  [string]$rootManifest.options_page
) + @($rootManifest.icons.PSObject.Properties.Value) + @($rootManifest.action.default_icon.PSObject.Properties.Value) |
  Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
  ForEach-Object { [void]$manifestResources.Add([string]$_) }
$contentScriptsProperty = $rootManifest.PSObject.Properties['content_scripts']
if ($null -ne $contentScriptsProperty) {
  foreach ($entry in @($contentScriptsProperty.Value)) {
    if ($null -eq $entry) { continue }
    $scriptProperty = $entry.PSObject.Properties['js']
    $styleProperty = $entry.PSObject.Properties['css']
    $contentResources = @()
    if ($null -ne $scriptProperty) { $contentResources += @($scriptProperty.Value) }
    if ($null -ne $styleProperty) { $contentResources += @($styleProperty.Value) }
    foreach ($resource in $contentResources) {
      if (-not [string]::IsNullOrWhiteSpace([string]$resource)) { [void]$manifestResources.Add([string]$resource) }
    }
  }
}
foreach ($resource in $manifestResources) {
  if ($resource -match '[*?{}]') { continue }
  if (-not $recordMap.ContainsKey($resource)) { throw "Missing manifest resource: $resource" }
  if (-not $recordMap.ContainsKey("dist/$resource")) { throw "Missing dist manifest resource: $resource" }
}

$popupText = Get-Content -LiteralPath (Join-Path $projectPath 'popup.js') -Raw
$controllerText = Get-Content -LiteralPath (Join-Path $projectPath 'src/content-controller.js') -Raw
$distPopupText = Get-Content -LiteralPath (Join-Path $projectPath 'dist/popup.js') -Raw
$distControllerText = Get-Content -LiteralPath (Join-Path $projectPath 'dist/src/content-controller.js') -Raw
Assert-RuntimeRevision $popupText $controllerText 'source'
Assert-RuntimeRevision $distPopupText $distControllerText 'dist'

$injectionFiles = @(Get-InjectionFiles $popupText 'source popup')
$distInjectionFiles = @(Get-InjectionFiles $distPopupText 'dist popup')
if ($injectionFiles.Count -ne $distInjectionFiles.Count) { throw 'Source/dist injection list length mismatch' }
for ($index = 0; $index -lt $injectionFiles.Count; $index += 1) {
  if ($injectionFiles[$index] -cne $distInjectionFiles[$index]) {
    throw "Source/dist injection order mismatch at index $index"
  }
}

$uniqueInjection = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($file in $injectionFiles) {
  if (-not $uniqueInjection.Add($file)) { throw "Duplicate popup injection: $file" }
  if (-not $recordMap.ContainsKey($file)) { throw "Missing popup injection source: $file" }
  if (-not $recordMap.ContainsKey("dist/$file")) { throw "Missing popup injection dist file: $file" }
}

$requiredInjectionOrder = @(
  @('src/mappings/field-aliases.js', 'src/core/field-matcher.js'),
  @('src/semantics/field-semantic-normalizer.js', 'src/core/field-matcher.js'),
  @('src/core/safety.js', 'src/controls/adapters/cascader-adapter.js'),
  @('src/core/event-dispatcher.js', 'src/controls/adapters/date-like-adapter.js'),
  @('src/core/verification-engine.js', 'src/controls/adapters/cascader-adapter.js'),
  @('src/controls/control-adapter-registry.js', 'src/controls/adapters/date-like-adapter.js'),
  @('src/adapters/generic.js', 'src/core/array-handler.js'),
  @('src/core/array-handler.js', 'src/core/autofill-engine.js'),
  @('src/core/autofill-engine.js', 'src/content-controller.js'),
  @('src/content-app.js', 'src/content-controller.js'),
  @('src/content-controller.js', 'content.js')
)
foreach ($relationship in $requiredInjectionOrder) {
  Assert-InjectionOrder $injectionFiles $relationship[0] $relationship[1]
}

if (-not $recordMap.ContainsKey('manifest.json') -or -not $recordMap.ContainsKey('dist/manifest.json')) {
  throw 'Complete package must contain root and dist manifests'
}
if (-not $recordMap.ContainsKey('package.json')) { throw 'Complete package must contain package.json' }

Write-VerifiedZip $completePath $records
Write-VerifiedZip $replacePath $replaceRecords
Assert-ZipMatches $completePath $records
Assert-ZipMatches $replacePath $replaceRecords

$completeInfo = Get-Item -LiteralPath $completePath
$replaceInfo = Get-Item -LiteralPath $replacePath
$baselineHash = (Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash
$completeHash = (Get-FileHash -LiteralPath $completePath -Algorithm SHA256).Hash
$replaceHash = (Get-FileHash -LiteralPath $replacePath -Algorithm SHA256).Hash

Write-Output "PACKAGE_VERSION=$expectedVersion"
Write-Output "ROOT_MANIFEST_VERSION=$($rootManifest.version)"
Write-Output "DIST_MANIFEST_VERSION=$($distManifest.version)"
Write-Output "RUNTIME_REVISION=$expectedRuntimeRevision"
Write-Output "REQUIRED_FINAL_REPORT_COUNT=$($requiredFinalReports.Count)"
Write-Output "BASELINE_ENTRY_COUNT=$($baseline.Count)"
Write-Output "BASELINE_SHA256=$baselineHash"
Write-Output "COMPLETE_ENTRY_COUNT=$($records.Count)"
Write-Output "REPLACE_ENTRY_COUNT=$($replaceRecords.Count)"
Write-Output "ADDED_COUNT=$($added.Count)"
Write-Output "MODIFIED_COUNT=$($modified.Count)"
Write-Output "UNCHANGED_COUNT=$($unchanged.Count)"
Write-Output "SUPERSEDED_REPORT_COUNT=$($supersededReports.Count)"
Write-Output "SRC_DIST_PARITY_COUNT=$($distRecords.Count)"
Write-Output "MANIFEST_RESOURCE_COUNT=$($manifestResources.Count)"
Write-Output "INJECTION_FILE_COUNT=$($injectionFiles.Count)"
Write-Output "INJECTION_ORDER_RELATIONSHIP_COUNT=$($requiredInjectionOrder.Count)"
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
