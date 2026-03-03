# @paid/sdk

Drop-in crypto payment infrastructure for any React app. Accept ETH or any ERC-20 on Base, receive USDC.

## Install

```bash
npm install @paid/sdk
```

Peer dependencies:

```bash
npm install react react-dom viem @wagmi/core
```

## Quick Start — PaymentDrawer (easiest)

The `PaymentDrawer` is a pre-built modal that handles the entire payment flow: session creation, token selection, status polling, and result display.

```tsx
import { PaidProvider, PaymentDrawer } from "@paid/sdk/react";
import "@paid/sdk/styles.css";

function App() {
  return (
    <PaidProvider publicKey="pk_live_...">
      <Checkout />
    </PaidProvider>
  );
}

function Checkout() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Pay $25</button>
      <PaymentDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Order #1234"
        amountUsd={25}
        recipient="0xYourWallet..."
        walletAddress="0xUserWallet..."
        onSendTransaction={async ({ to, data, value }) => {
          // Use wagmi, ethers, or any wallet to send the tx
          const hash = await sendTransaction({ to, data, value });
          return hash;
        }}
        onComplete={(receipt) => {
          console.log("Payment complete!", receipt);
        }}
      />
    </>
  );
}
```

## Headless — Build Your Own UI

Use the hooks directly for full control over the payment UX.

```tsx
import { PaidProvider, usePaidPayment } from "@paid/sdk/react";

function CustomPaymentFlow() {
  const payment = usePaidPayment({
    onComplete: (receipt) => console.log("Paid!", receipt),
    onBounced: (receipt) => console.log("Bounced", receipt),
    onExpired: () => console.log("Session expired"),
  });

  // 1. Start a payment
  const handlePay = async () => {
    await payment.start({
      recipient: "0xMerchantWallet...",
      amountUsd: 25,
    });
  };

  // 2. User picks a token from payment.tokens
  // 3. payment.selectToken(token)
  // 4. Your app sends the tx → payment.notifyTxSent(txHash)
  // 5. SDK polls automatically → onComplete fires

  return (
    <div>
      <p>State: {payment.state}</p>
      <button onClick={handlePay}>Start Payment</button>
    </div>
  );
}
```

## Framework-Agnostic Core

Use `PaidClient` directly without React:

```ts
import { PaidClient } from "@paid/sdk";

const client = new PaidClient({ publicKey: "pk_live_..." });

// Create a deposit session
const session = await client.createSession({
  recipient: "0x...",
  amountRaw: "1000000", // 1 USDC in 6-decimal units
});

console.log(session.depositAddress); // User sends tokens here
console.log(session.expiresAt); // Unix timestamp

// Poll for status
const status = await client.getStatus(session.sessionId);
```

## Webhook Verification (Server-Side)

Verify webhook signatures in your backend:

```ts
import { verifyWebhook, parseWebhookPayload } from "@paid/sdk";

app.post("/webhooks/paid", async (req, res) => {
  const isValid = await verifyWebhook(
    req.body, // raw body string
    req.headers["x-paid-signature"],
    process.env.PAID_WEBHOOK_SECRET!
  );

  if (!isValid) return res.status(401).send("Invalid signature");

  const event = parseWebhookPayload(req.body);
  // event.event: 'deposit.completed' | 'deposit.detected' | ...
  // event.sessionId, event.txHash, etc.
});
```

## API Reference

### PaidClient

| Method | Description |
| --- | --- |
| `createSession(payment)` | Create a deposit session |
| `createSessionRaw(params)` | Create session with raw Daimo-compatible params |
| `getStatus(sessionId)` | Poll session status |
| `getSupportedTokens()` | List supported input tokens |
| `getWalletTokens(sessionId, walletAddress)` | Get user's token balances |
| `PaidClient.computePayAmount(usd, token)` | Calculate token amount for USD value |
| `PaidClient.isNativeToken(address)` | Check if address is native ETH |

### React Hooks

| Hook | Description |
| --- | --- |
| `usePaidPayment(options)` | Full payment lifecycle management |
| `usePaidTokens()` | Token fetching and filtering |
| `usePaidContext()` | Access the PaidProvider context |

### Payment States

```
idle → creating → awaiting_payment → sending → polling → completed
                                                       → bounced
                                                       → expired
                                              → error
```

## Exports

```ts
// Framework-agnostic core
import { PaidClient, verifyWebhook, parseWebhookPayload } from "@paid/sdk";

// React bindings
import {
  PaidProvider,
  usePaidPayment,
  usePaidTokens,
  PaymentDrawer,
} from "@paid/sdk/react";

// Styles (required for PaymentDrawer)
import "@paid/sdk/styles.css";
```

## License

MIT
