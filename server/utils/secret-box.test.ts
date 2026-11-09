import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnv: () => ({ BETTER_AUTH_SECRET: 'x'.repeat(40) }) }))

let box: typeof import('./secret-box')
beforeAll(async () => {
  box = await import('./secret-box')
})

describe('secret-box', () => {
  it('cifra y descifra', () => {
    const sealed = box.sealSecret('sk-prueba-123456')
    expect(sealed).not.toContain('sk-prueba')
    expect(box.openSecret(sealed)).toBe('sk-prueba-123456')
  })

  it('usa un IV distinto cada vez', () => {
    expect(box.sealSecret('a')).not.toBe(box.sealSecret('a'))
  })

  it('devuelve null si el texto cifrado se altera', () => {
    const [v, iv, tag, ct] = box.sealSecret('secreto').split('.')
    const tampered = [v, iv, tag, `${ct!.slice(0, -2)}AA`].join('.')
    expect(box.openSecret(tampered)).toBeNull()
    expect(box.openSecret('basura')).toBeNull()
  })
})

describe('secret-box — etiqueta', () => {
  it('rechaza etiquetas truncadas', async () => {
    const box = await import('./secret-box')
    const [v, iv, tag, ct] = box.sealSecret('secreto').split('.')
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url')
    expect(box.openSecret([v, iv, short, ct].join('.'))).toBeNull()
  })
})
