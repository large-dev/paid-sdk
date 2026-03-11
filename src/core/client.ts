import type {
  PaidConfig,
  CreateDepositParams,
  CreateSessionResponse,
  SessionStatusResponse,
  SupportedToken,
  TokenInfo,
  FeeConfig,
  Address,
  PaymentRequest,
} from './types'
import { DEFAULT_BASE_URL, CHAIN_ID_BASE, USDC_BASE, NATIVE_TOKEN } from './types'

export class PaidApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'PaidApiError'
  }
}

/**
 * Framework-agnostic API client for the Paid service.
 * Handles session creation, status polling, and token fetching.
 */
export class PaidClient {
  private baseUrl: string
  private publicKey: string
  private chainId: number
  private feeConfigCache: FeeConfig | null = null

  constructor(config: PaidConfig) {
    this.publicKey = config.publicKey
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.chainId = config.chainId ?? CHAIN_ID_BASE
  }

  // ─── Internal fetch wrapper ──────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'x-api-key': this.publicKey,
      'Content-Type': 'application/json',
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const json = await res.json().catch(() => null)

    if (!res.ok) {
      const msg = json?.error ?? json?.message ?? `HTTP ${res.status}`
      throw new PaidApiError(msg, res.status, json)
    }

    // Unwrap { success: true, data: T } envelope
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as T
    }

    return json as T
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Convert a simple PaymentRequest into CreateDepositParams
   * and create a deposit session on the server.
   */
  async createSession(payment: PaymentRequest): Promise<CreateSessionResponse> {
    const params = this.toDepositParams(payment)
    return this.createSessionRaw(params)
  }

  /**
   * Create a deposit session with raw Daimo-compatible params.
   * Use this if you need full control over the deposit parameters.
   */
  async createSessionRaw(params: CreateDepositParams): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>('POST', '/v1/deposit', params)
  }

  /**
   * Poll the current status of a deposit session.
   */
  async getStatus(sessionId: string): Promise<SessionStatusResponse> {
    return this.request<SessionStatusResponse>('GET', `/v1/deposit/${sessionId}`)
  }

  /**
   * Get the list of supported input tokens.
   */
  async getSupportedTokens(): Promise<SupportedToken[]> {
    return this.request<SupportedToken[]>('GET', '/v1/deposit/tokens')
  }

  /**
   * Fetch token balances for a wallet address, filtered to supported tokens.
   * Returns tokens with non-zero balances, sorted by USD value.
   */
  async getWalletTokens(
    walletAddress: Address,
  ): Promise<TokenInfo[]> {
    const qs = new URLSearchParams({
      walletAddress,
    })
    return this.request<TokenInfo[]>(
      'GET',
      `/v1/deposit/tokens?${qs.toString()}`,
    )
  }

  /**
   * Fetch tenant fee configuration (cached after first call).
   */
  async getConfig(): Promise<FeeConfig> {
    if (this.feeConfigCache) return this.feeConfigCache
    this.feeConfigCache = await this.request<FeeConfig>('GET', '/v1/deposit/config')
    return this.feeConfigCache
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Convert a simple PaymentRequest into the Daimo-shaped params
   * that largepay-service expects.
   */
  private toDepositParams(payment: PaymentRequest): CreateDepositParams {
    return {
      destination: {
        destinationAddress: payment.destinationContract ?? payment.recipient,
        chainId: this.chainId,
        tokenAddress: payment.inputToken ?? USDC_BASE,
        units: payment.amountRaw,
        calldata: payment.calldata,
      },
      refundAddress: payment.refundAddress ?? payment.recipient,
      metadata: payment.metadata,
    }
  }

  /** Compute how much of a token is needed to cover a USD amount. */
  static computePayAmount(targetUsd: number, token: TokenInfo): string {
    if (token.rateUsdPerUnit <= 0) return '0'
    const amount = targetUsd / token.rateUsdPerUnit
    return amount.toFixed(Math.min(token.decimals, 8)).replace(/\.?0+$/, '')
  }

  /** Compute how much of a token is needed to cover a USD amount plus fees. */
  static computePayAmountWithFee(targetUsd: number, token: TokenInfo, fee: FeeConfig): string {
    const totalUsd = targetUsd + (targetUsd * fee.feeBps / 10000) + fee.feeFlatUsd
    return PaidClient.computePayAmount(totalUsd, token)
  }

  /** Check if a token address is native ETH (zero address). */
  static isNativeToken(address: string): boolean {
    return address.toLowerCase() === NATIVE_TOKEN
  }
}
