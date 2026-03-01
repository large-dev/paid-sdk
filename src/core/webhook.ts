import type { WebhookPayload } from './types'

/**
 * Verify a webhook signature from the Paid service.
 * Use this in your server-side webhook handler.
 *
 * @param payload - The raw request body string
 * @param signature - The X-Paid-Signature header value (e.g. "sha256=abc123...")
 * @param secret - Your webhook secret (whsec_...)
 * @returns true if the signature is valid
 *
 * @example
 * ```ts
 * import { verifyWebhook } from '@paid/sdk'
 *
 * app.post('/webhooks/paid', (req, res) => {
 *   const isValid = await verifyWebhook(
 *     req.body,                              // raw string
 *     req.headers['x-paid-signature'],       // signature header
 *     process.env.PAID_WEBHOOK_SECRET!,      // your secret
 *   )
 *   if (!isValid) return res.status(401).send('Invalid signature')
 *   const event: WebhookPayload = JSON.parse(req.body)
 *   // handle event...
 * })
 * ```
 */
export async function verifyWebhook(
  payload: string,
  signature: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false

  const prefix = 'sha256='
  if (!signature.startsWith(prefix)) return false

  const receivedHex = signature.slice(prefix.length)

  // Use Web Crypto API (works in Node 18+, Deno, Cloudflare Workers, browsers)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const expectedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  if (receivedHex.length !== expectedHex.length) return false
  let mismatch = 0
  for (let i = 0; i < receivedHex.length; i++) {
    mismatch |= receivedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Parse a webhook payload string into a typed object.
 */
export function parseWebhookPayload(body: string): WebhookPayload {
  return JSON.parse(body) as WebhookPayload
}
