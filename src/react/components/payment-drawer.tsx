import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { PaidClient } from '../../core/client'
import type {
  TokenInfo,
  PaymentReceipt,
  SessionStatusResponse,
  Address,
} from '../../core/types'
import { NATIVE_TOKEN } from '../../core/types'
import { usePaidContext } from '../context'
import { BoltIcon } from './bolt-icon'

// ─── Optional framer-motion import ─────────────────────────────────────────
// framer-motion is an optional peer dep. When absent, we fall back to plain divs.

type MotionType = typeof import('framer-motion').motion
type AnimatePresenceType = typeof import('framer-motion').AnimatePresence

let motion: MotionType | undefined
let AnimatePresence: AnimatePresenceType | undefined

try {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const _require = typeof globalThis !== 'undefined'
    ? (globalThis as Record<string, unknown>).__require as ((id: string) => unknown) | undefined
    : undefined
  const resolve = _require ?? new Function('id', 'return require(id)') as (id: string) => unknown
  const fm = resolve('framer-motion') as { motion: MotionType; AnimatePresence: AnimatePresenceType }
  motion = fm.motion
  AnimatePresence = fm.AnimatePresence
} catch {
  // framer-motion not installed — graceful fallback
}

// ─── Styles ────────────────────────────────────────────────────────────────

const mono: CSSProperties = { fontFamily: "'Courier New', Courier, monospace" }
const brand: CSSProperties = { fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif" }

const CONTAINER: CSSProperties = {
  width: '100%',
  backgroundColor: '#000',
  color: '#fff',
  padding: 0,
  border: '1px solid rgba(255,255,255,0.15)',
  overflow: 'hidden',
}

const RECEIPT_CONTAINER: CSSProperties = {
  width: '100%',
  padding: 0,
  border: '3px solid rgba(255,255,255,0.9)',
  overflow: 'hidden',
}

// ─── Types ─────────────────────────────────────────────────────────────────

type View = 'loading' | 'select_token' | 'confirming' | 'result'

export interface PaymentDrawerProps {
  /** Controls visibility. */
  open: boolean
  /** Payment title shown in the drawer header. */
  title: string
  subtitle?: string
  /** USD amount to charge. */
  amountUsd?: number
  /** Display string for the amount (e.g. "$25.00"). Auto-generated from amountUsd if omitted. */
  amountDisplay?: string
  /** Recipient address. */
  recipient: Address
  /** Refund address. Defaults to recipient. */
  refundAddress?: Address
  /** Connected wallet address. Required to fetch tokens and send. */
  walletAddress?: Address
  /** Receipt color theme. */
  receiptTheme?: 'light' | 'dark'
  /** Arbitrary metadata attached to the session. */
  metadata?: Record<string, string>
  /** Optional calldata to execute on the destination contract after swap. */
  calldata?: `0x${string}`
  /** Contract address to receive the sweep (used with calldata). Overrides `recipient` as destination. */
  destinationContract?: Address
  /**
   * Called when the user selects a token and the SDK needs a transaction sent.
   * The integrator must send the tx and return the hash.
   * This is where you use wagmi/ethers/viem to actually send.
   */
  onSendTransaction?: (params: {
    token: TokenInfo
    amount: string
    depositAddress: string
    isNative: boolean
  }) => Promise<string>
  onComplete?: (receipt: PaymentReceipt) => void
  onBounced?: (receipt: PaymentReceipt) => void
  onError?: (error: string) => void
  onClose?: () => void
}

// ─── Animation variants ────────────────────────────────────────────────────

const paidFadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8 },
}

const paidStagger = {
  animate: { transition: { staggerChildren: 0.08 } },
}

const paidStamp = {
  initial: { scale: 3, opacity: 0, rotate: -12 },
  animate: {
    scale: 1, opacity: 1, rotate: -6,
    transition: { type: 'spring', stiffness: 400, damping: 15, delay: 0.3 },
  },
}

// ─── Format helpers ────────────────────────────────────────────────────────

function formatUsd(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function formatBalance(units: string, decimals: number): string {
  const val = parseFloat(units)
  if (val === 0) return '0'
  if (val < 0.0001) return '<0.0001'
  return val.toFixed(Math.min(decimals, 4)).replace(/\.?0+$/, '')
}

/** Per-currency decimal formatting (stablecoins=2, BTC=8, ETH=6, etc.) */
function formatTokenAmount(amount: string, symbol?: string, decimals?: number): string {
  const val = parseFloat(amount)
  if (isNaN(val) || val === 0) return '0'

  const sym = (symbol || '').toUpperCase()
  let maxDecimals: number

  if (['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'SUSD', 'PYUSD', 'CUSD', 'CEUR'].includes(sym)) {
    maxDecimals = 2
  } else if (['WBTC', 'BTC', 'TBTC', 'CBBTC'].includes(sym)) {
    maxDecimals = 8
  } else if (['ETH', 'WETH', 'STETH', 'RETH', 'CBETH'].includes(sym)) {
    maxDecimals = 6
  } else if (decimals != null) {
    maxDecimals = Math.min(decimals, 6)
  } else {
    maxDecimals = 6
  }

  if (val > 0 && val < Math.pow(10, -maxDecimals)) {
    return `<${Math.pow(10, -maxDecimals).toFixed(maxDecimals)}`
  }

  return val.toFixed(maxDecimals).replace(/\.?0+$/, '')
}

/** Detect user wallet cancellation vs real errors */
function isUserCancellation(error: string): boolean {
  const lower = error.toLowerCase()
  return lower.includes('reject') || lower.includes('denied') || lower.includes('cancel') || lower.includes('user refused')
}

// ─── Motion-aware wrapper ──────────────────────────────────────────────────
// Renders framer-motion elements when available, plain divs otherwise.

function M({
  tag = 'div',
  children,
  style,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...motionProps
}: {
  tag?: 'div' | 'button'
  children?: ReactNode
  style?: CSSProperties
  onClick?: () => void
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
  [key: string]: unknown
}) {
  if (motion) {
    const Component = tag === 'button' ? motion.button : motion.div
    return (
      <Component style={style} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} {...motionProps}>
        {children}
      </Component>
    )
  }
  // Fallback: plain HTML element
  const Tag = tag
  return (
    <Tag style={style} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </Tag>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PaidButton({
  onClick,
  children,
  variant = 'primary',
  style: extraStyle,
}: {
  onClick?: () => void
  children: ReactNode
  variant?: 'primary' | 'danger'
  style?: CSSProperties
}) {
  const [hovered, setHovered] = useState(false)

  const base: CSSProperties = {
    width: '100%',
    padding: '12px 24px',
    border: '2px solid',
    fontSize: '0.875rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    transition: 'transform 0.1s, box-shadow 0.1s',
    ...(variant === 'danger'
      ? { backgroundColor: 'transparent', color: '#ff0000', borderColor: '#ff0000' }
      : { backgroundColor: '#fff', color: '#000', borderColor: '#000' }),
    ...(hovered
      ? { transform: 'translate(-2px, -2px)', boxShadow: '4px 4px 0px currentColor' }
      : {}),
    ...mono,
    ...extraStyle,
  }

  if (motion) {
    return (
      <motion.button
        onClick={onClick}
        style={{
          ...base,
          transform: undefined,
          boxShadow: undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        whileHover={{ x: -2, y: -2, boxShadow: '4px 4px 0px currentColor' }}
        whileTap={{ scale: 0.97 }}
      >
        {children}
      </motion.button>
    )
  }

  return (
    <button
      onClick={onClick}
      style={base}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  )
}

function DrawerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BoltIcon size="sm" color="white" />
      </div>
      <div>
        <h2 style={{
          fontSize: '0.875rem', fontWeight: 700, color: '#fff',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, ...mono,
        }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 2, ...mono }}>
            {subtitle}
          </p>
        )}
      </div>
    </>
  )
}

function TokenLogo({ token, size = 40 }: { token: TokenInfo; size?: number }) {
  const [imgError, setImgError] = useState(false)

  if (token.logoUrl && !imgError) {
    return (
      <img
        src={token.logoUrl}
        alt={token.symbol}
        width={size}
        height={size}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
        }}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: 'rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size > 30 ? '0.75rem' : '0.5rem', fontWeight: 700, flexShrink: 0, ...mono,
    }}>
      {token.symbol.slice(0, 3)}
    </div>
  )
}

function PoweredByFooter({ color = 'white' }: { color?: 'black' | 'white' }) {
  const muted = color === 'white' ? 'rgba(255,255,255,0.4)' : '#888'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0' }}>
      <span style={{ fontSize: '0.5625rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: muted, ...mono }}>
        Powered by PAID
      </span>
      <BoltIcon size="sm" color={color} />
    </div>
  )
}

// Skeleton shimmer row for token loading
function SkeletonTokenRow() {
  const shimmerBg: CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '200% 100%',
    animation: 'paid-shimmer 1.5s ease-in-out infinite',
  }

  return (
    <div style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 14, borderBottom: '2px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', ...shimmerBg }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ width: 48, height: 12, ...shimmerBg }} />
          <div style={{ width: 80, height: 8, ...shimmerBg }} />
        </div>
      </div>
      <div style={{ width: 48, height: 12, ...shimmerBg }} />
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────

export function PaymentDrawer({
  open,
  title,
  subtitle,
  amountUsd,
  amountDisplay,
  recipient,
  refundAddress,
  walletAddress,
  receiptTheme = 'light',
  metadata,
  calldata,
  destinationContract,
  onSendTransaction,
  onComplete,
  onBounced,
  onError,
  onClose,
}: PaymentDrawerProps) {
  const { client } = usePaidContext()

  const [view, setView] = useState<View>('loading')
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokensLoading, setTokensLoading] = useState(false)
  const [tokenPage, setTokenPage] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [depositAddress, setDepositAddress] = useState<string | null>(null)
  const [depositState, setDepositState] = useState<'idle' | 'creating' | 'awaiting' | 'sending' | 'polling' | 'completed' | 'bounced' | 'expired' | 'error'>('idle')
  const [statusData, setStatusData] = useState<SessionStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completedAt, setCompletedAt] = useState(() => new Date())

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevOpenRef = useRef(open)
  const animatedViewsRef = useRef<Set<string>>(new Set())

  const effectiveAmountDisplay = amountDisplay ?? (amountUsd != null ? `$${amountUsd.toFixed(2)}` : undefined)

  // Track which view has already played its entrance animation
  const shouldSkipEntrance = (viewKey: string) => {
    if (animatedViewsRef.current.has(viewKey)) return true
    animatedViewsRef.current.add(viewKey)
    return false
  }

  // ─── Cleanup on close ──────────────────────────────────────────────

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      setView('loading')
      setTokens([])
      setSelectedToken(null)
      setTokenError(null)
      setTokensLoading(false)
      setTokenPage(0)
      setSessionId(null)
      setDepositAddress(null)
      setDepositState('idle')
      setStatusData(null)
      setError(null)
      setCompletedAt(new Date())
      animatedViewsRef.current.clear()
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    prevOpenRef.current = open
  }, [open])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ─── Auto-start session when drawer opens ──────────────────────────

  useEffect(() => {
    if (!open || depositState !== 'idle') return

    const createSession = async () => {
      setDepositState('creating')
      try {
        const session = await client.createSession({
          recipient,
          refundAddress: refundAddress ?? recipient,
          amountUsd,
          metadata,
          calldata,
          destinationContract,
        })
        setSessionId(session.sessionId)
        setDepositAddress(session.depositAddress)
        setDepositState('awaiting')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create session'
        setError(msg)
        setDepositState('error')
        onError?.(msg)
      }
    }

    createSession()
  }, [open, depositState, client, recipient, refundAddress, amountUsd, metadata, onError])

  // ─── Fetch tokens once session is ready ────────────────────────────

  useEffect(() => {
    if (depositState !== 'awaiting' || !sessionId || !walletAddress) return
    if (tokens.length > 0) return

    const fetchTokens = async () => {
      try {
        setTokenError(null)
        setTokensLoading(true)
        const raw = await client.getWalletTokens(sessionId, walletAddress)

        const data: TokenInfo[] = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as Record<string, unknown>)?.tokens)
            ? (raw as unknown as { tokens: TokenInfo[] }).tokens
            : []

        let sorted = data
          .filter((t) => parseFloat(t.balanceUnits) > 0)
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .slice(0, 6)

        if (amountUsd != null) {
          sorted = sorted.filter((t) => {
            if (t.rateUsdPerUnit <= 0) return false
            const sendAmount = PaidClient.computePayAmount(amountUsd, t)
            return parseFloat(t.balanceUnits) >= parseFloat(sendAmount)
          })
        }

        setTokens(sorted)
        setTokensLoading(false)

        if (sorted.length === 1) {
          handlePay(sorted[0])
          return
        }

        setView('select_token')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch tokens'
        setTokenError(msg)
        setTokensLoading(false)
        setView('select_token')
      }
    }

    fetchTokens()
  }, [depositState, sessionId, walletAddress, tokens.length, amountUsd, client])

  // ─── Status polling ────────────────────────────────────────────────

  const startPolling = useCallback((sid: string, interval: number) => {
    if (pollRef.current) clearInterval(pollRef.current)

    const poll = async () => {
      try {
        const status = await client.getStatus(sid)
        setStatusData(status)

        if (status.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current)
          setDepositState('completed')
          setView('result')
          setCompletedAt(new Date())
          onComplete?.({
            sessionId: status.sessionId,
            status: 'completed',
            txHash: status.destination?.txHash ?? null,
            source: status.source,
            destination: status.destination,
            completedAt: new Date(),
          })
        } else if (status.status === 'bounced') {
          if (pollRef.current) clearInterval(pollRef.current)
          setDepositState('bounced')
          setView('result')
          onBounced?.({
            sessionId: status.sessionId,
            status: 'bounced',
            txHash: null,
            source: status.source,
            destination: status.destination,
            completedAt: new Date(),
          })
        } else if (status.status === 'expired') {
          if (pollRef.current) clearInterval(pollRef.current)
          setDepositState('expired')
          setView('result')
        }
      } catch {
        // silently retry
      }
    }

    pollRef.current = setInterval(poll, interval)
    poll()
  }, [client, onComplete, onBounced])

  // ─── Payment handler ───────────────────────────────────────────────

  const handlePay = useCallback(async (token: TokenInfo) => {
    if (!onSendTransaction || !depositAddress) return

    setSelectedToken(token)
    setView('confirming')
    setDepositState('sending')

    const isNative = token.tokenAddress.toLowerCase() === NATIVE_TOKEN

    let amount: string
    if (amountUsd != null) {
      amount = PaidClient.computePayAmount(amountUsd, token)
    } else {
      amount = token.balanceUnits
    }

    try {
      await onSendTransaction({
        token,
        amount,
        depositAddress,
        isNative,
      })

      setDepositState('polling')
      if (sessionId) {
        startPolling(sessionId, 1000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'

      // User cancellation → return to token select instead of error view
      if (isUserCancellation(msg)) {
        setSelectedToken(null)
        setDepositState('awaiting')
        setView('select_token')
        return
      }

      setError(msg)
      setDepositState('error')
      setView('result')
      onError?.(msg)
    }
  }, [onSendTransaction, depositAddress, amountUsd, sessionId, startPolling, onError])

  // ─── Retry handler ────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setTokens([])
    setSelectedToken(null)
    setTokenError(null)
    setTokensLoading(false)
    setTokenPage(0)
    setView('loading')
    setDepositState('idle')
    setError(null)
    setStatusData(null)
    animatedViewsRef.current.clear()
  }, [])

  // ─── Don't render when closed ─────────────────────────────────────

  if (!open) return null

  const canClose = !['sending', 'polling'].includes(depositState)
  const handleBackdrop = () => { if (canClose) onClose?.() }

  // Determine active view key (snap to result if terminal state during confirming)
  const activeViewKey: View =
    (view === 'confirming' && ['completed', 'bounced', 'expired', 'error'].includes(depositState))
      ? 'result'
      : view

  const isSuccessReceipt = activeViewKey === 'result' && depositState === 'completed'
  const containerStyle = isSuccessReceipt ? RECEIPT_CONTAINER : CONTAINER

  // ─── Overlay wrapper ──────────────────────────────────────────────

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  }

  const backdropStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(2px)',
  }

  const drawerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    maxWidth: 448,
    maxHeight: '90dvh',
    overflowY: 'auto',
  }

  // ─── View renderers ───────────────────────────────────────────────

  const renderLoading = () => {
    return (
      <M
        key="loading"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
      >
        <DrawerHeader title={title} subtitle={subtitle} />
        {effectiveAmountDisplay && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
              {effectiveAmountDisplay}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
          <M
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <BoltIcon size="lg" color="white" />
          </M>
          <M
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {depositState === 'creating' ? 'SETTING UP...' : 'FINDING OPTIONS...'}
          </M>
        </div>
        <PoweredByFooter />
      </M>
    )
  }

  const renderTokenSelection = () => {
    const skip = shouldSkipEntrance('select_token')
    return (
      <M
        key="select_token"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
        initial={skip ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <DrawerHeader title={title} subtitle={subtitle} />
        {effectiveAmountDisplay && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
              {effectiveAmountDisplay}
            </p>
          </div>
        )}

        {tokenError ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
            <M
              style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <span style={{ color: '#ff0000', fontSize: 24 }}>!</span>
            </M>
            <p style={{ color: '#ff0000', fontSize: '0.75rem', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>
              {tokenError}
            </p>
            <PaidButton variant="danger" onClick={handleRetry}>Try again</PaidButton>
          </div>
        ) : tokens.length === 0 ? (
          tokensLoading ? (
            /* Skeleton loading state */
            <>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center', ...mono }}>
                Pay with
              </p>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <SkeletonTokenRow />
                <SkeletonTokenRow />
                <SkeletonTokenRow />
              </div>
            </>
          ) : (
            /* Empty state — no qualifying tokens */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
              <div style={{ width: 56, height: 56, border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 24 }}>$</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>
                  {amountUsd != null ? 'Insufficient balance' : 'No tokens found'}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', ...mono }}>
                  {amountUsd != null
                    ? 'None of your tokens can cover this payment.'
                    : 'No tokens with balance were found in your wallet.'}
                </p>
              </div>
              {onClose && <PaidButton onClick={onClose}>Close</PaidButton>}
            </div>
          )
        ) : (
          /* Token list — paginated: 3 per page + nav row */
          (() => {
            const TOKENS_PER_PAGE = 3
            const pageTokens = tokens.slice(tokenPage * TOKENS_PER_PAGE, tokenPage * TOKENS_PER_PAGE + TOKENS_PER_PAGE)
            const hasMore = tokens.length > TOKENS_PER_PAGE && tokenPage === 0
            const hasBack = tokenPage > 0

            return (
              <>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center', ...mono }}>
                  Pay with
                </p>
                <M
                  key={`token-page-${tokenPage}`}
                  style={{ display: 'flex', flexDirection: 'column' }}
                  variants={paidStagger}
                  initial="initial"
                  animate="animate"
                >
                  {pageTokens.map((token, index) => {
                    const tokenCost = amountUsd != null
                      ? PaidClient.computePayAmount(amountUsd, token)
                      : null

                    return (
                      <M
                        tag="button"
                        key={`${token.chainId}-${token.tokenAddress}`}
                        onClick={() => handlePay(token)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 14,
                          backgroundColor: 'transparent',
                          color: '#fff',
                          cursor: 'pointer',
                          border: 'none',
                          borderBottom: '2px solid rgba(255,255,255,0.1)',
                          transition: 'background-color 0.15s',
                        }}
                        variants={paidFadeIn}
                        transition={{ duration: 0.3, delay: index * 0.08 }}
                        whileTap={{ scale: 0.97 }}
                        onMouseEnter={(e: React.MouseEvent) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)'
                        }}
                        onMouseLeave={(e: React.MouseEvent) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <TokenLogo token={token} size={40} />
                          <div style={{ textAlign: 'left' }}>
                            <p style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, ...mono }}>{token.symbol}</p>
                            <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.3)', margin: 0, ...mono }}>
                              {tokenCost
                                ? `~${formatTokenAmount(tokenCost, token.symbol, token.decimals)} ${token.symbol}`
                                : `${formatBalance(token.balanceUnits, token.decimals)} available`}
                            </p>
                          </div>
                        </div>
                        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)', margin: 0, ...mono }}>
                          {formatUsd(token.balanceUsd)}
                        </p>
                      </M>
                    )
                  })}

                  {/* More options nav row */}
                  {hasMore && (
                    <M
                      tag="button"
                      onClick={() => setTokenPage(1)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                        border: 'none', transition: 'background-color 0.15s',
                      }}
                      variants={paidFadeIn}
                      transition={{ duration: 0.3, delay: pageTokens.length * 0.08 }}
                      whileTap={{ scale: 0.97 }}
                      onMouseEnter={(e: React.MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)'
                      }}
                      onMouseLeave={(e: React.MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, border: '2px solid rgba(255,255,255,0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>&#8250;</span>
                        </div>
                        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: 0, ...mono }}>More options</p>
                      </div>
                      <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.2)', margin: 0, ...mono }}>
                        {tokens.length - TOKENS_PER_PAGE} more
                      </p>
                    </M>
                  )}

                  {/* Back nav row */}
                  {hasBack && (
                    <M
                      tag="button"
                      onClick={() => setTokenPage(0)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                        border: 'none', transition: 'background-color 0.15s',
                      }}
                      variants={paidFadeIn}
                      transition={{ duration: 0.3, delay: pageTokens.length * 0.08 }}
                      whileTap={{ scale: 0.97 }}
                      onMouseEnter={(e: React.MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)'
                      }}
                      onMouseLeave={(e: React.MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, border: '2px solid rgba(255,255,255,0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>&#8249;</span>
                        </div>
                        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: 0, ...mono }}>Back</p>
                      </div>
                    </M>
                  )}
                </M>
              </>
            )
          })()
        )}

        <PoweredByFooter />
      </M>
    )
  }

  const renderConfirming = () => {
    const skip = shouldSkipEntrance('confirming')
    return (
      <M
        key="confirming"
        style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}
        initial={skip ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BoltIcon size="sm" color="white" />
          <span style={{ fontSize: '1.125rem', color: '#fff', ...brand }}>PAID</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
          {/* Pulsing bolt */}
          <M
            animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <BoltIcon size="lg" color="white" />
          </M>
          {effectiveAmountDisplay && (
            <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
              {effectiveAmountDisplay}
            </p>
          )}
          {selectedToken && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', border: '2px solid rgba(255,255,255,0.2)' }}>
              <TokenLogo token={selectedToken} size={24} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', ...mono }}>
                {amountUsd != null
                  ? `~${formatTokenAmount(PaidClient.computePayAmount(amountUsd, selectedToken), selectedToken.symbol, selectedToken.decimals)} ${selectedToken.symbol}`
                  : selectedToken.symbol}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}>
              {depositState === 'sending' ? 'CONFIRM IN WALLET' : 'PROCESSING...'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[0, 1, 2].map((i) =>
                motion ? (
                  <motion.div
                    key={i}
                    style={{ width: 6, height: 6, backgroundColor: 'rgba(255,255,255,0.6)' }}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
                  />
                ) : (
                  <div
                    key={i}
                    style={{
                      width: 6, height: 6,
                      backgroundColor: 'rgba(255,255,255,0.6)',
                      animation: `paid-pulse 1s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                )
              )}
            </div>
          </div>
        </div>
        <PoweredByFooter />
      </M>
    )
  }

  const renderResult = () => {
    return (
      <M
        key="result"
        style={{ display: 'flex', flexDirection: 'column' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* SUCCESS RECEIPT */}
        {depositState === 'completed' && (() => {
          const ink = receiptTheme === 'light' ? '#000' : '#fff'
          const paper = receiptTheme === 'light' ? '#fff' : '#000'
          const muted = '#888'
          const borderColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'
          const dividerColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
          const stampBorder = receiptTheme === 'light' ? '#000' : '#fff'

          const srcSymbol = statusData?.source?.tokenSymbol || selectedToken?.symbol || '—'
          const rawSrcAmount = statusData?.source?.amountUnits
            || (amountUsd != null && selectedToken ? PaidClient.computePayAmount(amountUsd, selectedToken) : null)
          const srcAmount = rawSrcAmount ? formatTokenAmount(rawSrcAmount, srcSymbol, selectedToken?.decimals) : '—'
          const srcUsd = statusData?.source?.usdValue
            ? `$${parseFloat(statusData.source.usdValue).toFixed(2)}`
            : (amountUsd != null ? `$${amountUsd.toFixed(2)}` : effectiveAmountDisplay || '—')
          const receiptId = sessionId ? sessionId.slice(0, 8) : '—'
          const timestamp = completedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

          // Received row: show when dest token differs from source
          const destData = statusData?.destination
          const showReceivedRow = destData?.amountUnits && destData.tokenSymbol !== srcSymbol

          return (
            <M
              style={{ display: 'flex', flexDirection: 'column', backgroundColor: paper, color: ink }}
              variants={paidFadeIn}
              initial="initial"
              animate="animate"
            >
              <div style={{ padding: '20px 20px 0' }}>
                <M
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <BoltIcon size="sm" color={receiptTheme === 'light' ? 'black' : 'white'} />
                  <span style={{ fontSize: '1.25rem', ...brand, color: ink }}>PAID</span>
                </M>
                <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>
                  Receipt #{receiptId}
                </p>
                <p style={{ fontSize: '0.625rem', marginTop: 4, color: muted, ...mono }}>
                  {timestamp}
                </p>
              </div>

              <div style={{ padding: '12px 20px' }}>
                <div style={{ borderTop: `1px dashed ${borderColor}` }} />
              </div>

              <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', margin: 0, ...mono, color: ink }}>{title}</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, ...mono, color: ink }}>{effectiveAmountDisplay || srcUsd}</p>
              </div>

              <div style={{ padding: '12px 20px' }}>
                <div style={{ borderTop: `1px dashed ${borderColor}` }} />
              </div>

              {/* Receipt detail rows with stagger */}
              <M
                style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}
                variants={paidStagger}
                initial="initial"
                animate="animate"
              >
                <M style={{ display: 'flex', justifyContent: 'space-between' }} variants={paidFadeIn}>
                  <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Token</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcSymbol}</span>
                </M>
                <M style={{ display: 'flex', justifyContent: 'space-between' }} variants={paidFadeIn}>
                  <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Amount</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcAmount}</span>
                </M>
                <M style={{ display: 'flex', justifyContent: 'space-between' }} variants={paidFadeIn}>
                  <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Total</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcUsd}</span>
                </M>
                {/* Received row — when dest token differs from source */}
                {showReceivedRow && (
                  <M style={{ display: 'flex', justifyContent: 'space-between' }} variants={paidFadeIn}>
                    <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Received</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>
                      {formatTokenAmount(destData!.amountUnits!, destData!.tokenSymbol)} {destData!.tokenSymbol}
                    </span>
                  </M>
                )}
              </M>

              <div style={{ padding: '16px 20px' }}>
                <div style={{ borderTop: `3px solid ${dividerColor}` }} />
              </div>

              {/* PAID stamp with spring animation */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <M
                  style={{ padding: '12px 32px', border: `3px solid ${stampBorder}` }}
                  variants={paidStamp}
                  initial="initial"
                  animate="animate"
                >
                  <span style={{ fontSize: '2.25rem', letterSpacing: '0.05em', ...brand, color: ink }}>PAID</span>
                </M>
              </div>

              {/* Footer */}
              <PoweredByFooter color={receiptTheme === 'light' ? 'black' : 'white'} />

              {onClose && (
                <div style={{ padding: '0 20px 20px' }}>
                  {motion ? (
                    <motion.button
                      onClick={onClose}
                      style={{
                        width: '100%', padding: '12px 24px', border: `2px solid ${ink}`,
                        fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.05em', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', cursor: 'pointer',
                        backgroundColor: ink, color: paper, ...mono,
                      }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6, duration: 0.3 }}
                      whileHover={{ x: -2, y: -2, boxShadow: `4px 4px 0px ${ink}` }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Done
                    </motion.button>
                  ) : (
                    <button
                      onClick={onClose}
                      style={{
                        width: '100%', padding: '12px 24px', border: `2px solid ${ink}`,
                        fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.05em', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', cursor: 'pointer',
                        backgroundColor: ink, color: paper, ...mono,
                      }}
                    >
                      Done
                    </button>
                  )}
                </div>
              )}
            </M>
          )
        })()}

        {/* BOUNCED */}
        {depositState === 'bounced' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
            <M
              style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
            </M>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Payment bounced</p>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', ...mono }}>The payment was returned. Try again.</p>
            </div>
            <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
            <PoweredByFooter />
          </div>
        )}

        {/* EXPIRED */}
        {depositState === 'expired' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
            <M
              style={{ width: 56, height: 56, border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 26 }}>!</span>
            </M>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Session expired</p>
            <PaidButton onClick={handleRetry}>Try again</PaidButton>
            <PoweredByFooter />
          </div>
        )}

        {/* ERROR */}
        {depositState === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
            <M
              style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
            </M>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Something went wrong</p>
              {error && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', padding: '0 16px', ...mono }}>{error}</p>}
            </div>
            <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
            <PoweredByFooter />
          </div>
        )}
      </M>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────

  const viewContent = (
    <>
      {activeViewKey === 'loading' && renderLoading()}
      {activeViewKey === 'select_token' && renderTokenSelection()}
      {activeViewKey === 'confirming' && renderConfirming()}
      {activeViewKey === 'result' && renderResult()}
    </>
  )

  // With framer-motion: full animated overlay
  if (motion && AnimatePresence) {
    return createPortal(
      <AnimatePresence>
        {open && (
          <motion.div style={overlayStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              style={backdropStyle}
              onClick={handleBackdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              style={drawerStyle}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
                <div style={containerStyle}>
                  <AnimatePresence mode="wait">
                    {viewContent}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    )
  }

  // Without framer-motion: static overlay
  return createPortal(
    <div style={overlayStyle}>
      <div style={backdropStyle} onClick={handleBackdrop} />
      <div style={drawerStyle}>
        <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
          <div style={containerStyle}>
            {viewContent}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
