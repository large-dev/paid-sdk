import {
  useState,
  useCallback,
  useEffect,
  useRef,
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
  receiptTheme: _receiptTheme = 'light',
  metadata: _metadata,
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

  // Drawer mount / animation state
  const [mounted, setMounted] = useState(drawerOpen)
  const [animClass, setAnimClass] = useState('')
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (closingTimer.current) clearTimeout(closingTimer.current)
    if (drawerOpen) {
      setMounted(true)
      // Double rAF to ensure DOM is painted before adding class
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimClass('open')))
    } else {
      setAnimClass('')
      closingTimer.current = setTimeout(() => setMounted(false), 350)
    }
    return () => { if (closingTimer.current) clearTimeout(closingTimer.current) }
  }, [drawerOpen])

  // ─── Payment hook ─────────────────────────────────────────────────
  const payment = usePaidPayment({
    recipient,
    amountUsd,
    amountRaw,
    refundAddress,
    metadata: _metadata,
    calldata,
    destinationContract,
    sendTransaction,
    onComplete: (receipt) => { onComplete?.(receipt) },
    onBounced: (receipt) => { onBounced?.(receipt) },
    onExpired: () => {},
    onError: (error) => { onError?.(error) },
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

  // ─── Auto-close on success ────────────────────────────────────────
  useEffect(() => {
    if (payment.state !== 'completed') return
    const timer = setTimeout(() => {
      setDrawerOpen(false)
      payment.reset()
      setTokenPage(0)
      autoSelectedRef[1](false)
    }, 1200)
    return () => clearTimeout(timer)
  }, [payment.state]) // eslint-disable-line react-hooks/exhaustive-deps

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
  else if (payment.state === 'confirming' || payment.state === 'polling' || payment.state === 'completed') activeView = 'confirming'
  else if (['bounced', 'expired', 'error'].includes(payment.state)) activeView = 'result'

  // ─── Shared values ────────────────────────────────────────────────
  const pendingTokenAmount = payment.selectedToken && amountUsd != null
    ? `${formatTokenAmount(PaidClient.computePayAmount(amountUsd, payment.selectedToken), payment.selectedToken.symbol, payment.selectedToken.decimals)} ${payment.selectedToken.symbol}`
    : payment.selectedToken?.symbol ?? ''

  const isSuccess = payment.state === 'completed'

  // ─── View renderers ───────────────────────────────────────────────

  const renderLoading = () => (
    <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      <DrawerHeader title={title} subtitle={subtitle} />
      {effectiveAmountDisplay && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
            {effectiveAmountDisplay}
          </p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
        <div style={{ animation: 'paid-bolt-pulse 2s ease-in-out infinite' }}>
          <BoltIcon size="lg" color="white" />
        </div>
        <p style={{
          color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem',
          textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0,
          animation: 'paid-bolt-pulse 2s ease-in-out infinite',
          ...mono,
        }}>
          FINDING OPTIONS...
        </p>
      </div>
      <PoweredByFooter />
    </div>
  )

  const renderTokenSelection = () => {
    const pageTokens = payment.tokens.slice(tokenPage * TOKENS_PER_PAGE, tokenPage * TOKENS_PER_PAGE + TOKENS_PER_PAGE)
    const hasMore = payment.tokens.length > TOKENS_PER_PAGE && tokenPage === 0
    const hasBack = tokenPage > 0

    return (
      <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {pageTokens.map((token, index) => {
                const tokenCost = amountUsd != null && payment.feeConfig
                  ? PaidClient.computePayAmountWithFee(amountUsd, token, payment.feeConfig)
                  : (amountUsd != null ? PaidClient.computePayAmount(amountUsd, token) : null)
                return (
                  <button
                    key={`${token.chainId}-${token.tokenAddress}`}
                    onClick={() => payment.pay(token)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                      border: 'none', borderBottom: '2px solid rgba(255,255,255,0.1)',
                      transition: 'background-color 0.15s',
                      animation: `paid-fade-in 0.3s ease-out ${index * 0.08}s both`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
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
                  </button>
                )
              })}

              {hasMore && (
                <button
                  onClick={() => setTokenPage(1)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                    border: 'none', transition: 'background-color 0.15s',
                    animation: `paid-fade-in 0.3s ease-out ${pageTokens.length * 0.08}s both`,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
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
                </button>
              )}

              {hasBack && (
                <button
                  onClick={() => setTokenPage(0)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 14, backgroundColor: 'transparent', color: '#fff', cursor: 'pointer',
                    border: 'none', transition: 'background-color 0.15s',
                    animation: `paid-fade-in 0.3s ease-out ${pageTokens.length * 0.08}s both`,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, border: '2px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>&#8249;</span>
                    </div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: 0, ...mono }}>Back</p>
                  </div>
                </button>
              )}
            </div>
          </>
        )}

        <PoweredByFooter />
      </div>
    )
  }

  const renderConfirming = () => (
    <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BoltIcon size="sm" color="white" />
        <span style={{ fontSize: '1.125rem', color: '#fff', ...brand }}>PAID</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>

        {/* ── Token logo → green check ── */}
        <div style={{ position: 'relative', width: 64, height: 64 }}>
          {payment.selectedToken && (
            <div style={{
              position: 'absolute', inset: 0,
              transition: 'transform 0.3s ease, opacity 0.3s ease',
              transform: isSuccess ? 'scale(0.6)' : undefined,
              opacity: isSuccess ? 0 : undefined,
              animation: isSuccess ? undefined : 'paid-token-pulse 2s ease-in-out infinite',
            }}>
              <TokenLogo token={payment.selectedToken} size={64} />
            </div>
          )}
          {!payment.selectedToken && !isSuccess && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'paid-bolt-pulse 2s ease-in-out infinite',
            }}>
              <BoltIcon size="lg" color="white" />
            </div>
          )}
          {isSuccess && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'paid-check-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                backgroundColor: '#22c55e',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* ── Amount / ticker ── */}
        <div style={{
          transition: 'opacity 0.3s, transform 0.3s',
          opacity: isSuccess ? 0 : 1,
          transform: isSuccess ? 'translateY(-8px)' : undefined,
        }}>
          {pendingTokenAmount && (
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0, textAlign: 'center', ...mono }}>
              {pendingTokenAmount}
            </p>
          )}
        </div>

        {/* ── Status text ── */}
        {isSuccess ? (
          <p style={{
            fontSize: '0.875rem', fontWeight: 700, color: '#22c55e',
            textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0,
            animation: 'paid-fade-up-in 0.2s ease-out 0.15s both',
            ...mono,
          }}>
            PAID
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}>
              {payment.state === 'confirming' ? 'CONFIRM IN WALLET' : 'PROCESSING...'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 6, height: 6, backgroundColor: 'rgba(255,255,255,0.6)',
                    animation: `paid-pulse 1s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <PoweredByFooter />
    </div>
  )

  const renderResult = () => {
    // ── Bounced ──
    if (payment.state === 'bounced') {
      return (
        <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
          <div style={{
            width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'paid-pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
          </div>
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
        <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
          <div style={{
            width: 56, height: 56, border: '2px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'paid-pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 26 }}>!</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Session expired</p>
          <PaidButton onClick={handleRetry}>Try again</PaidButton>
          <PoweredByFooter />
        </div>
      )
    }

    // ── Error ──
    return (
      <div className="paid-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
        <div style={{
          width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'paid-pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Something went wrong</p>
          {payment.error && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', padding: '0 16px', ...mono }}>{payment.error}</p>}
        </div>
        <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
        <PoweredByFooter />
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────

  if (!mounted) return <>{trigger}</>

  return (
    <>
      {trigger}
      {createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div
            className={`paid-backdrop ${animClass}`}
            onClick={canClose ? handleClose : undefined}
          />
          <div className={`paid-drawer ${animClass}`}>
            <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
              <div style={CONTAINER}>
                {activeView === 'loading' && renderLoading()}
                {activeView === 'select_token' && renderTokenSelection()}
                {activeView === 'confirming' && renderConfirming()}
                {activeView === 'result' && renderResult()}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
