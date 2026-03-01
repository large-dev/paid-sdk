// ─── Types ────────────────────────────────────────────────────────────────
export type {
  Address,
  Hex,
  PaymentRequest,
  DepositStatus,
  CreateSessionResponse,
  SessionStatusResponse,
  TokenInfo,
  SupportedToken,
  PaymentState,
  PaymentReceipt,
  CreateDepositParams,
  WebhookEvent,
  WebhookPayload,
  PaidConfig,
} from './types'

export {
  CHAIN_ID_BASE,
  NATIVE_TOKEN,
  USDC_BASE,
  DEFAULT_BASE_URL,
  BOLT_CLIP_PATH,
} from './types'

// ─── Client ───────────────────────────────────────────────────────────────
export { PaidClient, PaidApiError } from './client'

// ─── State Machine ────────────────────────────────────────────────────────
export type { PaymentEvent, PaymentContext } from './state-machine'
export {
  initialContext,
  paymentReducer,
  isTerminal,
  TERMINAL_STATES,
} from './state-machine'

// ─── Webhook Verification ─────────────────────────────────────────────────
export { verifyWebhook, parseWebhookPayload } from './webhook'
