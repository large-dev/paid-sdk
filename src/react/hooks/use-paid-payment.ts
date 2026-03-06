import { useCallback, useEffect, useRef, useReducer } from 'react'
import { useAccount, useSendTransaction } from 'wagmi'
import { parseEther, encodeFunctionData, erc20Abi } from 'viem'
import {
  paymentReducer,
  initialContext,
} from '../../core/state-machine'
import { PaidClient } from '../../core/client'
import type {
  TokenInfo,
  PaymentReceipt,
  PaymentState,
  CreateSessionResponse,
  Address,
  Hex,
} from '../../core/types'
import { NATIVE_TOKEN } from '../../core/types'
import { usePaidContext } from '../context'

// ─── Polling config ───────────────────────────────────────────────────────

const POLL_INTERVAL = 1000
const EXPIRY_CHECK_INTERVAL = 1000

// ─── Types ────────────────────────────────────────────────────────────────

/** Parameters passed to a custom sendTransaction override. */
export interface SendTransactionParams {
  token: TokenInfo
  amount: string
  depositAddress: string
  isNative: boolean
}

export interface UsePaidPaymentOptions {
  /** Recipient wallet address (where funds land after swap). */
  recipient: Address
  /** USD amount to charge. The SDK handles token conversion. */
  amountUsd?: number
  /** Raw token amount (wei string). Use instead of amountUsd for exact amounts. */
  amountRaw?: string
  /** Address to refund if the session expires unused. */
  refundAddress?: Address
  /** Arbitrary metadata attached to the session. */
  metadata?: Record<string, string>
  /** Optional calldata to execute on the destination contract after swap. */
  calldata?: Hex
  /** Contract address to receive the sweep (used with calldata). */
  destinationContract?: Address
  /** Called when the payment completes successfully. */
  onComplete?: (receipt: PaymentReceipt) => void
  /** Called when the payment bounces (fails on-chain). */
  onBounced?: (receipt: PaymentReceipt) => void
  /** Called when the session expires before payment. */
  onExpired?: () => void
  /** Called on any error. */
  onError?: (error: string) => void
  /**
   * Override the default wagmi transaction sender.
   * When provided, the hook uses this instead of wagmi's useSendTransaction.
   * Useful for non-wagmi environments or custom wallet integrations.
   */
  sendTransaction?: (params: SendTransactionParams) => Promise<string>
}

export interface UsePaidPaymentReturn {
  /** Current state of the payment lifecycle. */
  state: PaymentState
  /** Available tokens the user can pay with. */
  tokens: TokenInfo[]
  /** The token the user selected. */
  selectedToken: TokenInfo | null
  /** Receipt available after completion or bounce. */
  receipt: PaymentReceipt | null
  /** Error message if state is 'error'. */
  error: string | null
  /** Session ID once created. */
  sessionId: string | null
  /** Full status data from the server. */
  statusData: ReturnType<typeof initialContext>['statusData']
  /** Start the payment flow — fetches tokens for the connected wallet. */
  start: () => Promise<void>
  /** Select a token and execute the full pay flow (create session → send tx → poll). */
  pay: (token: TokenInfo) => Promise<void>
  /** Reset to idle state. */
  reset: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Detect user wallet cancellation vs real errors. */
function isUserCancellation(error: string): boolean {
  const lower = error.toLowerCase()
  return (
    lower.includes('reject') ||
    lower.includes('denied') ||
    lower.includes('cancel') ||
    lower.includes('user refused')
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────

/**
 * Full-lifecycle payment hook. Owns state, tokens, tx sending, and polling.
 *
 * @example
 * ```tsx
 * const payment = usePaidPayment({
 *   recipient: '0x...',
 *   amountUsd: 25,
 *   onComplete: (receipt) => console.log('Paid!', receipt),
 * })
 *
 * // Start — fetches tokens for the connected wallet
 * await payment.start()
 *
 * // User picks a token → creates session, sends tx, polls automatically
 * await payment.pay(payment.tokens[0])
 * ```
 */
export function usePaidPayment(
  options: UsePaidPaymentOptions,
): UsePaidPaymentReturn {
  const { client } = usePaidContext()
  const [ctx, dispatch] = useReducer(paymentReducer, initialContext())

  // Wagmi hooks
  const { address } = useAccount()
  const { sendTransactionAsync } = useSendTransaction()

  // Stable refs for callbacks and options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // Polling refs
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
    (sessionId: string) => {
      stopPolling()

      const poll = async () => {
        try {
          const status = await client.getStatus(sessionId)
          dispatch({ type: 'STATUS_UPDATE', status })

          if (status.status === 'completed' && ctxRef.current.state !== 'completed') {
            stopPolling()
            optionsRef.current.onComplete?.(ctxRef.current.receipt ?? {
              sessionId: status.sessionId,
              status: 'completed',
              txHash: status.destination?.txHash ?? ctxRef.current.txHash,
              source: status.source,
              destination: status.destination,
              completedAt: new Date(),
            })
          } else if (status.status === 'bounced' && ctxRef.current.state !== 'bounced') {
            stopPolling()
            optionsRef.current.onBounced?.(ctxRef.current.receipt ?? {
              sessionId: status.sessionId,
              status: 'bounced',
              txHash: ctxRef.current.txHash,
              source: status.source,
              destination: status.destination,
              completedAt: new Date(),
            })
          } else if (status.status === 'expired') {
            stopPolling()
            optionsRef.current.onExpired?.()
          }
        } catch {
          // Silently retry on poll failures
        }
      }

      pollRef.current = setInterval(poll, POLL_INTERVAL)
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

  // ─── Default tx sender (wagmi) ──────────────────────────────────────

  const defaultSendTransaction = useCallback(
    async ({ token, amount, depositAddress, isNative }: SendTransactionParams): Promise<string> => {
      if (isNative) {
        const hash = await sendTransactionAsync({
          to: depositAddress as Address,
          value: parseEther(amount),
        })
        return hash
      }

      // ERC-20 transfer
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [
          depositAddress as Address,
          BigInt(Math.round(parseFloat(amount) * 10 ** token.decimals)),
        ],
      })
      const hash = await sendTransactionAsync({
        to: token.tokenAddress as Address,
        data,
      })
      return hash
    },
    [sendTransactionAsync],
  )

  // ─── Actions ────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (!address) {
      optionsRef.current.onError?.('Wallet not connected')
      dispatch({ type: 'ERROR', error: 'Wallet not connected' })
      return
    }

    dispatch({ type: 'START' })

    try {
      const raw = await client.getWalletTokens(address)
      const data: TokenInfo[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown>)?.tokens)
          ? (raw as unknown as { tokens: TokenInfo[] }).tokens
          : []

      let sorted = data
        .filter((t) => parseFloat(t.balanceUnits) > 0)
        .sort((a, b) => b.balanceUsd - a.balanceUsd)
        .slice(0, 6)

      const { amountUsd } = optionsRef.current
      if (amountUsd != null) {
        sorted = sorted.filter((t) => {
          if (t.rateUsdPerUnit <= 0) return false
          const sendAmount = PaidClient.computePayAmount(amountUsd, t)
          return parseFloat(t.balanceUnits) >= parseFloat(sendAmount)
        })
      }

      dispatch({ type: 'TOKENS_LOADED', tokens: sorted })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch tokens'
      dispatch({ type: 'ERROR', error: msg })
      optionsRef.current.onError?.(msg)
    }
  }, [address, client])

  const pay = useCallback(
    async (token: TokenInfo) => {
      const opts = optionsRef.current
      dispatch({ type: 'PAY', token })

      // 1. Create session
      let session: CreateSessionResponse
      try {
        session = await client.createSession({
          recipient: opts.recipient,
          refundAddress: opts.refundAddress ?? opts.recipient,
          amountUsd: opts.amountUsd,
          amountRaw: opts.amountRaw,
          metadata: opts.metadata,
          calldata: opts.calldata,
          destinationContract: opts.destinationContract,
          inputToken: token.tokenAddress as Address,
        })
        dispatch({ type: 'SESSION_CREATED', session })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create session'
        dispatch({ type: 'ERROR', error: msg })
        opts.onError?.(msg)
        return
      }

      // Start expiry check
      startExpiryCheck(session.expiresAt)

      // 2. Send transaction
      const isNative = token.tokenAddress.toLowerCase() === NATIVE_TOKEN
      let amount: string
      if (opts.amountUsd != null) {
        amount = PaidClient.computePayAmount(opts.amountUsd, token)
      } else if (opts.amountRaw != null) {
        amount = opts.amountRaw
      } else {
        amount = token.balanceUnits
      }

      const sendTx = opts.sendTransaction ?? defaultSendTransaction

      try {
        const txHash = await sendTx({
          token,
          amount,
          depositAddress: session.depositAddress,
          isNative,
        })
        dispatch({ type: 'TX_SUBMITTED', txHash })

        // 3. Start polling
        startPolling(session.sessionId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transaction failed'

        // User cancellation → return to token selection
        if (isUserCancellation(msg)) {
          dispatch({ type: 'TOKENS_LOADED', tokens: ctxRef.current.tokens })
          stopPolling()
          return
        }

        dispatch({ type: 'ERROR', error: msg })
        opts.onError?.(msg)
      }
    },
    [client, defaultSendTransaction, startPolling, startExpiryCheck, stopPolling],
  )

  const reset = useCallback(() => {
    stopPolling()
    dispatch({ type: 'RESET' })
  }, [stopPolling])

  return {
    state: ctx.state,
    tokens: ctx.tokens,
    selectedToken: ctx.selectedToken,
    receipt: ctx.receipt,
    error: ctx.error,
    sessionId: ctx.sessionId,
    statusData: ctx.statusData,
    start,
    pay,
    reset,
  }
}
