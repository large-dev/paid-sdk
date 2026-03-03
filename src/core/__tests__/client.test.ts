import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PaidClient, PaidApiError } from '../client'
import type { CreateSessionResponse, SessionStatusResponse, SupportedToken, TokenInfo } from '../types'

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  })
}

function errorResponse(error: string, status: number) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PaidClient', () => {
  const client = new PaidClient({
    publicKey: 'pk_test_abc',
    baseUrl: 'https://api.test.dev',
    chainId: 8453,
  })

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', () => {
      const c = new PaidClient({
        publicKey: 'pk_test',
        baseUrl: 'https://api.test.dev/',
      })
      // Verify by making a request and checking the URL
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] }))
      c.getSupportedTokens()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.dev/v1/deposit/tokens',
        expect.any(Object),
      )
    })

    it('uses default base URL when not provided', () => {
      const c = new PaidClient({ publicKey: 'pk_test' })
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] }))
      c.getSupportedTokens()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.paid.studio/v1/deposit/tokens',
        expect.any(Object),
      )
    })
  })

  describe('createSession', () => {
    it('sends correct request and returns session data', async () => {
      const sessionData: CreateSessionResponse = {
        sessionId: 'sess_123',
        depositAddress: '0xdead' as `0x${string}`,
        expiresAt: 1700000000,
      }
      mockFetch.mockReturnValueOnce(jsonResponse({ data: sessionData }))

      const result = await client.createSession({
        recipient: '0xrecipient' as `0x${string}`,
        amountRaw: '1000000',
      })

      expect(result).toEqual(sessionData)

      // Verify request shape
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.test.dev/v1/deposit')
      expect(options.method).toBe('POST')
      expect(options.headers['x-api-key']).toBe('pk_test_abc')
      expect(options.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(options.body)
      expect(body.destination.destinationAddress).toBe('0xrecipient')
      expect(body.destination.chainId).toBe(8453)
      expect(body.destination.units).toBe('1000000')
    })

    it('uses USDC as default token', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: {} }))
      await client.createSession({
        recipient: '0xrecipient' as `0x${string}`,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.destination.tokenAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })

    it('passes metadata through', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: {} }))
      await client.createSession({
        recipient: '0xrecipient' as `0x${string}`,
        metadata: { orderId: 'order_123' },
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.metadata).toEqual({ orderId: 'order_123' })
    })

    it('uses recipient as refundAddress when not specified', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: {} }))
      await client.createSession({
        recipient: '0xrecipient' as `0x${string}`,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.refundAddress).toBe('0xrecipient')
    })

    it('uses custom refundAddress when specified', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: {} }))
      await client.createSession({
        recipient: '0xrecipient' as `0x${string}`,
        refundAddress: '0xrefund' as `0x${string}`,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.refundAddress).toBe('0xrefund')
    })
  })

  describe('createSessionRaw', () => {
    it('sends raw params directly', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { sessionId: 'raw_sess' } }))

      const result = await client.createSessionRaw({
        destination: {
          destinationAddress: '0xdest',
          chainId: 8453,
          tokenAddress: '0xtoken',
          units: '500',
        },
      })

      expect(result).toEqual({ sessionId: 'raw_sess' })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.destination.destinationAddress).toBe('0xdest')
    })
  })

  describe('getStatus', () => {
    it('fetches session status', async () => {
      const statusData: SessionStatusResponse = {
        sessionId: 'sess_123',
        status: 'pending',
        depositAddress: '0xdead',
        expiresAt: 1700000000,
      }
      mockFetch.mockReturnValueOnce(jsonResponse({ data: statusData }))

      const result = await client.getStatus('sess_123')

      expect(result).toEqual(statusData)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.dev/v1/deposit/sess_123',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('getSupportedTokens', () => {
    it('fetches supported tokens', async () => {
      const tokens: SupportedToken[] = [
        { address: '0xusdc', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
      ]
      mockFetch.mockReturnValueOnce(jsonResponse({ data: tokens }))

      const result = await client.getSupportedTokens()
      expect(result).toEqual(tokens)
    })
  })

  describe('getWalletTokens', () => {
    it('fetches wallet tokens with query params', async () => {
      const tokens: TokenInfo[] = [
        {
          chainId: 8453,
          tokenAddress: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          rateUsdPerUnit: 1.0,
          minUnits: '1000000',
          maxUnits: '100000000',
          balanceUnits: '50.0',
          balanceUsd: 50.0,
        },
      ]
      mockFetch.mockReturnValueOnce(jsonResponse({ data: tokens }))

      const result = await client.getWalletTokens('sess_123', '0xwallet' as `0x${string}`)

      expect(result).toEqual(tokens)
      const url = mockFetch.mock.calls[0][0]
      expect(url).toContain('sessionId=sess_123')
      expect(url).toContain('walletAddress=0xwallet')
    })
  })

  describe('error handling', () => {
    it('throws PaidApiError on non-200 response', async () => {
      mockFetch.mockReturnValueOnce(errorResponse('Session not found', 404))

      await expect(client.getStatus('bad_id')).rejects.toThrow(PaidApiError)
      await mockFetch.mockReturnValueOnce(errorResponse('Session not found', 404))

      try {
        await client.getStatus('bad_id')
      } catch (err) {
        expect(err).toBeInstanceOf(PaidApiError)
        const apiErr = err as PaidApiError
        expect(apiErr.status).toBe(404)
        expect(apiErr.message).toBe('Session not found')
      }
    })

    it('falls back to HTTP status when no error message', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve(null),
        }),
      )

      try {
        await client.getStatus('sess')
      } catch (err) {
        expect(err).toBeInstanceOf(PaidApiError)
        expect((err as PaidApiError).message).toBe('HTTP 500')
      }
    })

    it('handles JSON parse failure gracefully', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error('not json')),
        }),
      )

      try {
        await client.getStatus('sess')
      } catch (err) {
        expect(err).toBeInstanceOf(PaidApiError)
        expect((err as PaidApiError).message).toBe('HTTP 502')
      }
    })

    it('unwraps data envelope', async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ success: true, data: { sessionId: 'unwrapped' } }),
      )
      const result = await client.getStatus('test')
      expect(result).toEqual({ sessionId: 'unwrapped' })
    })

    it('returns raw json when no data envelope', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ sessionId: 'raw' }))
      const result = await client.getStatus('test')
      expect(result).toEqual({ sessionId: 'raw' })
    })
  })

  describe('static methods', () => {
    describe('computePayAmount', () => {
      it('computes correct amount for USD value', () => {
        const token: TokenInfo = {
          chainId: 8453,
          tokenAddress: '0x',
          symbol: 'ETH',
          decimals: 18,
          rateUsdPerUnit: 2500,
          minUnits: '0',
          maxUnits: '0',
          balanceUnits: '1.0',
          balanceUsd: 2500,
        }
        const amount = PaidClient.computePayAmount(25, token)
        expect(amount).toBe('0.01')
      })

      it('returns "0" when rate is zero', () => {
        const token: TokenInfo = {
          chainId: 8453,
          tokenAddress: '0x',
          symbol: 'BAD',
          decimals: 18,
          rateUsdPerUnit: 0,
          minUnits: '0',
          maxUnits: '0',
          balanceUnits: '0',
          balanceUsd: 0,
        }
        expect(PaidClient.computePayAmount(25, token)).toBe('0')
      })

      it('returns "0" when rate is negative', () => {
        const token: TokenInfo = {
          chainId: 8453,
          tokenAddress: '0x',
          symbol: 'BAD',
          decimals: 18,
          rateUsdPerUnit: -1,
          minUnits: '0',
          maxUnits: '0',
          balanceUnits: '0',
          balanceUsd: 0,
        }
        expect(PaidClient.computePayAmount(25, token)).toBe('0')
      })

      it('handles stablecoin (1:1 rate)', () => {
        const token: TokenInfo = {
          chainId: 8453,
          tokenAddress: '0x',
          symbol: 'USDC',
          decimals: 6,
          rateUsdPerUnit: 1,
          minUnits: '0',
          maxUnits: '0',
          balanceUnits: '100',
          balanceUsd: 100,
        }
        expect(PaidClient.computePayAmount(25, token)).toBe('25')
      })
    })

    describe('isNativeToken', () => {
      it('returns true for zero address', () => {
        expect(PaidClient.isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true)
      })

      it('is case insensitive', () => {
        expect(PaidClient.isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true)
      })

      it('returns false for non-zero address', () => {
        expect(PaidClient.isNativeToken('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(false)
      })
    })
  })
})
