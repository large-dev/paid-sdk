import type {
  PaymentState,
  PaymentReceipt,
  SessionStatusResponse,
  TokenInfo,
  CreateSessionResponse,
} from './types'

// ─── Events ───────────────────────────────────────────────────────────────

export type PaymentEvent =
  | { type: 'START' }
  | { type: 'TOKENS_LOADED'; tokens: TokenInfo[] }
  | { type: 'PAY'; token: TokenInfo }
  | { type: 'SESSION_CREATED'; session: CreateSessionResponse }
  | { type: 'TX_SUBMITTED'; txHash: string }
  | { type: 'STATUS_UPDATE'; status: SessionStatusResponse }
  | { type: 'EXPIRED' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }

// ─── Context ──────────────────────────────────────────────────────────────

export interface PaymentContext {
  state: PaymentState
  sessionId: string | null
  depositAddress: string | null
  expiresAt: number | null // unix seconds
  tokens: TokenInfo[]
  selectedToken: TokenInfo | null
  txHash: string | null
  statusData: SessionStatusResponse | null
  receipt: PaymentReceipt | null
  error: string | null
}

export function initialContext(): PaymentContext {
  return {
    state: 'idle',
    sessionId: null,
    depositAddress: null,
    expiresAt: null,
    tokens: [],
    selectedToken: null,
    txHash: null,
    statusData: null,
    receipt: null,
    error: null,
  }
}

// ─── Reducer ──────────────────────────────────────────────────────────────

/**
 * Pure state machine reducer. No side effects — just state transitions.
 * The React hook (or any other runtime) is responsible for triggering
 * side effects based on state transitions.
 */
export function paymentReducer(
  ctx: PaymentContext,
  event: PaymentEvent,
): PaymentContext {
  switch (event.type) {
    case 'START':
      return {
        ...initialContext(),
        state: 'loading_tokens',
      }

    case 'TOKENS_LOADED':
      return {
        ...ctx,
        state: 'awaiting_selection',
        tokens: event.tokens,
      }

    case 'PAY':
      return {
        ...ctx,
        state: 'confirming',
        selectedToken: event.token,
      }

    case 'SESSION_CREATED':
      // Data-only update — stay in confirming
      return {
        ...ctx,
        sessionId: event.session.sessionId,
        depositAddress: event.session.depositAddress,
        expiresAt: event.session.expiresAt,
      }

    case 'TX_SUBMITTED':
      return {
        ...ctx,
        state: 'polling',
        txHash: event.txHash,
      }

    case 'STATUS_UPDATE': {
      const { status } = event.status

      if (status === 'completed') {
        return {
          ...ctx,
          state: 'completed',
          statusData: event.status,
          receipt: {
            sessionId: event.status.sessionId,
            status: 'completed',
            txHash: event.status.destination?.txHash ?? ctx.txHash,
            source: event.status.source,
            destination: event.status.destination,
            completedAt: new Date(),
          },
        }
      }

      if (status === 'bounced') {
        return {
          ...ctx,
          state: 'bounced',
          statusData: event.status,
          receipt: {
            sessionId: event.status.sessionId,
            status: 'bounced',
            txHash: ctx.txHash,
            source: event.status.source,
            destination: event.status.destination,
            completedAt: new Date(),
          },
        }
      }

      if (status === 'expired') {
        return {
          ...ctx,
          state: 'expired',
          statusData: event.status,
        }
      }

      // processing / pending — stay in current state, just update data
      return {
        ...ctx,
        statusData: event.status,
      }
    }

    case 'EXPIRED':
      return {
        ...ctx,
        state: 'expired',
      }

    case 'ERROR':
      return {
        ...ctx,
        state: 'error',
        error: event.error,
      }

    case 'RESET':
      return initialContext()

    default:
      return ctx
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** States that are considered terminal (no more transitions expected). */
export const TERMINAL_STATES: PaymentState[] = [
  'completed',
  'bounced',
  'expired',
  'error',
]

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL_STATES.includes(state)
}
