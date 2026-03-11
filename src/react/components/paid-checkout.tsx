import {
  useState,
  useCallback,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { PaidClient } from '../../core/client'
import type {
  TokenInfo,
  PaymentReceipt,
  Address,
  Hex,
} from '../../core/types'
import { usePaidPayment, type UsePaidPaymentOptions } from '../hooks/use-paid-payment'
import { BoltIcon } from './bolt-icon'

// ─── Optional framer-motion import ─────────────────────────────────────────

type MotionType = typeof import('framer-motion').motion
type AnimatePresenceType = typeof import('framer-motion').AnimatePresence

let motion: MotionType | undefined
let AnimatePresence: AnimatePresenceType | undefined

try {
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

export interface PaidCheckoutProps {
  /** Payment title shown in the drawer header. */
  title: string
  /** Optional subtitle. */
  subtitle?: string
  /** USD amount to charge. */
  amountUsd?: number
  /** Raw token amount (wei string). Use instead of amountUsd for exact amounts. */
  amountRaw?: string
  /** Display string for the amount (e.g. "$25.00"). Auto-generated from amountUsd if omitted. */
  amountDisplay?: string
  /** Recipient address. */
  recipient: Address
  /** Refund address. Defaults to recipient. */
  refundAddress?: Address
  /** Receipt color theme. */
  receiptTheme?: 'light' | 'dark'
  /** Arbitrary metadata attached to the session. */
  metadata?: Record<string, string>
  /** Optional calldata to execute on the destination contract after swap. */
  calldata?: Hex
  /** Contract address to receive the sweep (used with calldata). */
  destinationContract?: Address
  /** Called when the payment completes successfully. */
  onComplete?: (receipt: PaymentReceipt) => void
  /** Called when the payment bounces. */
  onBounced?: (receipt: PaymentReceipt) => void
  /** Called on any error. */
  onError?: (error: string) => void
  /** Trigger element — clicked to open the payment drawer. */
  children: ReactNode
  /** If true, opens the drawer immediately on mount. */
  defaultOpen?: boolean
  /** Controlled open state. */
  open?: boolean
  /** Called when drawer open state changes. */
  onOpenChange?: (open: boolean) => void
  /** Override the default wagmi transaction sender. */
  sendTransaction?: UsePaidPaymentOptions['sendTransaction']
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

// ─── Motion-aware wrapper ──────────────────────────────────────────────────

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
        style={{ ...base, transform: undefined, boxShadow: undefined }}
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
    <button onClick={onClick} style={base} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
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
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, border: '2px solid rgba(255,255,255,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <span style={{ fontSize: size * 0.35, fontWeight: 700, color: 'rgba(255,255,255,0.6)', ...mono }}>
        {token.symbol.slice(0, 3)}
      </span>
    </div>
  )
}


function PoweredByFooter({ color = 'white' }: { color?: 'white' | 'black' }) {
  const muted = color === 'white' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0 16px' }}>
      <BoltIcon size="sm" color={color} />
      <span style={{ fontSize: '0.625rem', letterSpacing: '0.05em', color: muted, ...mono }}>
        Powered by PAID
      </span>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────

export function PaidCheckout({
  title,
  subtitle,
  amountUsd,
  amountRaw,
  amountDisplay,
  recipient,
  refundAddress,
  receiptTheme = 'light',
  metadata,
  calldata,
  destinationContract,
  onComplete,
  onBounced,
  onError,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  sendTransaction,
}: PaidCheckoutProps) {
  // ─── Drawer state ─────────────────────────────────────────────────
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const drawerOpen = isControlled ? controlledOpen : internalOpen

  const setDrawerOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  // ─── Payment hook ─────────────────────────────────────────────────
  const payment = usePaidPayment({
    recipient,
    amountUsd,
    amountRaw,
    refundAddress,
    metadata,
    calldata,
    destinationContract,
    sendTransaction,
    onComplete: (receipt) => {
      onComplete?.(receipt)
    },
    onBounced: (receipt) => {
      onBounced?.(receipt)
    },
    onExpired: () => {
      // Handled via state rendering
    },
    onError: (error) => {
      onError?.(error)
    },
  })

  // ─── Token pagination ─────────────────────────────────────────────
  const [tokenPage, setTokenPage] = useState(0)
  const TOKENS_PER_PAGE = 3

  // ─── Trigger click handler ────────────────────────────────────────
  const handleTriggerClick = useCallback(() => {
    setDrawerOpen(true)
    payment.start()
    setTokenPage(0)
  }, [setDrawerOpen, payment])

  // ─── Auto-select single token ─────────────────────────────────────
  const autoSelectedRef = useState<boolean>(false)
  if (payment.state === 'awaiting_selection' && payment.tokens.length === 1 && !autoSelectedRef[0]) {
    autoSelectedRef[1](true)
    payment.pay(payment.tokens[0])
  }
  // Reset auto-select flag when returning to idle
  if (payment.state === 'idle' && autoSelectedRef[0]) {
    autoSelectedRef[1](false)
  }

  // ─── Close handler ────────────────────────────────────────────────
  const canClose = !['confirming', 'polling'].includes(payment.state)
  const handleClose = useCallback(() => {
    if (!canClose) return
    setDrawerOpen(false)
    payment.reset()
    setTokenPage(0)
    autoSelectedRef[1](false)
  }, [canClose, setDrawerOpen, payment, autoSelectedRef])

  const handleRetry = useCallback(() => {
    payment.reset()
    setTokenPage(0)
    autoSelectedRef[1](false)
    payment.start()
  }, [payment, autoSelectedRef])

  // ─── Computed values ──────────────────────────────────────────────
  const effectiveAmountDisplay = amountDisplay ?? (amountUsd != null ? `$${amountUsd.toFixed(2)}` : undefined)

  // ─── Trigger element ──────────────────────────────────────────────
  let trigger: ReactNode = children
  if (isValidElement(children)) {
    const originalOnClick = (children as ReactElement<{ onClick?: (...args: unknown[]) => void }>).props.onClick
    trigger = cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: (...args: unknown[]) => {
        originalOnClick?.(...args)
        handleTriggerClick()
      },
    })
  } else {
    trigger = <span onClick={handleTriggerClick} style={{ cursor: 'pointer' }}>{children}</span>
  }

  // ─── View determination ───────────────────────────────────────────
  type View = 'loading' | 'select_token' | 'confirming' | 'result'
  let activeView: View = 'loading'
  if (payment.state === 'awaiting_selection') activeView = 'select_token'
  else if (payment.state === 'confirming' || payment.state === 'polling') activeView = 'confirming'
  else if (['completed', 'bounced', 'expired', 'error'].includes(payment.state)) activeView = 'result'

  const isSuccessReceipt = activeView === 'result' && payment.state === 'completed'
  const containerStyle = isSuccessReceipt ? RECEIPT_CONTAINER : CONTAINER

  // ─── View renderers ───────────────────────────────────────────────

  const renderLoading = () => (
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
        <M animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}>
          <BoltIcon size="lg" color="white" />
        </M>
        <M
          style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          FINDING OPTIONS...
        </M>
      </div>
      <PoweredByFooter />
    </M>
  )

  const renderTokenSelection = () => {
    const pageTokens = payment.tokens.slice(tokenPage * TOKENS_PER_PAGE, tokenPage * TOKENS_PER_PAGE + TOKENS_PER_PAGE)
    const hasMore = payment.tokens.length > TOKENS_PER_PAGE && tokenPage === 0
    const hasBack = tokenPage > 0

    return (
      <M
        key="select_token"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
        initial={{ opacity: 0, y: 10 }}
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

        {payment.tokens.length === 0 ? (
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
            <PaidButton onClick={handleClose}>Close</PaidButton>
          </div>
        ) : (
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
                const tokenCost = amountUsd != null && payment.feeConfig
                  ? PaidClient.computePayAmountWithFee(amountUsd, token, payment.feeConfig)
                  : (amountUsd != null ? PaidClient.computePayAmount(amountUsd, token) : null)
                return (
                  <M
                    tag="button"
                    key={`${token.chainId}-${token.tokenAddress}`}
                    onClick={() => payment.pay(token)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                      border: 'none', borderBottom: '2px solid rgba(255,255,255,0.1)', transition: 'background-color 0.15s',
                    }}
                    variants={paidFadeIn}
                    transition={{ duration: 0.3, delay: index * 0.08 }}
                    whileTap={{ scale: 0.97 }}
                    onMouseEnter={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
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
                  onMouseEnter={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, border: '2px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>&#8250;</span>
                    </div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: 0, ...mono }}>More options</p>
                  </div>
                  <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.2)', margin: 0, ...mono }}>
                    {payment.tokens.length - TOKENS_PER_PAGE} more
                  </p>
                </M>
              )}

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
                  onMouseEnter={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, border: '2px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>&#8249;</span>
                    </div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: 0, ...mono }}>Back</p>
                  </div>
                </M>
              )}
            </M>
          </>
        )}

        <PoweredByFooter />
      </M>
    )
  }

  const renderConfirming = () => (
    <M
      key="confirming"
      style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BoltIcon size="sm" color="white" />
        <span style={{ fontSize: '1.125rem', color: '#fff', ...brand }}>PAID</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
        <M animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}>
          <BoltIcon size="lg" color="white" />
        </M>
        {effectiveAmountDisplay && (
          <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
            {effectiveAmountDisplay}
          </p>
        )}
        {payment.selectedToken && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', border: '2px solid rgba(255,255,255,0.2)' }}>
            <TokenLogo token={payment.selectedToken} size={24} />
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', ...mono }}>
              {amountUsd != null
                ? `~${formatTokenAmount(PaidClient.computePayAmount(amountUsd, payment.selectedToken), payment.selectedToken.symbol, payment.selectedToken.decimals)} ${payment.selectedToken.symbol}`
                : payment.selectedToken.symbol}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}>
            {payment.state === 'confirming' ? 'CONFIRM IN WALLET' : 'PROCESSING...'}
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
                    width: 6, height: 6, backgroundColor: 'rgba(255,255,255,0.6)',
                    animation: `paid-pulse 1s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ),
            )}
          </div>
        </div>
      </div>
      <PoweredByFooter />
    </M>
  )

  const renderResult = () => {
    // ── Success receipt ──
    if (payment.state === 'completed') {
      const ink = receiptTheme === 'light' ? '#000' : '#fff'
      const paper = receiptTheme === 'light' ? '#fff' : '#000'
      const muted = '#888'
      const borderColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'
      const dividerColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
      const stampBorder = receiptTheme === 'light' ? '#000' : '#fff'

      const srcSymbol = payment.statusData?.source?.tokenSymbol || payment.selectedToken?.symbol || '—'
      const rawSrcAmount = payment.statusData?.source?.amountUnits
        || (amountUsd != null && payment.selectedToken ? PaidClient.computePayAmount(amountUsd, payment.selectedToken) : null)
      const srcAmount = rawSrcAmount ? formatTokenAmount(rawSrcAmount, srcSymbol, payment.selectedToken?.decimals) : '—'
      const srcUsd = payment.statusData?.source?.usdValue
        ? `$${parseFloat(payment.statusData.source.usdValue).toFixed(2)}`
        : (amountUsd != null ? `$${amountUsd.toFixed(2)}` : effectiveAmountDisplay || '—')
      const receiptId = payment.sessionId ? payment.sessionId.slice(0, 8) : '—'
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

      const destData = payment.statusData?.destination
      const showReceivedRow = destData?.amountUnits && destData.tokenSymbol !== srcSymbol

      return (
        <M key="result" style={{ display: 'flex', flexDirection: 'column' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <M style={{ display: 'flex', flexDirection: 'column', backgroundColor: paper, color: ink }} variants={paidFadeIn} initial="initial" animate="animate">
            <div style={{ padding: '20px 20px 0' }}>
              <M style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
                <BoltIcon size="sm" color={receiptTheme === 'light' ? 'black' : 'white'} />
                <span style={{ fontSize: '1.25rem', ...brand, color: ink }}>PAID</span>
              </M>
              <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>
                Receipt #{receiptId}
              </p>
              <p style={{ fontSize: '0.625rem', marginTop: 4, color: muted, ...mono }}>{timestamp}</p>
            </div>

            <div style={{ padding: '12px 20px' }}><div style={{ borderTop: `1px dashed ${borderColor}` }} /></div>

            <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', margin: 0, ...mono, color: ink }}>{title}</p>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, ...mono, color: ink }}>{effectiveAmountDisplay || srcUsd}</p>
            </div>

            <div style={{ padding: '12px 20px' }}><div style={{ borderTop: `1px dashed ${borderColor}` }} /></div>

            <M style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }} variants={paidStagger} initial="initial" animate="animate">
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
              {showReceivedRow && (
                <M style={{ display: 'flex', justifyContent: 'space-between' }} variants={paidFadeIn}>
                  <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Received</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>
                    {formatTokenAmount(destData!.amountUnits!, destData!.tokenSymbol)} {destData!.tokenSymbol}
                  </span>
                </M>
              )}
            </M>

            <div style={{ padding: '16px 20px' }}><div style={{ borderTop: `3px solid ${dividerColor}` }} /></div>

            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
              <M style={{ padding: '12px 32px', border: `3px solid ${stampBorder}` }} variants={paidStamp} initial="initial" animate="animate">
                <span style={{ fontSize: '2.25rem', letterSpacing: '0.05em', ...brand, color: ink }}>PAID</span>
              </M>
            </div>

            <PoweredByFooter color={receiptTheme === 'light' ? 'black' : 'white'} />

            <div style={{ padding: '0 20px 20px' }}>
              {motion ? (
                <motion.button
                  onClick={handleClose}
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
                  onClick={handleClose}
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
          </M>
        </M>
      )
    }

    // ── Bounced ──
    if (payment.state === 'bounced') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
          <M style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
          </M>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Payment bounced</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', ...mono }}>The payment was returned. Try again.</p>
          </div>
          <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
          <PoweredByFooter />
        </div>
      )
    }

    // ── Expired ──
    if (payment.state === 'expired') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
          <M style={{ width: 56, height: 56, border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 26 }}>!</span>
          </M>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Session expired</p>
          <PaidButton onClick={handleRetry}>Try again</PaidButton>
          <PoweredByFooter />
        </div>
      )
    }

    // ── Error ──
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
        <M style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
          <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
        </M>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Something went wrong</p>
          {payment.error && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', padding: '0 16px', ...mono }}>{payment.error}</p>}
        </div>
        <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
        <PoweredByFooter />
      </div>
    )
  }

  // ─── Overlay / Portal ─────────────────────────────────────────────

  if (!drawerOpen) return <>{trigger}</>

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 99999,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  }

  const backdropStyle: CSSProperties = {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
  }

  const drawerStyle: CSSProperties = {
    position: 'relative', width: '100%', maxWidth: 448, maxHeight: '90dvh', overflowY: 'auto',
  }

  const viewContent = (
    <>
      {activeView === 'loading' && renderLoading()}
      {activeView === 'select_token' && renderTokenSelection()}
      {activeView === 'confirming' && renderConfirming()}
      {activeView === 'result' && renderResult()}
    </>
  )

  const drawer = motion && AnimatePresence ? (
    <AnimatePresence>
      {drawerOpen && (
        <motion.div style={overlayStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div style={backdropStyle} onClick={canClose ? handleClose : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div style={drawerStyle} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>
            <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
              <div style={containerStyle}>
                <AnimatePresence mode="wait">{viewContent}</AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  ) : (
    <div style={overlayStyle}>
      <div style={backdropStyle} onClick={canClose ? handleClose : undefined} />
      <div style={drawerStyle}>
        <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
          <div style={containerStyle}>{viewContent}</div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {trigger}
      {createPortal(drawer, document.body)}
    </>
  )
}
