import { useCallback, useEffect, useRef, useReducer } from 'react'
import {
  paymentReducer,
  initialContext,
  type PaymentContext,
} from '../../core/state-machine'
import type {
  PaymentRequest,
  TokenInfo,
  PaymentReceipt,
  PaymentState,
} from '../../core/types'
import { usePaidContext } from '../context'

// ─── Polling config ───────────────────────────────────────────────────────

const POLL_INTERVAL_IDLE = 3000
const POLL_INTERVAL_ACTIVE = 1000
const EXPIRY_CHECK_INTERVAL = 1000

// ─── Hook Return ──────────────────────────────────────────────────────────

export interface UsePaidPaymentReturn {
  /** Current state of the payment lifecycle. */
  state: PaymentState
  /** Session ID once created. */
  sessionId: string | null
  /** Deposit address for the session. */
  depositAddress: string | null
  /** Available tokens the user can pay with. */
  tokens: TokenInfo[]
  /** The token the user selected (or was auto-selected). */
  selectedToken: TokenInfo | null
  /** Full status data from the server. */
  statusData: PaymentContext['statusData']
  /** Receipt available after completion or bounce. */
  receipt: PaymentReceipt | null
  /** Error message if state is 'error'. */
  error: string | null
  /** Start a payment flow. Creates a session and fetches tokens. */
  start: (request: PaymentRequest) => Promise<void>
  /** Select a token and create a session. Does NOT send the tx — the integrator handles that. */
  selectToken: (token: TokenInfo) => Promise<void>
  /**
   * Notify the SDK that a transaction was submitted.
   * Call this after your app sends the on-chain tx (via wagmi, ethers, etc.).
   * The SDK will start polling for completion.
   */
  notifyTxSent: (txHash: string) => void
  /** Reset to idle state. */
  reset: () => void
}

export interface UsePaidPaymentOptions {
  /** Called when the payment completes successfully. */
  onComplete?: (receipt: PaymentReceipt) => void
  /** Called when the payment bounces (fails on-chain). */
  onBounced?: (receipt: PaymentReceipt) => void
  /** Called when the session expires before payment. */
  onExpired?: () => void
  /** Called on any error. */
  onError?: (error: string) => void
}

/**
 * Headless payment hook. Use this to build custom payment UI.
 *
 * The SDK handles: session creation, token fetching, status polling.
 * Your app handles: wallet connection, sending the transaction.
 *
 * @example
 * ```tsx
 * const payment = usePaidPayment({
 *   onComplete: (receipt) => console.log('Paid!', receipt),
 * })
 *
 * // Start
 * await payment.start({ recipient: '0x...', amountUsd: 25 })
 *
 * // User picks a token
 * payment.selectToken(payment.tokens[0])
 *
 * // Your app sends the tx (via wagmi, ethers, etc.)
 * const hash = await sendTransaction(...)
 * payment.notifyTxSent(hash)
 *
 * // SDK polls automatically → onComplete fires
 * ```
 */
export function usePaidPayment(
  options: UsePaidPaymentOptions = {},
): UsePaidPaymentReturn {
  const { client } = usePaidContext()
  const [ctx, dispatch] = useReducer(paymentReducer, initialContext())

  // Stable refs for callbacks
  const optionsRef = useRef(options)
  optionsRef.current = options
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Cleanup ────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (expiryRef.current) {
      clearInterval(expiryRef.current)
      expiryRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  // ─── Status polling ─────────────────────────────────────────────────

  const startPolling = useCallback(
    (sessionId: string, interval: number) => {
      stopPolling()

      const poll = async () => {
        try {
          const status = await client.getStatus(sessionId)
          dispatch({ type: 'STATUS_UPDATE', status })

          // Fire callbacks on terminal states
          if (status.status === 'completed' && ctxRef.current.state !== 'completed') {
            stopPolling()
            const receipt: PaymentReceipt = {
              sessionId: status.sessionId,
              status: 'completed',
              txHash: status.destination?.txHash ?? ctxRef.current.txHash,
              source: status.source,
              destination: status.destination,
              completedAt: new Date(),
            }
            optionsRef.current.onComplete?.(receipt)
          } else if (status.status === 'bounced' && ctxRef.current.state !== 'bounced') {
            stopPolling()
            const receipt: PaymentReceipt = {
              sessionId: status.sessionId,
              status: 'bounced',
              txHash: ctxRef.current.txHash,
              source: status.source,
              destination: status.destination,
              completedAt: new Date(),
            }
            optionsRef.current.onBounced?.(receipt)
          } else if (status.status === 'expired') {
            stopPolling()
            optionsRef.current.onExpired?.()
          }
        } catch {
          // Silently retry on poll failures
        }
      }

      pollRef.current = setInterval(poll, interval)
      // Also poll immediately
      poll()
    },
    [client, stopPolling],
  )

  // ─── Expiry checker ─────────────────────────────────────────────────

  const startExpiryCheck = useCallback(
    (expiresAt: number) => {
      if (expiryRef.current) clearInterval(expiryRef.current)

      expiryRef.current = setInterval(() => {
        if (Date.now() / 1000 >= expiresAt) {
          dispatch({ type: 'EXPIRED' })
          stopPolling()
          optionsRef.current.onExpired?.()
        }
      }, EXPIRY_CHECK_INTERVAL)
    },
    [stopPolling],
  )

  // ─── Actions ────────────────────────────────────────────────────────

  // Store the payment request so selectToken can use it to create the session
  const requestRef = useRef<PaymentRequest | null>(null)

  const start = useCallback(
    async (request: PaymentRequest) => {
      dispatch({ type: 'RESET' })
      requestRef.current = request

      // Go straight to awaiting_payment — no session yet.
      // We fake a SESSION_CREATED with empty ids so the state advances.
      // The real session is created in selectToken() with the correct inputToken.
      dispatch({ type: 'CREATE_SESSION' })

      try {
        // Fetch wallet tokens if a wallet address is available
        // (tokens are loaded separately by the integrator via TOKENS_LOADED)
        // Transition to awaiting_payment so the integrator can show token picker
        dispatch({
          type: 'SESSION_CREATED',
          session: { sessionId: '', depositAddress: '' as `0x${string}`, expiresAt: 0 },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start payment'
        dispatch({ type: 'ERROR', error: msg })
        optionsRef.current.onError?.(msg)
      }
    },
    [],
  )

  const selectToken = useCallback(
    async (token: TokenInfo) => {
      const request = requestRef.current
      if (!request) return

      dispatch({ type: 'TOKEN_SELECTED', token })

      try {
        // Create the session with the correct inputToken
        const session = await client.createSession({
          ...request,
          inputToken: token.tokenAddress as `0x${string}`,
        })
        dispatch({ type: 'SESSION_CREATED', session })

        // Start expiry check
        startExpiryCheck(session.expiresAt)

        // Start slow polling (status might update if user pays outside the drawer)
        startPolling(session.sessionId, POLL_INTERVAL_IDLE)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create session'
        dispatch({ type: 'ERROR', error: msg })
        optionsRef.current.onError?.(msg)
      }
    },
    [client, startExpiryCheck, startPolling],
  )

  const notifyTxSent = useCallback(
    (txHash: string) => {
      dispatch({ type: 'TX_SUBMITTED', txHash })
      // Switch to fast polling
      if (ctxRef.current.sessionId) {
        startPolling(ctxRef.current.sessionId, POLL_INTERVAL_ACTIVE)
      }
    },
    [startPolling],
  )

  const reset = useCallback(() => {
    stopPolling()
    dispatch({ type: 'RESET' })
  }, [stopPolling])

  // ─── Token loading (callable by integrator after wallet connects) ───

  // We expose tokens on the context so the drawer can load them
  // after it knows the wallet address.

  return {
    state: ctx.state,
    sessionId: ctx.sessionId,
    depositAddress: ctx.depositAddress,
    tokens: ctx.tokens,
    selectedToken: ctx.selectedToken,
    statusData: ctx.statusData,
    receipt: ctx.receipt,
    error: ctx.error,
    start,
    selectToken,
    notifyTxSent,
    reset,
  }
}
