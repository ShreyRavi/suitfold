import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The door, as far as it can be tested away from a browser.
 *
 * The point is not to prove the lock is strong. It is not, and src/net/lock.ts
 * says so at length. The point is that the phrase never gets committed, that
 * the hash never gets committed either, and that guessing is slowed down.
 *
 * Note that this file does not contain the phrase. An earlier version did, in
 * a test asserting the phrase was nowhere in the source, which is exactly the
 * mistake it was written to catch.
 */

const sha = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sources = () => {
  const walk = (dir: string): string[] => {
    try {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    } catch {
      return []
    }
  }
  return [...walk('src'), ...walk('server'), ...walk('tests'), ...walk('.github')].filter((f) =>
    /\.(ts|tsx|css|yml)$/.test(f),
  )
}

describe('what the door is built on', () => {
  test('a hash gives nothing away by looking', async () => {
    const hash = await sha('any phrase at all')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('phrase')
  })

  test('the same phrase always opens it, or nobody could get in', async () => {
    expect(await sha('a phrase')).toBe(await sha('a phrase'))
  })

  test('and nothing else does, including a change of case or a stray space', async () => {
    const right = await sha('A Phrase!!')
    for (const wrong of ['a phrase!!', 'A Phrase!', 'A Phrase', ' A Phrase!!', 'A Phrasf!!']) {
      expect(await sha(wrong)).not.toBe(right)
    }
  })
})

describe('nothing secret is committed', () => {
  test('no source file holds a phrase, if one was given to check for', async () => {
    // Set SUITFOLD_PHRASE when running this to check a specific one. Unset,
    // the test still runs and still means something: it proves the check
    // works rather than silently passing.
    // Built from pieces when none is given, so the placeholder itself is not
    // a literal in this file. The first version of this test failed on its
    // own placeholder, which is the same mistake in miniature.
    const phrase = process.env.SUITFOLD_PHRASE ?? ['nowhere', 'in', 'here'].join('-')
    for (const file of sources()) {
      const text = readFileSync(file, 'utf8')
      expect(text.includes(phrase), `${file} has the phrase in it`).toBe(false)
    }
  })

  test('no source file holds a bare hash either, since the repository is public', () => {
    // A committed sha256 of a short phrase is a phrase, given a word list and
    // about a second. It belongs in a repository secret, not in a file.
    for (const file of sources()) {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        // Ignore the lines that talk about hashes rather than containing one.
        if (/^\s*[*/#]/.test(line)) continue
        const found = line.match(/\b[0-9a-f]{64}\b/)
        expect(found?.[0], `${file} looks like it has a hash in it: ${found?.[0]}`).toBeUndefined()
      }
    }
  })

  test('the lock reads its hash from the build, not from a constant', () => {
    const lock = readFileSync('src/net/lock.ts', 'utf8')
    expect(lock).toContain('import.meta.env.VITE_LOCK')
  })

  test('and the workflow feeds it from a secret', () => {
    const flow = readFileSync('.github/workflows/pages.yml', 'utf8')
    expect(flow).toContain('secrets.SUITFOLD_LOCK')
  })
})

describe('slowing somebody down', () => {
  /** The same sliding window the door uses, on its own. */
  const window = (tries: number[], now: number, allowed = 6, within = 5 * 60 * 1000) => {
    const recent = tries.filter((at) => now - at < within)
    if (recent.length < allowed) return 0
    return Math.max(0, Math.ceil((within - (now - Math.min(...recent))) / 1000))
  }

  test('a few wrong goes are fine, because people mistype', () => {
    const now = 1_000_000
    expect(window([now, now, now], now)).toBe(0)
  })

  test('too many and it makes you wait', () => {
    const now = 1_000_000
    expect(window(Array.from({ length: 6 }, () => now), now)).toBeGreaterThan(0)
  })

  test('the wait runs out rather than lasting forever', () => {
    const now = 1_000_000
    const six = Array.from({ length: 6 }, () => now)
    expect(window(six, now + 5 * 60 * 1000 + 1)).toBe(0)
  })
})

describe('nothing shares a storage key with anything else', () => {
  test('every localStorage key in the client is owned by one file', () => {
    const owners = new Map<string, string[]>()
    for (const file of sources()) {
      if (!file.startsWith('src/')) continue
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // Prose about a key is not a use of it.
        if (/^\s*[*/]/.test(line)) continue
        for (const m of line.matchAll(/['"`](suitfold\.[a-z-]+)['"`]/g)) {
          const key = m[1]!
          owners.set(key, [...(owners.get(key) ?? []), file])
        }
      }
    }
    for (const [key, files] of owners) {
      const distinct = [...new Set(files)]
      // Two files writing different shapes to one key is how "the table is
      // held over there" started returning an entire serialised table.
      expect(distinct.length, `${key} is written from ${distinct.join(' and ')}`).toBe(1)
    }
  })
})
