# Uninstall dsh-pwsh-rtk: remove the patch block and the copied package, leaving
# a valid YAML array behind so the profile still boots.
#
# The block is removed by regex from its marker comment through the
# `name: 'dsh-pwsh-rtk'` line; if nothing but comments remains, the array is
# restored to `[]`.

$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\web'
$patch = Join-Path $profileDir 'cordis.patch.yml'
$target = Join-Path $profileDir 'node_modules\dsh-pwsh-rtk'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (Test-Path $patch) {
  $current = Get-Content $patch -Raw
  Copy-Item $patch "$patch.bak-$stamp" -Force
  $stripped = [regex]::Replace($current, "(?ms)^[ \t]*#\s*dsh-pwsh-rtk.*?^[ \t]*name:[ \t]*'dsh-pwsh-rtk'[ \t]*\r?\n?", '')
  $stripped = $stripped.TrimEnd() + "`n"
  if ($stripped -notmatch '(?m)^\s*-\s') { $stripped = $stripped.TrimEnd() + "`n`n[]`n" }
  Set-Content -Path $patch -Value $stripped -Encoding utf8
  Write-Host "bloc retire de $patch (sauvegarde : $patch.bak-$stamp)"

  Push-Location $profileDir
  try {
    node --input-type=module -e "import { readFileSync } from 'node:fs'; import { parse } from 'yaml'; const doc = parse(readFileSync('cordis.patch.yml','utf8')); console.log('patch YAML valide :', JSON.stringify(doc)); if (!Array.isArray(doc)) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { Copy-Item "$patch.bak-$stamp" $patch -Force; throw 'parse YAML en echec — fichier restaure' }
  } finally {
    Pop-Location
  }
}

if (Test-Path $target) {
  Remove-Item $target -Recurse -Force
  Write-Host "paquet supprime : $target"
}

Write-Host 'Redemarre dsh web pour revenir a l executeur pwsh standard.'
