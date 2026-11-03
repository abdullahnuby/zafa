$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$partsDir = Join-Path $scriptDir 'zaffa-mvp-parts'
$archive = Join-Path $scriptDir 'zaffa-mvp-0.1.0.tar.xz'
$expectedSha256 = 'f321b4f6d7f0770e118cd3f5183346087a6ce415bd59ac81bf17c1294aca53e9'

if (-not (Test-Path -LiteralPath $partsDir -PathType Container)) {
    throw "Missing archive parts directory: $partsDir"
}

$parts = @(Get-ChildItem -LiteralPath $partsDir -Filter 'part-*.b64' -File | Sort-Object Name)
if ($parts.Count -ne 9) {
    throw "Expected 9 archive parts; found $($parts.Count)"
}

$base64Text = ($parts | ForEach-Object { (Get-Content -LiteralPath $_.FullName -Raw).Trim() }) -join ''
$archiveBytes = [Convert]::FromBase64String($base64Text)
[System.IO.File]::WriteAllBytes($archive, $archiveBytes)

$actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "Archive SHA-256 mismatch. Expected $expectedSha256; got $actualSha256"
}

& tar -xJf $archive --strip-components=1 -C $root
if ($LASTEXITCODE -ne 0) {
    throw "tar extraction failed with exit code $LASTEXITCODE"
}

Write-Output 'ZAFFA 0.1.0 restored successfully.'
Write-Output 'Next: npm test; npm start'
