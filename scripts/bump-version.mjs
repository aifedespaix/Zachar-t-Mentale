#!/usr/bin/env node
// Bumps the app version in package.json AND src-tauri/tauri.conf.json together
// — the release workflow (.github/workflows/release.yml) tags off
// tauri.conf.json's version via tauri-action's `tagName: v__VERSION__`, so the
// two files must never drift apart.
//
// Usage: npm run version:bump -- <patch|minor|major|X.Y.Z>

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv[2]

if (!arg) {
  console.error('Usage: npm run version:bump -- <patch|minor|major|X.Y.Z>')
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, data) {
  // Trailing newline to match the repo's existing file style.
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

const packageJsonPath = join(root, 'package.json')
const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json')

const current = readJson(packageJsonPath).version

function nextVersion(current, arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg
  const [major, minor, patch] = current.split('.').map(Number)
  if (arg === 'patch') return `${major}.${minor}.${patch + 1}`
  if (arg === 'minor') return `${major}.${minor + 1}.0`
  if (arg === 'major') return `${major + 1}.0.0`
  console.error(`Unrecognised bump "${arg}" — expected patch, minor, major, or an explicit X.Y.Z.`)
  process.exit(1)
}

const next = nextVersion(current, arg)

const packageJson = readJson(packageJsonPath)
packageJson.version = next
writeJson(packageJsonPath, packageJson)

const tauriConf = readJson(tauriConfPath)
tauriConf.version = next
writeJson(tauriConfPath, tauriConf)

console.log(`${current} -> ${next} (package.json, src-tauri/tauri.conf.json)`)
console.log('Next: commit, push, then `git tag vX.Y.Z && git push origin vX.Y.Z` to trigger the release build.')
