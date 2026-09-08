// Spike « contenus riches » — vérifie ce que le pipeline d'export réel
// (html-to-image `toPng`, mêmes options que src/export/captureElement.ts)
// fait subir à KaTeX, à abcjs et à une image selon son origine.
//
// Usage : voir README.md (dépendances à installer avant).
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, normalize, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..') // racine du dépôt
const REL = 'docs/superpowers/spikes/2026-09-08-contenus-riches'
const OUT = join(HERE, 'resultats')

const CHROMIUM = process.env.SPIKE_CHROMIUM // sinon, le Chromium de Playwright
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.map': 'application/json',
}

const schema = await readFile(join(HERE, 'schema.png'))

/** Sert le dépôt ; `cors` ajoute l'en-tête sur /schema.png (variante testée). */
function serve({ cors }) {
  return createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (url === '/schema.png') {
      const headers = { 'content-type': 'image/png' }
      if (cors) headers['access-control-allow-origin'] = '*'
      res.writeHead(200, headers)
      return res.end(schema)
    }
    try {
      const p = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''))
      const body = await readFile(p)
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
}

// Deux origines distinctes : celle de la page, et celle qui joue le rôle du
// protocole `asset:` de Tauri (`convertFileSrc()`).
const app = serve({ cors: false })
const assetNoCors = serve({ cors: false })
const assetCors = serve({ cors: true })
for (const s of [app, assetNoCors, assetCors]) await new Promise(r => s.listen(0, r))
const port = s => s.address().port

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
const report = {}

// ── Spike 1 : KaTeX survit-il au foreignObject ? ────────────────────────────
await page.goto(`http://127.0.0.1:${port(app)}/${REL}/page-katex.html`, { waitUntil: 'networkidle' })
report.katex = await page.evaluate(() => window.runSpike())

// ── Spikes 2 à 4 : abcjs, images, coût des polices ─────────────────────────
await page.goto(`http://127.0.0.1:${port(app)}/${REL}/page-blocs.html`, { waitUntil: 'networkidle' })

const music = await page.evaluate(() => window.mountMusic())
await writeFile(join(OUT, 'abcjs-capture-toPng.png'), Buffer.from(music.png.split(',')[1], 'base64'))
report.abcjs = { paths: music.paths, texts: music.texts, textFonts: music.textFonts }

report.image = {}
for (const [nom, url] of [
  ['memeOrigine', '/schema.png'],
  ['autreOrigineSansCors', `http://127.0.0.1:${port(assetNoCors)}/schema.png`],
  ['autreOrigineAvecCors', `http://127.0.0.1:${port(assetCors)}/schema.png`],
]) {
  const r = await page.evaluate(u => window.mountImage(u), url)
  report.image[nom] = {
    imageAfficheeDansLeDom: r.imgState === 'load',
    captureReussie: r.cold !== null,
    erreur: r.error,
  }
}

report.coutPolices = await page.evaluate(() => window.fontCost())

console.log(JSON.stringify(report, null, 2))
await browser.close()
for (const s of [app, assetNoCors, assetCors]) s.close()
