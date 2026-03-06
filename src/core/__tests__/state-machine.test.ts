import { describe, it, expect } from 'vitest'
import {
  paymentReducer,
  initialContext,
  isTerminal,
  TERMINAL_STATES,
  type PaymentEvent,
  type PaymentContext,
} from '../state-machine'
import type {
  CreateSessionResponse,
  TokenInfo,
  SessionStatusResponse,
} from '../types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockSession: CreateSessionResponse = {
  sessionId: 'sess_123',
  depositAddress: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
}

const mockToken: TokenInfo = {
  chainId: 8453,
  tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  decimals: 6,
  rateUsdPerUnit: 1.0,
  minUnits: '1000000',
  maxUnits: '100000000000',
  balanceUnits: '50.0',
  balanceUsd: 50.0,
}

const mockStatusPending: SessionStatusResponse = {
  sessionId: 'sess_123',
  status: 'pending',
  depositAddress: '0x1234567890abcdef1234567890abcdef12345678',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
}

const mockStatusCompleted: SessionStatusResponse = {
  ...mockStatusPending,
  status: 'completed',
  source: {
    txHash: '0xabc',
    chainId: 8453,
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenSymbol: 'USDC',
    amountUnits: '25000000',
    usdValue: '25.00',
  },
  destination: {
    txHash: '0xdef',
    chainId: 8453,
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenSymbol: 'USDC',
    amountUnits: '25000000',
  },
}

const mockStatusBounced: SessionStatusResponse = {
  ...mockStatusPending,
  status: 'bounced',
  source: {
    txHash: '0xabc',
    chainId: 8453,
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenSymbol: 'USDC',
    amountUnits: '25000000',
    usdValue: '25.00',
  },
}

const mockStatusExpired: SessionStatusResponse = {
  ...mockStatusPending,
  status: 'expired',
}

const mockStatusProcessing: SessionStatusResponse = {
  ...mockStatusPending,
  status: 'processing',
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('initialContext', () => {
  it('returns idle state with all fields null/empty', () => {
    const ctx = initialContext()
    expect(ctx.state).toBe('idle')
    expect(ctx.sessionId).toBeNull()
    expect(ctx.depositAddress).toBeNull()
    expect(ctx.expiresAt).toBeNull()
    expect(ctx.tokens).toEqual([])
    expect(ctx.selectedToken).toBeNull()
    expect(ctx.txHash).toBeNull()
    expect(ctx.statusData).toBeNull()
    expect(ctx.receipt).toBeNull()
    expect(ctx.error).toBeNull()
  })
})

describe('paymentReducer', () => {
  describe('START', () => {
    it('transitions idle → loading_tokens', () => {
      const ctx = initialContext()
      const next = paymentReducer(ctx, { type: 'START' })
      expect(next.state).toBe('loading_tokens')
    })

    it('resets all state when starting fresh', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'error',
        error: 'old error',
        sessionId: 'old_sess',
      }
      const next = paymentReducer(ctx, { type: 'START' })
      expect(next.state).toBe('loading_tokens')
      expect(next.error).toBeNull()
      expect(next.sessionId).toBeNull()
    })
  })

  describe('TOKENS_LOADED', () => {
    it('transitions loading_tokens → awaiting_selection with tokens', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'loading_tokens' }
      const next = paymentReducer(ctx, { type: 'TOKENS_LOADED', tokens: [mockToken] })
      expect(next.state).toBe('awaiting_selection')
      expect(next.tokens).toEqual([mockToken])
    })

    it('replaces existing tokens', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'loading_tokens',
        tokens: [mockToken],
      }
      const newToken = { ...mockToken, symbol: 'ETH' }
      const next = paymentReducer(ctx, { type: 'TOKENS_LOADED', tokens: [newToken] })
      expect(next.tokens).toEqual([newToken])
    })
  })

  describe('PAY', () => {
    it('transitions awaiting_selection → confirming with selected token', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'awaiting_selection',
        tokens: [mockToken],
      }
      const next = paymentReducer(ctx, { type: 'PAY', token: mockToken })
      expect(next.state).toBe('confirming')
      expect(next.selectedToken).toBe(mockToken)
    })
  })

  describe('SESSION_CREATED', () => {
    it('stores session data without changing state', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'confirming',
        selectedToken: mockToken,
      }
      const next = paymentReducer(ctx, { type: 'SESSION_CREATED', session: mockSession })
      expect(next.state).toBe('confirming')
      expect(next.sessionId).toBe('sess_123')
      expect(next.depositAddress).toBe(mockSession.depositAddress)
      expect(next.expiresAt).toBe(mockSession.expiresAt)
    })
  })

  describe('TX_SUBMITTED', () => {
    it('transitions confirming → polling with txHash', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'confirming',
        selectedToken: mockToken,
        sessionId: 'sess_123',
      }
      const next = paymentReducer(ctx, { type: 'TX_SUBMITTED', txHash: '0xabc123' })
      expect(next.state).toBe('polling')
      expect(next.txHash).toBe('0xabc123')
    })
  })

  describe('STATUS_UPDATE', () => {
    it('handles completed status → completed with receipt', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'polling',
        sessionId: 'sess_123',
        txHash: '0xabc',
      }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusCompleted })
      expect(next.state).toBe('completed')
      expect(next.statusData).toBe(mockStatusCompleted)
      expect(next.receipt).not.toBeNull()
      expect(next.receipt!.status).toBe('completed')
      expect(next.receipt!.sessionId).toBe('sess_123')
      expect(next.receipt!.txHash).toBe('0xdef') // from destination
      expect(next.receipt!.source).toBe(mockStatusCompleted.source)
      expect(next.receipt!.destination).toBe(mockStatusCompleted.destination)
    })

    it('falls back to ctx.txHash when destination.txHash is null', () => {
      const statusNoDestTx: SessionStatusResponse = {
        ...mockStatusCompleted,
        destination: { ...mockStatusCompleted.destination!, txHash: null },
      }
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'polling',
        txHash: '0xmytx',
      }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: statusNoDestTx })
      expect(next.receipt!.txHash).toBe('0xmytx')
    })

    it('handles bounced status → bounced with receipt', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'polling',
        txHash: '0xabc',
      }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusBounced })
      expect(next.state).toBe('bounced')
      expect(next.receipt).not.toBeNull()
      expect(next.receipt!.status).toBe('bounced')
      expect(next.receipt!.txHash).toBe('0xabc')
    })

    it('handles expired status → expired', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'polling' }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusExpired })
      expect(next.state).toBe('expired')
      expect(next.statusData).toBe(mockStatusExpired)
      expect(next.receipt).toBeNull()
    })

    it('handles processing status — stays in current state', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'polling' }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusProcessing })
      expect(next.state).toBe('polling')
      expect(next.statusData).toBe(mockStatusProcessing)
    })

    it('handles pending status — stays in current state', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'awaiting_selection' }
      const next = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusPending })
      expect(next.state).toBe('awaiting_selection')
      expect(next.statusData).toBe(mockStatusPending)
    })
  })

  describe('EXPIRED', () => {
    it('transitions to expired state', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'awaiting_selection' }
      const next = paymentReducer(ctx, { type: 'EXPIRED' })
      expect(next.state).toBe('expired')
    })

    it('transitions from polling to expired', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'polling' }
      const next = paymentReducer(ctx, { type: 'EXPIRED' })
      expect(next.state).toBe('expired')
    })
  })

  describe('ERROR', () => {
    it('transitions to error with message', () => {
      const ctx: PaymentContext = { ...initialContext(), state: 'confirming' }
      const next = paymentReducer(ctx, { type: 'ERROR', error: 'Network failure' })
      expect(next.state).toBe('error')
      expect(next.error).toBe('Network failure')
    })

    it('can error from any state', () => {
      const states = ['idle', 'loading_tokens', 'awaiting_selection', 'confirming', 'polling'] as const
      for (const state of states) {
        const ctx: PaymentContext = { ...initialContext(), state }
        const next = paymentReducer(ctx, { type: 'ERROR', error: 'fail' })
        expect(next.state).toBe('error')
      }
    })
  })

  describe('RESET', () => {
    it('returns to initial context from any state', () => {
      const ctx: PaymentContext = {
        ...initialContext(),
        state: 'completed',
        sessionId: 'sess_123',
        txHash: '0xabc',
        error: 'old error',
      }
      const next = paymentReducer(ctx, { type: 'RESET' })
      expect(next).toEqual(initialContext())
    })
  })

  describe('unknown event', () => {
    it('returns context unchanged', () => {
      const ctx = initialContext()
      const next = paymentReducer(ctx, { type: 'UNKNOWN_EVENT' } as unknown as PaymentEvent)
      expect(next).toBe(ctx)
    })
  })
})

describe('full payment flow', () => {
  it('idle → loading_tokens → awaiting_selection → confirming → polling → completed', () => {
    let ctx = initialContext()

    ctx = paymentReducer(ctx, { type: 'START' })
    expect(ctx.state).toBe('loading_tokens')

    ctx = paymentReducer(ctx, { type: 'TOKENS_LOADED', tokens: [mockToken] })
    expect(ctx.state).toBe('awaiting_selection')
    expect(ctx.tokens).toHaveLength(1)

    ctx = paymentReducer(ctx, { type: 'PAY', token: mockToken })
    expect(ctx.state).toBe('confirming')

    ctx = paymentReducer(ctx, { type: 'SESSION_CREATED', session: mockSession })
    expect(ctx.state).toBe('confirming')
    expect(ctx.sessionId).toBe('sess_123')

    ctx = paymentReducer(ctx, { type: 'TX_SUBMITTED', txHash: '0xabc123' })
    expect(ctx.state).toBe('polling')

    // Non-terminal status update
    ctx = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusProcessing })
    expect(ctx.state).toBe('polling')

    // Terminal status update
    ctx = paymentReducer(ctx, { type: 'STATUS_UPDATE', status: mockStatusCompleted })
    expect(ctx.state).toBe('completed')
    expect(ctx.receipt).not.toBeNull()
  })
})

describe('isTerminal', () => {
  it('returns true for terminal states', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('bounced')).toBe(true)
    expect(isTerminal('expired')).toBe(true)
    expect(isTerminal('error')).toBe(true)
  })

  it('returns false for non-terminal states', () => {
    expect(isTerminal('idle')).toBe(false)
    expect(isTerminal('loading_tokens')).toBe(false)
    expect(isTerminal('awaiting_selection')).toBe(false)
    expect(isTerminal('confirming')).toBe(false)
    expect(isTerminal('polling')).toBe(false)
  })
})

describe('TERMINAL_STATES', () => {
  it('contains exactly the terminal states', () => {
    expect(TERMINAL_STATES).toEqual(['completed', 'bounced', 'expired', 'error'])
  })
})
