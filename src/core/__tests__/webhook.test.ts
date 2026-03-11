import { describe, it, expect } from 'vitest'
import { verifyWebhook, parseWebhookPayload } from '../webhook'

// ─── Helper: sign a payload the same way the server would ────────────────────

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hex}`
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verifyWebhook', () => {
  const secret = 'whsec_test_secret_123'
  const payload = JSON.stringify({
    event: 'deposit.completed',
    sessionId: 'sess_123',
    status: 'completed',
    depositAddress: '0xdead',
    txHash: '0xabc',
    timestamp: '2026-01-01T00:00:00Z',
  })

  it('returns true for valid signature', async () => {
    const signature = await signPayload(payload, secret)
    const result = await verifyWebhook(payload, signature, secret)
    expect(result).toBe(true)
  })

  it('returns false for invalid signature', async () => {
    const result = await verifyWebhook(payload, 'sha256=deadbeef00000000000000000000000000000000000000000000000000000000', secret)
    expect(result).toBe(false)
  })

  it('returns false for null signature', async () => {
    const result = await verifyWebhook(payload, null, secret)
    expect(result).toBe(false)
  })

  it('returns false for undefined signature', async () => {
    const result = await verifyWebhook(payload, undefined, secret)
    expect(result).toBe(false)
  })

  it('returns false for empty string signature', async () => {
    const result = await verifyWebhook(payload, '', secret)
    expect(result).toBe(false)
  })

  it('returns false when signature is missing sha256= prefix', async () => {
    const signature = await signPayload(payload, secret)
    const hexOnly = signature.replace('sha256=', '')
    const result = await verifyWebhook(payload, hexOnly, secret)
    expect(result).toBe(false)
  })

  it('returns false when payload is modified', async () => {
    const signature = await signPayload(payload, secret)
    const modifiedPayload = payload.replace('sess_123', 'sess_456')
    const result = await verifyWebhook(modifiedPayload, signature, secret)
    expect(result).toBe(false)
  })

  it('returns false when using wrong secret', async () => {
    const signature = await signPayload(payload, secret)
    const result = await verifyWebhook(payload, signature, 'whsec_wrong_secret')
    expect(result).toBe(false)
  })

  it('returns false for length mismatch in hex', async () => {
    const result = await verifyWebhook(payload, 'sha256=deadbeef', secret)
    expect(result).toBe(false)
  })

  it('handles empty payload', async () => {
    const emptyPayload = ''
    const signature = await signPayload(emptyPayload, secret)
    const result = await verifyWebhook(emptyPayload, signature, secret)
    expect(result).toBe(true)
  })

  it('handles special characters in payload', async () => {
    const specialPayload = '{"emoji":"🔥","quote":"it\'s \\"done\\""}'
    const signature = await signPayload(specialPayload, secret)
    const result = await verifyWebhook(specialPayload, signature, secret)
    expect(result).toBe(true)
  })
})

describe('parseWebhookPayload', () => {
  it('parses valid webhook payload', () => {
    const raw = JSON.stringify({
      event: 'deposit.completed',
      sessionId: 'sess_123',
      status: 'completed',
      depositAddress: '0xdead',
      txHash: '0xabc',
      timestamp: '2026-01-01T00:00:00Z',
    })

    const result = parseWebhookPayload(raw)
    expect(result.event).toBe('deposit.completed')
    expect(result.sessionId).toBe('sess_123')
    expect(result.status).toBe('completed')
    expect(result.txHash).toBe('0xabc')
  })

  it('parses payload with optional fields missing', () => {
    const raw = JSON.stringify({
      event: 'deposit.expired',
      sessionId: 'sess_456',
      status: 'expired',
      depositAddress: '0xbeef',
      timestamp: '2026-01-01T00:00:00Z',
    })

    const result = parseWebhookPayload(raw)
    expect(result.event).toBe('deposit.expired')
    expect(result.txHash).toBeUndefined()
    expect(result.outputAmount).toBeUndefined()
  })

  it('throws on invalid JSON', () => {
    expect(() => parseWebhookPayload('not json')).toThrow()
  })
})
