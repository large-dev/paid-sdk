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
  Hex,
} from '../../core/types'
import { NATIVE_TOKEN } from '../../core/types'
import { usePaidContext } from '../context'
import { BoltIcon } from './bolt-icon'

// ─── Styles ───────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────

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
  calldata?: Hex
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

// ─── Format helpers ───────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────

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
    ...mono,
    ...extraStyle,
  }

  return (
    <button onClick={onClick} style={base}>
      {children}
    </button>
  )
}

function DrawerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BoltIcon size="sm" color="white" />
        <span style={{ fontSize: '1.125rem', color: '#fff', ...brand }}>PAID</span>
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

// ─── Main Component ───────────────────────────────────────────────────────

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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [depositAddress, setDepositAddress] = useState<string | null>(null)
  const [depositState, setDepositState] = useState<'idle' | 'creating' | 'awaiting' | 'sending' | 'polling' | 'completed' | 'bounced' | 'expired' | 'error'>('idle')
  const [statusData, setStatusData] = useState<SessionStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completedAt, setCompletedAt] = useState(() => new Date())

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevOpenRef = useRef(open)

  const effectiveAmountDisplay = amountDisplay ?? (amountUsd != null ? `$${amountUsd.toFixed(2)}` : undefined)

  // ─── Cleanup on close ───────────────────────────────────────────────

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      setView('loading')
      setTokens([])
      setSelectedToken(null)
      setTokenError(null)
      setSessionId(null)
      setDepositAddress(null)
      setDepositState('idle')
      setStatusData(null)
      setError(null)
      setCompletedAt(new Date())
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

  // ─── Auto-start session when drawer opens ───────────────────────────

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
  }, [open, depositState, client, recipient, refundAddress, amountUsd, metadata, calldata, destinationContract, onError])

  // ─── Fetch tokens once session is ready ─────────────────────────────

  useEffect(() => {
    if (depositState !== 'awaiting' || !sessionId || !walletAddress) return
    if (tokens.length > 0) return

    const fetchTokens = async () => {
      try {
        setTokenError(null)
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

        if (sorted.length === 1) {
          handlePay(sorted[0])
          return
        }

        setView('select_token')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch tokens'
        setTokenError(msg)
        setView('select_token')
      }
    }

    fetchTokens()
  }, [depositState, sessionId, walletAddress, tokens.length, amountUsd, client])

  // ─── Status polling ─────────────────────────────────────────────────

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

  // ─── Payment handler ────────────────────────────────────────────────

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
      setError(msg)
      setDepositState('error')
      setView('result')
      onError?.(msg)
    }
  }, [onSendTransaction, depositAddress, amountUsd, sessionId, startPolling, onError])

  // ─── Retry handler ──────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setTokens([])
    setSelectedToken(null)
    setTokenError(null)
    setView('loading')
    setDepositState('idle')
    setError(null)
    setStatusData(null)
  }, [])

  // ─── Don't render when closed ───────────────────────────────────────

  if (!open) return null

  const canClose = !['sending', 'polling'].includes(depositState)
  const handleBackdrop = () => { if (canClose) onClose?.() }

  // ─── Overlay wrapper ────────────────────────────────────────────────

  const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  }

  const backdrop: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(2px)',
  }

  const drawer: CSSProperties = {
    position: 'relative',
    width: '100%',
    maxWidth: 448,
    maxHeight: '90dvh',
    overflowY: 'auto',
  }

  const isSuccessReceipt = view === 'result' && depositState === 'completed'
  const containerStyle = isSuccessReceipt ? RECEIPT_CONTAINER : CONTAINER

  return createPortal(
    <div style={overlay}>
      <div style={backdrop} onClick={handleBackdrop} />
      <div style={drawer}>
        <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
          <div style={containerStyle}>

            {/* ═══ LOADING ═══ */}
            {(view === 'loading') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
                <DrawerHeader title={title} subtitle={subtitle} />
                {effectiveAmountDisplay && (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
                      {effectiveAmountDisplay}
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
                  <BoltIcon size="lg" color="white" />
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', ...mono }}>
                    {depositState === 'creating' ? 'SETTING UP...' : 'FINDING OPTIONS...'}
                  </p>
                </div>
              </div>
            )}

            {/* ═══ TOKEN SELECTION ═══ */}
            {view === 'select_token' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
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
                    <div style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#ff0000', fontSize: 24 }}>!</span>
                    </div>
                    <p style={{ color: '#ff0000', fontSize: '0.75rem', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>
                      {tokenError}
                    </p>
                    <PaidButton variant="danger" onClick={handleRetry}>Try again</PaidButton>
                  </div>
                ) : tokens.length === 0 ? (
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
                ) : (
                  <>
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', ...mono }}>
                      Pay with
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {tokens.map((token) => {
                        const tokenCost = amountUsd != null
                          ? PaidClient.computePayAmount(amountUsd, token)
                          : null

                        return (
                          <button
                            key={`${token.chainId}-${token.tokenAddress}`}
                            onClick={() => handlePay(token)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '14px',
                              borderBottom: '2px solid rgba(255,255,255,0.1)',
                              backgroundColor: 'transparent',
                              color: '#fff',
                              cursor: 'pointer',
                              border: 'none',
                              borderBottomStyle: 'solid',
                              borderBottomWidth: 2,
                              borderBottomColor: 'rgba(255,255,255,0.1)',
                              transition: 'background-color 0.15s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{
                                width: 40, height: 40, borderRadius: '50%',
                                backgroundColor: 'rgba(255,255,255,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.75rem', fontWeight: 700, ...mono,
                              }}>
                                {token.symbol.slice(0, 3)}
                              </div>
                              <div style={{ textAlign: 'left' }}>
                                <p style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, ...mono }}>{token.symbol}</p>
                                <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.3)', margin: 0, ...mono }}>
                                  {tokenCost
                                    ? `~${tokenCost} ${token.symbol}`
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
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ═══ CONFIRMING ═══ */}
            {view === 'confirming' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BoltIcon size="sm" color="white" />
                  <span style={{ fontSize: '1.125rem', color: '#fff', ...brand }}>PAID</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '24px 0' }}>
                  <BoltIcon size="lg" color="white" />
                  {effectiveAmountDisplay && (
                    <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#fff', margin: 0, ...mono }}>
                      {effectiveAmountDisplay}
                    </p>
                  )}
                  {selectedToken && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', border: '2px solid rgba(255,255,255,0.2)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', ...mono }}>
                        {amountUsd != null
                          ? `~${PaidClient.computePayAmount(amountUsd, selectedToken)} ${selectedToken.symbol}`
                          : selectedToken.symbol}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, ...mono }}>
                      {depositState === 'sending' ? 'CONFIRM IN WALLET' : 'PROCESSING...'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: 6, height: 6,
                            backgroundColor: 'rgba(255,255,255,0.6)',
                            animation: `paid-pulse 1s ease-in-out ${i * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ RESULT ═══ */}
            {view === 'result' && (
              <>
                {/* SUCCESS RECEIPT */}
                {depositState === 'completed' && (() => {
                  const ink = receiptTheme === 'light' ? '#000' : '#fff'
                  const paper = receiptTheme === 'light' ? '#fff' : '#000'
                  const muted = '#888'
                  const borderColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'
                  const dividerColor = receiptTheme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
                  const stampBorder = receiptTheme === 'light' ? '#000' : '#fff'

                  const srcSymbol = statusData?.source?.tokenSymbol || selectedToken?.symbol || '—'
                  const srcAmount = statusData?.source?.amountUnits
                    || (amountUsd != null && selectedToken ? PaidClient.computePayAmount(amountUsd, selectedToken) : '—')
                  const srcUsd = statusData?.source?.usdValue
                    ? `$${parseFloat(statusData.source.usdValue).toFixed(2)}`
                    : (amountUsd != null ? `$${amountUsd.toFixed(2)}` : effectiveAmountDisplay || '—')
                  const receiptId = sessionId ? sessionId.slice(0, 8) : '—'
                  const timestamp = completedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: paper, color: ink }}>
                      <div style={{ padding: '20px 20px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <BoltIcon size="sm" color={receiptTheme === 'light' ? 'black' : 'white'} />
                          <span style={{ fontSize: '1.25rem', ...brand, color: ink }}>PAID</span>
                        </div>
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

                      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Token</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcSymbol}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Amount</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcAmount}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, ...mono }}>Total</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, ...mono, color: ink }}>{srcUsd}</span>
                        </div>
                      </div>

                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ borderTop: `3px solid ${dividerColor}` }} />
                      </div>

                      {/* PAID stamp */}
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                        <div style={{ padding: '12px 32px', border: `3px solid ${stampBorder}`, transform: 'rotate(-6deg)' }}>
                          <span style={{ fontSize: '2.25rem', letterSpacing: '0.05em', ...brand, color: ink }}>PAID</span>
                        </div>
                      </div>

                      {/* Footer */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0' }}>
                        <span style={{ fontSize: '0.5625rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: muted, ...mono }}>
                          Powered by PAID
                        </span>
                        <BoltIcon size="sm" color={receiptTheme === 'light' ? 'black' : 'white'} />
                      </div>

                      {onClose && (
                        <div style={{ padding: '0 20px 20px' }}>
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
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* BOUNCED */}
                {depositState === 'bounced' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
                    <div style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Payment bounced</p>
                      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', ...mono }}>The payment was returned. Try again.</p>
                    </div>
                    <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
                  </div>
                )}

                {/* EXPIRED */}
                {depositState === 'expired' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
                    <div style={{ width: 56, height: 56, border: '2px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 26 }}>!</span>
                    </div>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Session expired</p>
                    <PaidButton onClick={handleRetry}>Try again</PaidButton>
                  </div>
                )}

                {/* ERROR */}
                {depositState === 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 20px' }}>
                    <div style={{ width: 56, height: 56, border: '2px solid rgba(255,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#ff0000', fontSize: 26 }}>!</span>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ color: '#ff0000', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...mono }}>Something went wrong</p>
                      {error && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', padding: '0 16px', ...mono }}>{error}</p>}
                    </div>
                    <PaidButton variant="danger" onClick={handleRetry}>Retry</PaidButton>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
