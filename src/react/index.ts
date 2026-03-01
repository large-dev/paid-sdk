// ─── Provider ─────────────────────────────────────────────────────────────
export { PaidProvider, type PaidProviderProps } from './provider'
export { usePaidContext } from './context'

// ─── Hooks ────────────────────────────────────────────────────────────────
export {
  usePaidPayment,
  type UsePaidPaymentReturn,
  type UsePaidPaymentOptions,
} from './hooks/use-paid-payment'

export {
  usePaidTokens,
  type UsePaidTokensReturn,
} from './hooks/use-paid-tokens'

// ─── Components ───────────────────────────────────────────────────────────
export { PaymentDrawer, type PaymentDrawerProps } from './components/payment-drawer'
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
} from '../core/types'
