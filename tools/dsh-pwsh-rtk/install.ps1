# Install dsh-pwsh-rtk into the DSH web profile.
#
#   1. back up cordis.patch.yml and package.json (timestamped)
#   2. copy this package into <profile>/node_modules as a real directory
#      (a `link:` elsewhere makes @deepseek-ai/* resolve from the link's real
#      path, which fails)
#   3. mount the two patch rows, replacing the profile's empty `[]` array rather
#      than appending after it — `[]` followed by a sequence is invalid YAML and
#      would stop dsh from booting
#   4. parse the result with the profile's own `yaml` package before returning
#
# Run from this directory. Restart `dsh web` afterwards.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\web'
$patch = Join-Path $profileDir 'cordis.patch.yml'
$pkgJson = Join-Path $profileDir 'package.json'
$target = Join-Path $profileDir 'node_modules\dsh-pwsh-rtk'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $patch)) { throw "profil introuvable : $patch" }

# 1. backups
Copy-Item $patch "$patch.bak-$stamp" -Force
Copy-Item $pkgJson "$pkgJson.bak-$stamp" -Force
Write-Host "sauvegardes : $patch.bak-$stamp"

# 2. copy the package into the profile
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $here 'package.json') $target -Force
Copy-Item (Join-Path $here 'lib') $target -Recurse -Force
Copy-Item (Join-Path $here 'README.md') $target -Force
Write-Host "paquet copie : $target"

# 3. patch rows (idempotent)
$current = Get-Content $patch -Raw
if ($current -match 'pwsh-rtk') {
  Write-Host 'cordis.patch.yml contient deja pwsh-rtk — patch inchange'
} else {
  $block = @(
    ''
    '# dsh-pwsh-rtk — route eligible PowerShell commands through rtk'
    '- id: pwsh-sandbox'
    '  disabled: true'
    ''
    '- insert:'
    '    - id: pwsh-rtk'
    "      name: 'dsh-pwsh-rtk'"
  ) -join "`n"
  if ($current -match '(?m)^\[\]\s*$') {
    $updated = [regex]::Replace($current, '(?m)^\[\]\s*$', $block.TrimStart("`n"))
  } else {
    $updated = $current.TrimEnd() + "`n" + $block
  }
  Set-Content -Path $patch -Value $updated -Encoding utf8
  Write-Host "lignes de patch montees dans $patch"
}

# 4. validate the YAML with the profile's own parser before anyone restarts
Push-Location $profileDir
try {
  node --input-type=module -e @"
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
const doc = parse(readFileSync('cordis.patch.yml', 'utf8'))
if (!Array.isArray(doc)) { console.error('ECHEC : le patch n est pas un tableau YAML'); process.exit(1) }
const ids = doc.flatMap((e) => (e && typeof e === 'object' && 'id' in e ? [e.id] : [])).concat(doc.flatMap((e) => (e && e.insert ? e.insert.map((i) => i.id) : [])))
console.log('patch YAML valide | entrees :', JSON.stringify(doc))
if (!ids.includes('pwsh-rtk')) { console.error('ECHEC : la ligne pwsh-rtk est absente'); process.exit(1) }
"@
  if ($LASTEXITCODE -ne 0) {
    Copy-Item "$patch.bak-$stamp" $patch -Force
    throw "parse YAML en echec — cordis.patch.yml restaure depuis la sauvegarde"
  }

  Write-Host 'Verification de resolution du module :'
  node --input-type=module -e "import('dsh-pwsh-rtk').then(m => console.log('  exports :', Object.keys(m).join(', '))).catch(e => { console.log('  ECHEC :', e.message); process.exit(1) })"
  if ($LASTEXITCODE -ne 0) { throw 'le module ne se charge pas — restaure la sauvegarde avant de redemarrer' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Redemarre dsh web pour activer le plugin.'
Write-Host "Retour arriere : pwsh -File .\uninstall.ps1  (sauvegarde : $patch.bak-$stamp)"
