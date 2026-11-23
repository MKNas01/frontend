# Session expiry behavior

The frontend wallet-sign-in flow (`src/lib/session.ts`) validates session
tokens against an expiry timestamp and clears expired sessions automatically.
This document describes the validation rules, auth proxy configuration,
endpoint contracts, and resulting sign-in behavior so contributors know what
the code already does and what to expect when a session lapses.

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

## Auth proxy configuration gating

Wallet sign-in is decoupled from the marketplace catalog API (`API_BASE` in
`src/lib/config.ts`) and is gated by `VITE_AUTH_PROXY_URL`:

```ts
export const AUTH_PROXY_URL = (import.meta.env.VITE_AUTH_PROXY_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

export const HAS_AUTH_PROXY = AUTH_PROXY_URL.length > 0;
```

**Why sign-in fails when empty while the catalog works:** Catalog reads
(`/resources`, `/agent`, `/registry`, `/publishers`, `/buyers`, `/payments`)
resolve against `API_BASE` (which defaults to `""` in development via the
Vite dev proxy and `"/api"` in production). By contrast, `AUTH_PROXY_URL` has
no fallback path—when `VITE_AUTH_PROXY_URL` is unset or whitespace-only,
`AUTH_PROXY_URL` evaluates to `""` (`HAS_AUTH_PROXY === false`).

**Runtime behavior:** Every call through `sessionApi` (`src/api/session.ts`)
checks `if (!AUTH_PROXY_URL)` first and immediately throws
`Error("Wallet sign-in is not configured for this site.")` before issuing a
network request. Configure `VITE_AUTH_PROXY_URL` (for example, a same-origin
path such as `/auth` backed by a host proxy, or an external HTTPS auth
service origin) to enable sign-in.

## Token shape

A session token has two fields:

```ts
interface SessionToken {
  token: string;   // opaque server-issued string sent as a Bearer token
  expiresAt: number; // epoch milliseconds when the token becomes invalid
}
```

The backend's `SessionExchangeResponse` provides both values after the wallet
signature is verified (see `authenticateWithWallet` below). The frontend never
computes `expiresAt` itself.

## Expiry validation

`isExpired(session)` returns `true` when `expiresAt` is not a finite number or
when the current time has passed it:

```ts
return !Number.isFinite(session.expiresAt) || Date.now() >= session.expiresAt;
```

Every code path that touches the session calls `isExpired` before trusting the
token:

| Path | What happens on expiry |
|------|------------------------|
| `getSessionToken()` | Calls `clearSession()` and returns `null`. |
| `setSession(session)` | Throws `SessionAuthError("Invalid or expired session")`. |
| `syncStore()` | Sets `authState` to `{ authenticated: false, token: null, expiresAt: null }`. |
| `loadPersistedSession()` | Removes the item from `sessionStorage` and returns `null`. |

## Automatic expiry timer

`setSession` schedules a `setTimeout` that fires `clearSession` at the moment
the token expires (capped at the max 32-bit signed integer delay):

```ts
expiryTimer = setTimeout(clearSession, Math.min(session.expiresAt - Date.now(), 2_147_483_647));
```

`clearSession` cancels that timer, nulls the in-memory session, removes the
persisted copy, and pushes the unauthenticated state to the `authState` store.
Any component subscribed to `authState` re-renders with `authenticated: false`.

## Persistence and restore

Sessions are written to `sessionStorage` under the key `session_token`. On
module load the persisted token is read back, validated with `isExpired`, and
either restored via `setSession` or discarded. `sessionStorage` is scoped to
the tab, so closing the tab discards the session automatically.

The write and read paths swallow `Storage` errors (quota exceeded, privacy
mode) so the app degrades gracefully — the session stays in memory for the
tab's lifetime but is not restored after a reload.

## Sign-in flow and endpoint contracts

`authenticateWithWallet(address, signChallenge, api)` (`src/lib/session.ts`)
orchestrates a three-step challenge–response against `sessionApi`
(`src/api/session.ts`):

1. **Request challenge** (`POST ${AUTH_PROXY_URL}/challenge`) —
   `sessionApi.requestChallenge(address)` posts `{ address }` and validates the
   response against `ChallengeResponse`:

   ```ts
   export interface ChallengeResponse {
     challenge: string;
     expiresAt: number;
   }
   ```

   If `challenge` is missing, `expiresAt` is non-finite, or
   `expiresAt <= Date.now()`, `authenticateWithWallet` throws
   `SessionAuthError("Failed to obtain authentication challenge")`.

   Fictional `POST /challenge` request and response:

   ```json
   // POST /auth/challenge
   {
     "address": "GABCDEXAMPLE0000000000000000000000000000000000000000000"
   }

   // 200 OK (Content-Type: application/json)
   {
     "challenge": "synapsvault-login:GABCDEXAMPLE0000000000000000000000000000000000000000000:nonce-9f8e7d6c",
     "expiresAt": 1734568190000
   }
   ```

2. **Sign** — The caller's `signChallenge`