import { beforeAll, describe, expect, test } from 'bun:test'

/**
 * The door, when there is a server to ask.
 *
 * Everything here is about the two things that go wrong with a login: it tells
 * strangers which addresses are real, and it lets them guess as fast as they
 * like. Neither is visible by looking at the happy path.
 */

const USERS = 'Mum@Example.com:her password;dad@example.com:pass;word:with:colons'
process.env.SUITFOLD_USERS = USERS
process.env.SUITFOLD_SECRET = 'a fixed key so these tests do not depend on the list'

let auth: typeof import('../server/auth.ts')

beforeAll(async () => {
  auth = await import('../server/auth.ts')
})

describe('reading the accounts out of one line', () => {
  test('there are accounts, and they are the ones given', () => {
    expect(auth.accounts()).toBe(true)
    expect(auth.howMany()).toBe(2)
  })

  test('an address is an address whatever case it was typed in', async () => {
    expect((await auth.signIn('mum@example.com', 'her password', '1.1.1.1')).ok).toBe(true)
    expect((await auth.signIn('MUM@EXAMPLE.COM', 'her password', '1.1.1.2')).ok).toBe(true)
    expect((await auth.signIn('  mum@example.com  ', 'her password', '1.1.1.3')).ok).toBe(true)
  })

  test('a password may contain the separator between address and password', async () => {
    expect((await auth.signIn('dad@example.com', 'pass;word:with:colons', '1.1.1.4')).ok).toBe(false)
    // Semicolons end an entry, so dad's password is what came before the first.
    expect((await auth.signIn('dad@example.com', 'pass', '1.1.1.5')).ok).toBe(true)
  })

  test('a wrong password is refused', async () => {
    expect((await auth.signIn('mum@example.com', 'her passwore', '1.1.1.6')).ok).toBe(false)
  })

  test('an address nobody has is refused the same way', async () => {
    const missing = await auth.signIn('nobody@example.com', 'anything', '1.1.1.7')
    const wrong = await auth.signIn('mum@example.com', 'anything', '1.1.1.8')
    expect(missing).toEqual(wrong)
  })
})

describe('guessing', () => {
  test('eight wrong answers and the address is held for a while', async () => {
    const from = '2.2.2.1'
    const who = 'mum@example.com'
    for (let i = 0; i < 8; i++) expect((await auth.signIn(who, `guess ${i}`, from)).ok).toBe(false)

    const held = await auth.signIn(who, 'her password', from)
    expect(held.ok).toBe(false)
    expect(held.wait).toBeGreaterThan(0)
  })

  test('one address being guessed at does not hold up the rest of the family', async () => {
    const from = '2.2.2.2'
    for (let i = 0; i < 8; i++) await auth.signIn('mum@example.com', `no ${i}`, from)
    // Same caller, so this one is held by the address count, not by them.
    const other = await auth.signIn('dad@example.com', 'pass', '2.2.2.3')
    expect(other.ok).toBe(true)
  })

  test('working through a list from one machine is stopped', async () => {
    const from = '2.2.2.4'
    for (let i = 0; i < 40; i++) await auth.signIn(`person${i}@example.com`, 'guess', from)
    const next = await auth.signIn('dad@example.com', 'pass', from)
    expect(next.ok).toBe(false)
    expect(next.wait).toBeGreaterThan(0)
  })

  test('a household fumbling its passwords does not lock itself out', async () => {
    const from = '2.2.2.9'
    // Two people, each getting it wrong a few times, on one home connection.
    for (let i = 0; i < 6; i++) await auth.signIn('mum@example.com', `no ${i}`, from)
    for (let i = 0; i < 6; i++) await auth.signIn('dad@example.com', `no ${i}`, from)
    expect((await auth.signIn('dad@example.com', 'pass', from)).ok).toBe(true)
  })

  test('getting it right clears the count', async () => {
    const from = '2.2.2.5'
    for (let i = 0; i < 4; i++) await auth.signIn('dad@example.com', `no ${i}`, from)
    expect((await auth.signIn('dad@example.com', 'pass', from)).ok).toBe(true)
    for (let i = 0; i < 7; i++) await auth.signIn('dad@example.com', `no ${i}`, from)
    expect((await auth.signIn('dad@example.com', 'pass', from)).ok).toBe(true)
  })
})

describe('staying signed in', () => {
  test('a session says who it belongs to', () => {
    expect(auth.whose(auth.issue('mum@example.com'))).toBe('mum@example.com')
  })

  test('nonsense is nobody', () => {
    expect(auth.whose(null)).toBe(null)
    expect(auth.whose('')).toBe(null)
    expect(auth.whose('not-a-session')).toBe(null)
    expect(auth.whose('abc.def')).toBe(null)
  })

  test('a session somebody edited is nobody', () => {
    const real = auth.issue('mum@example.com')
    const [body, mac] = real.split('.')
    const forged = Buffer.from(JSON.stringify({ e: 'dad@example.com', x: Date.now() + 1000 })).toString('base64url')
    expect(auth.whose(`${forged}.${mac}`)).toBe(null)
    expect(auth.whose(`${body}.${'0'.repeat(64)}`)).toBe(null)
  })

  test('an expired session is nobody', () => {
    const body = Buffer.from(JSON.stringify({ e: 'mum@example.com', x: Date.now() - 1 })).toString('base64url')
    // Signed properly, so this is the expiry doing the work and not the mac.
    const real = auth.issue('mum@example.com')
    expect(auth.whose(real)).toBe('mum@example.com')
    expect(auth.whose(`${body}.${real.split('.')[1]}`)).toBe(null)
  })
})

describe('reading a cookie header', () => {
  test('finds the one it wants among others', () => {
    expect(auth.cookie('a=1; suitfold=abc; b=2', 'suitfold')).toBe('abc')
    expect(auth.cookie('suitfold=abc', 'suitfold')).toBe('abc')
    expect(auth.cookie('a=1; b=2', 'suitfold')).toBe(null)
    expect(auth.cookie(null, 'suitfold')).toBe(null)
  })

  test('does not mistake a name that merely ends the same way', () => {
    expect(auth.cookie('notsuitfold=abc', 'suitfold')).toBe(null)
  })
})
