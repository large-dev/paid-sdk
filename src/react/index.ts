// ─── Provider ─────────────────────────────────────────────────────────────
export { PaidProvider, type PaidProviderProps } from './provider'
export { usePaidContext } from './context'

// ─── Hooks ────────────────────────────────────────────────────────────────
export {
  usePaidPayment,
  type UsePaidPaymentReturn,
  type UsePaidPaymentOptions,
  type SendTransactionParams,
} from './hooks/use-paid-payment'

// ─── Components ───────────────────────────────────────────────────────────
export { PaidCheckout, type PaidCheckoutProps } from './components/paid-checkout'
export { BoltIcon, type BoltIconProps } from './components/bolt-icon'

// ─── Re-export core types for convenience ─────────────────────────────────
export type {
  PaymentRequest,
  PaymentState,
  PaymentReceipt,
  TokenInfo,
  SessionStatusResponse,
  PaidConfig,
  Address,
  Hex,
} from '../core/types'
