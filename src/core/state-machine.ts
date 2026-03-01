import type {
  PaymentState,
  PaymentReceipt,
  SessionStatusResponse,
  TokenInfo,
  PaymentRequest,
  CreateSessionResponse,
} from './types'

// ─── Events ───────────────────────────────────────────────────────────────

export type PaymentEvent =
  | { type: 'CREATE_SESSION' }
  | { type: 'SESSION_CREATED'; session: CreateSessionResponse }
  | { type: 'TOKENS_LOADED'; tokens: TokenInfo[] }
  | { type: 'TOKEN_SELECTED'; token: TokenInfo }
  | { type: 'TX_SUBMITTED'; txHash: string }
  | { type: 'STATUS_UPDATE'; status: SessionStatusResponse }
  | { type: 'EXPIRED' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }

// ─── Context ──────────────────────────────────────────────────────────────

export interface PaymentContext {
  state: PaymentState
  request: PaymentRequest | null
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
    request: null,
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
    case 'CREATE_SESSION':
      return {
        ...ctx,
        state: 'creating',
        error: null,
      }

    case 'SESSION_CREATED':
      return {
        ...ctx,
        state: 'awaiting_payment',
        sessionId: event.session.sessionId,
        depositAddress: event.session.depositAddress,
        expiresAt: event.session.expiresAt,
      }

    case 'TOKENS_LOADED':
      return {
        ...ctx,
        tokens: event.tokens,
      }

    case 'TOKEN_SELECTED':
      return {
        ...ctx,
        state: 'sending',
        selectedToken: event.token,
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
