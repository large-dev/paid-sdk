// ─── Addresses & Primitives ───────────────────────────────────────────────

export type Address = `0x${string}`
export type Hex = `0x${string}`

// ─── Payment Request ──────────────────────────────────────────────────────

/** What the integrator passes to initiate a payment. */
export interface PaymentRequest {
  /** Recipient wallet address (where funds land after swap). */
  recipient: Address
  /** Address to refund if the session expires unused. */
  refundAddress?: Address
  /** USD amount to charge. The SDK handles token conversion. */
  amountUsd?: number
  /** Raw token amount (wei string). Use instead of amountUsd for exact token amounts. */
  amountRaw?: string
  /** Specific input token address. If omitted, user picks from their balances. */
  inputToken?: Address
  /** Arbitrary metadata attached to the session (e.g. orderId). */
  metadata?: Record<string, string>
}

// ─── Deposit Session ──────────────────────────────────────────────────────

export type DepositStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'bounced'
  | 'expired'

/** Server response for creating a deposit session. */
export interface CreateSessionResponse {
  sessionId: string
  depositAddress: Address
  expiresAt: number // unix seconds
}

/** Server response for polling a deposit session. */
export interface SessionStatusResponse {
  sessionId: string
  status: DepositStatus
  depositAddress: string
  expiresAt: number
  source?: {
    txHash: string | null
    chainId: number
    tokenAddress: string
    tokenSymbol: string
    amountUnits: string
    usdValue: string
  }
  destination?: {
    txHash: string | null
    chainId: number
    tokenAddress: string
    tokenSymbol: string
    amountUnits: string | null
  }
}

// ─── Tokens ───────────────────────────────────────────────────────────────

export interface TokenInfo {
  chainId: number
  tokenAddress: string
  symbol: string
  decimals: number
  /** Current price in USD per 1 unit of the token. */
  rateUsdPerUnit: number
  minUnits: string
  maxUnits: string
  /** User's balance in human-readable units (e.g. "1.5"). */
  balanceUnits: string
  /** User's balance in USD. */
  balanceUsd: number
}

export interface SupportedToken {
  address: string
  symbol: string
  decimals: number
  name: string
}

// ─── Payment Lifecycle (State Machine) ────────────────────────────────────

export type PaymentState =
  | 'idle'
  | 'creating'         // calling POST /v1/deposit
  | 'awaiting_payment'  // session created, waiting for user to pick token
  | 'sending'           // user confirmed, tx being sent
  | 'polling'           // tx sent, polling for completion
  | 'completed'
  | 'bounced'
  | 'expired'
  | 'error'

export interface PaymentReceipt {
  sessionId: string
  status: 'completed' | 'bounced'
  txHash: string | null
  source?: SessionStatusResponse['source']
  destination?: SessionStatusResponse['destination']
  completedAt: Date
}

// ─── Daimo-Compatible Deposit Params ──────────────────────────────────────
// The largepay-service accepts both native and Daimo-shaped requests.
// We use the Daimo shape so the service works with both.

export interface CreateDepositParams {
  destination: {
    destinationAddress: string
    chainId: number
    tokenAddress: string
    units?: string
    calldata?: string
  }
  display?: {
    title?: string
    verb?: string
  }
  refundAddress?: string
  metadata?: Record<string, string>
}

// ─── Webhook ──────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'deposit.detected'
  | 'deposit.completed'
  | 'deposit.failed'
  | 'deposit.expired'

export interface WebhookPayload {
  event: WebhookEvent
  sessionId: string
  status: string
  depositAddress: string
  outputAmount?: string
  txHash?: string
  timestamp: string
}

// ─── SDK Config ───────────────────────────────────────────────────────────

export interface PaidConfig {
  /** Public API key (pk_...) for browser-safe calls. */
  publicKey: string
  /** Base URL of the Paid API. Defaults to https://api.getpaid.dev */
  baseUrl?: string
  /** Chain ID. Defaults to 8453 (Base). */
  chainId?: number
  /** Session TTL override in seconds. Server default is 3600. */
  sessionTtlSeconds?: number
}

// ─── Constants ────────────────────────────────────────────────────────────

export const CHAIN_ID_BASE = 8453

export const NATIVE_TOKEN: Address = '0x0000000000000000000000000000000000000000'

export const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export const DEFAULT_BASE_URL = 'https://api.getpaid.dev'

export const BOLT_CLIP_PATH =
  'polygon(20% 0%, 80% 0%, 100% 20%, 60% 40%, 90% 40%, 40% 100%, 50% 60%, 10% 60%, 30% 20%)'
