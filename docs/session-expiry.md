# Session expiry behavior

The frontend wallet-sign-in flow (`src/lib/session.ts`) validates session
tokens against an expiry timestamp and clears expired sessions automatically.
This document describes the validation rules and the resulting sign-in
behavior so contributors know what the code already does and what to expect
when a session lapses.

## Wallet connection vs. authenticated session

The frontend tracks two distinct states that are managed independently:

1. **Wallet connection (`src/hooks/useWalletConnection.ts`)** — Establishes that
   the Freighter extension is installed and authorized to share a Stellar public
   address (`G...`). The address is cached in `localStorage` under
   `synapsvault-wallet` and restored silently on mount if Freighter still allows
   the origin. Having a connected wallet does **not** issue a backend bearer
   token.
2. **Authenticated session (`src/lib/session.ts`)** — Proves control of the
   connected address through a signed challenge–response flow
   (`authenticateWithWallet`), yielding a server-issued bearer token stored in
   `sessionStorage` under `session_token` (`authState.authenticated === true`).
   Disconnecting the wallet clears both states; signing out clears only the
   session while leaving the wallet connected.

### Which UI operations require a session

| UI operation / view | Required state | Notes |
|---------------------|----------------|-------|
| Browse Catalog, Leaderboard, Agent status, Resource Preview | None | Public read endpoints; no `Authorization` header is sent. |
| Look up Purchases by address | None (or connected wallet shortcut) | Accepts any 56-character `G...` address; offers a "Use connected wallet" fill-in when connected. |
| Buy a resource (`BuyModal`) | Connected wallet (`wallet.status === "connected"`) | Signs an x402 payment payload directly with Freighter; does not require a backend session token. |
| Creator Dashboard (`My Vault`) & Analytics tabs | Authenticated session (`isAuthenticated`) | Hidden from navigation and hotkeys until signed in; passes `sessionToken` to creator endpoints. |
| Publish a resource (`PublishModal`) | Authenticated session (`isAuthenticated`) | Gated behind `isAuthenticated` in the sidebar, top bar, and `P` shortcut. |
| Edit price, Transfer ownership, Register on-chain | Authenticated session (`isAuthenticated`) | Initiated from Creator Dashboard and authenticated with `sessionToken` plus wallet transaction signing. |

## Token shape

A session token has two fields:

```ts
interface SessionToken {
  token: string;   // opaque server-issued string sent as a Bearer token
  expiresAt: number; // epoch milliseconds when the token becomes invalid
}