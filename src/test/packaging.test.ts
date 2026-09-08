import { describe, expect, it } from 'vitest'

import tauriConfig from '../../src-tauri/tauri.conf.json'
import { windowTitleFor } from '../persistence/windowTitle'

/**
 * `productName` is substituted verbatim into NSIS shortcut paths, and several
 * of Tauri's installer macros wrap those paths in a single-quoted COM argument
 * list — e.g. `${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READ})'`. A
 * straight ASCII apostrophe closes that string early, so makensis miscounts the
 * macro arguments and the whole bundle step aborts:
 *
 *   !insertmacro: macro "NSISCOMCALL" requires 4 parameter(s), passed 7!
 *
 * That is exactly what killed the v0.1.0 release: the app compiled, the
 * installer never got built, and the tag ended up with nothing but GitHub's
 * automatic source archives. The typographic apostrophe (U+2019) reads the
 * same, is the correct French one, and is not an NSIS string delimiter.
 */
describe('packaging', () => {
  it('keeps the ASCII apostrophe out of productName so makensis can bundle', () => {
    expect(tauriConfig.productName).not.toContain("'")
  })

  it('spells the app name the same way in the installer and in the app itself', () => {
    expect(windowTitleFor(null)).toBe(tauriConfig.productName)
    expect(tauriConfig.app.windows[0].title).toBe(tauriConfig.productName)
  })
})
