# MegaBlock Frontend API Integration

This document describes the current backend contract for building the MegaBlock frontend.

## 1. Base URLs

Local REST base URL:

```text
http://localhost:9004/api/v1/original-games
```

Frontend environment variable:

```env
NEXT_PUBLIC_BASE_URL=http://localhost:9004
```

MegaBlock API base:

```text
/api/v1/original-games/mega-block
```

The frontend page slug is `megablock`, while the backend game key is always `mega-block`.

## 2. Response Envelope

Every successful response uses:

```json
{
  "data": {},
  "errors": []
}
```

Every failed response uses:

```json
{
  "data": {},
  "errors": [
    {
      "errorCode": 3079,
      "fields": {}
    }
  ]
}
```

Always read the endpoint result from `response.data.data` when using Axios directly. The repository's `getRequest` and `postRequest` helpers may already unwrap part of this response, so follow their existing usage.

## 3. Launch and Authentication

The iframe URL should contain an A1 session:

```text
/original-games/megablock?casinoSessionId=<A1_SESSION>&gameKey=mega-block
```

Exchange it for a game-scoped token once during page initialization.

### Launch

```http
POST /api/v1/original-games/launch
Content-Type: application/json
```

Request:

```json
{
  "casinoSessionId": "a1-session-id",
  "gameKey": "mega-block",
  "device": "DESKTOP",
  "lang": "en"
}
```

Only `casinoSessionId` and `gameKey` are required.

Response:

```json
{
  "data": {
    "token": "generated-game-token",
    "currency": "SC",
    "gameKey": "mega-block"
  },
  "errors": []
}
```

Send the returned token on every MegaBlock and provably-fair request:

```http
Authorization: AccessToken=<TOKEN>
```

The token is scoped to `mega-block`. A token launched for another game cannot call these endpoints.

After launch succeeds, remove `casinoSessionId` from the browser URL with `router.replace` or `history.replaceState` so it does not remain in browser history or referrer data.

### Local Stub Mode

MegaBlock keeps the A1 integration architecture. For local development, the user backend can simulate A1 instead of contacting a real operator.

Configure the user backend environment:

```env
A1_STUB_MODE=true
A1_WALLET_ENDPOINT=http://localhost:8082
A1_SIGNING_SECRET_PRIMARY=a1-signing-secret
A1_VERIFY_SECRET=a1-verify-secret
```

Restart the user backend after changing its environment:

```bash
cd /home/developer/trueigtech-proj/lobby/executor
docker compose restart user-backend user-backend-worker
```

In stub mode, `/launch` still requires a non-empty `casinoSessionId`, but it is a local mock identifier rather than a real A1 session.

Suggested local session IDs:

```text
a1-mock-megablock-sc   -> SC wallet/session
a1-mock-megablock-gc   -> GC wallet/session
```

The local frontend launch URL is:

```text
http://localhost:9010/original-games/megablock?casinoSessionId=a1-mock-megablock-sc&gameKey=mega-block
```

The frontend performs this request once:

```http
POST http://localhost:9004/api/v1/original-games/launch
Content-Type: application/json

{
  "casinoSessionId": "a1-mock-megablock-sc",
  "gameKey": "mega-block"
}
```

It receives an original-games token and uses that token for all later calls:

```http
Authorization: AccessToken=<RETURNED_TOKEN>
```

Therefore, curl is not bypassing session authentication. Curl works locally because it first sends a mock session ID to `/launch`, receives a token, and then sends that token to MegaBlock APIs.

Example terminal flow:

```bash
LAUNCH_RESPONSE=$(curl -s -X POST \
  http://localhost:9004/api/v1/original-games/launch \
  -H 'Content-Type: application/json' \
  -d '{"casinoSessionId":"a1-mock-megablock-sc","gameKey":"mega-block"}')

TOKEN=$(printf '%s' "$LAUNCH_RESPONSE" | jq -r '.data.token')

curl -s http://localhost:9004/api/v1/original-games/mega-block/settings \
  -H "Authorization: AccessToken=$TOKEN" | jq
```

If `jq` is unavailable, copy `data.token` manually from the launch response.

Stub mode is development-only. Production must use a real operator-issued `casinoSessionId`; never add a production fallback that invents session IDs or bypasses `/launch`.

## 4. Recommended Initialization Flow

1. Read `casinoSessionId` and `gameKey` from the iframe URL.
2. Require `gameKey === "mega-block"`.
3. Call `POST /original-games/launch` and retain its token in page/session state.
4. Remove `casinoSessionId` from the URL.
5. Call `GET /mega-block/settings`.
6. Call `GET /mega-block/unfinished-bet`.
7. Keep the bet form and game actions disabled until the unfinished-bet request finishes.
8. If an unfinished bet exists, restore its visible floors and active bet ID.
9. Require the player to finish that round by continuing Drop or using Cash Out.
10. Otherwise show the new-bet form.
11. Optionally connect to the `/original-games` socket namespace for balance events.

Do not create a new bet automatically on reload. Always check `unfinished-bet` first.

### Mandatory Unfinished-Round Gate

Only one open MegaBlock round is allowed for a player. An unfinished round must be resolved before another MegaBlock bet can be placed.

While `GET /unfinished-bet` returns `hasUnfinishedBet: true`:

- Hide or disable the Place Bet action.
- Lock amount and difficulty controls because they belong to a future round.
- Restore `betId`, `betAmount`, `gameDifficulty`, `maxFloor`, `currentFloorCount`, `payoutMultiplier`, seed hash, and nonce from `unfinishedBet`.
- Mark floors `1..currentFloorCount` as safe.
- Make the next Drop attempt floor `currentFloorCount + 1`.
- Enable Cash Out only when `currentFloorCount > 0`.
- Allow only Drop or Cash Out to finish the existing round.
- Do not ask the backend for, derive, or display `crashFloor` while the round is open.

The unfinished round is complete when a successful Drop or Cash Out response contains:

```js
result === 'won' || result === 'lost'
```

After completion:

1. Finish the win/loss animation.
2. Clear the local active `betId` and unfinished-round state.
3. Optionally call `GET /unfinished-bet` again as confirmation.
4. Re-enable the new-bet controls only after the endpoint reports `hasUnfinishedBet: false`.

The backend also rejects a second Place Bet with `OpenBetExistsErrorType`. If the frontend receives that error, it must call `GET /unfinished-bet`, restore the existing round, and move the player into the active-round UI. It must not automatically retry Place Bet.

### Balance Socket

The shared `useOriginalGameSession` hook already handles this. For a new implementation, connect after launch:

```js
const socket = io(`${socketOrigin}/original-games`, {
  auth: { token },
  transports: ['websocket']
});

socket.on('balance', ({ balance, currency }) => {
  setBalance(Number(balance));
  if (currency) setCurrency(currency);
});
```

Balance events have this shape:

```json
{
  "balance": 1006.17,
  "currency": "SC"
}
```

The backend emits them after bet debit and win credit. The explicit `balance` returned by final-floor and cash-out responses may also be applied immediately.

## 5. Game Rules Used by the UI

- Easy has 24 visible/playable floors.
- Medium has 22 visible/playable floors.
- Hard has 20 visible/playable floors.
- Hardcore has 15 visible/playable floors.
- `currentFloorCount` is the number of safely completed floors.
- Floor numbers shown by the UI run from `1` through `maxFloor`.
- The hidden `crashFloor` can be `maxFloor + 1`.
- `crashFloor: 25` on Easy means all 24 visible floors were safe. It is not a visible 25th floor.
- Reaching `maxFloor` safely automatically wins and settles the round. Do not show a cash-out action after that response.
- The backend is authoritative for multipliers and winnings. Do not calculate the payout used for wallet settlement in the frontend.

## 6. Get Settings

```http
GET /api/v1/original-games/mega-block/settings
Authorization: AccessToken=<TOKEN>
```

Response example:

```json
{
  "data": {
    "minBet": 0.1,
    "maxBet": 100,
    "maxProfit": 1000,
    "defaultDifficulty": "easy",
    "difficulties": {
      "easy": { "maxFloor": 24 },
      "medium": { "maxFloor": 22 },
      "hard": { "maxFloor": 20 },
      "hardcore": { "maxFloor": 15 }
    }
  },
  "errors": []
}
```

Use these values to configure the amount input and floor count. Currency comes from the authenticated launch session and must not be sent by the frontend.

## 7. Get Unfinished Bet

```http
GET /api/v1/original-games/mega-block/unfinished-bet
Authorization: AccessToken=<TOKEN>
```

No open round:

```json
{
  "data": {
    "hasUnfinishedBet": false,
    "unfinishedBet": null
  },
  "errors": []
}
```

Open round example:

```json
{
  "data": {
    "hasUnfinishedBet": true,
    "unfinishedBet": {
      "id": "42",
      "playerId": "7",
      "originalGameId": "9",
      "currency": "SC",
      "roundId": "6b0c48a4-77ad-4b32-a203-c100c610c730",
      "betAmount": "10.00000000",
      "gameDifficulty": "easy",
      "currentFloorCount": 4,
      "maxFloor": 24,
      "winningAmount": "0.00000000",
      "payoutMultiplier": 1.154761,
      "result": null,
      "clientSeed": "my-seed",
      "serverSeedHash": "hash",
      "nonce": 3,
      "walletDebitRef": "debit-reference",
      "walletCreditRef": null,
      "createdAt": "2026-08-17T10:00:00.000Z",
      "updatedAt": "2026-08-17T10:01:00.000Z"
    }
  },
  "errors": []
}
```

`crashFloor` is deliberately absent while the round is open. Never expect or require it for restoring the UI.

Restore floors `1..currentFloorCount` as safely completed. The next drop attempts `currentFloorCount + 1`.

Recommended restoration helper:

```js
function restoreMegaBlockRound(unfinishedBet) {
  return {
    status: 'active',
    betId: String(unfinishedBet.id),
    betAmount: Number(unfinishedBet.betAmount),
    currency: unfinishedBet.currency,
    difficulty: unfinishedBet.gameDifficulty,
    maxFloor: Number(unfinishedBet.maxFloor),
    completedFloorCount: Number(unfinishedBet.currentFloorCount),
    payoutMultiplier: Number(unfinishedBet.payoutMultiplier ?? 1),
    winningAmount: 0,
    clientSeed: unfinishedBet.clientSeed,
    serverSeedHash: unfinishedBet.serverSeedHash,
    nonce: Number(unfinishedBet.nonce),
    crashFloor: null,
    result: null
  };
}
```

Do not restore `walletDebitRef` or other database-only fields into visible UI state.

## 8. Place Bet

```http
POST /api/v1/original-games/mega-block/place-bet
Authorization: AccessToken=<TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "amount": 10,
  "difficulty": "easy",
  "clientSeed": "my-client-seed"
}
```

Rules:

- `amount` must be greater than zero, use at most two decimal places, and remain within settings limits.
- `difficulty` may be `easy`, `medium`, `hard`, or `hardcore`; it defaults to `easy`.
- `clientSeed` is required and must contain 1-32 characters.
- Do not send player ID, casino player ID, casino session ID, or currency.

Response:

```json
{
  "data": {
    "betId": "42",
    "betAmount": 10,
    "currency": "SC",
    "difficulty": "easy",
    "maxFloor": 24,
    "currentFloorCount": 0,
    "serverSeedHash": "hash",
    "nonce": 3,
    "clientSeed": "my-client-seed"
  },
  "errors": []
}
```

The stake has already been debited when this succeeds. Store `betId` and enable the Drop action. Cash-out must remain disabled at floor 0.

The response never contains `crashFloor`.

## 9. Drop One Block

```http
POST /api/v1/original-games/mega-block/drop-block
Authorization: AccessToken=<TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "betId": "42"
}
```

Disable both Drop and Cash Out while this request is pending. The backend locks the row, but the frontend should still prevent accidental double-clicks.

### Safe Intermediate Floor

```json
{
  "data": {
    "betId": "42",
    "completedFloorCount": 5,
    "maxFloor": 24,
    "payoutMultiplier": 1.2125,
    "result": null
  },
  "errors": []
}
```

Frontend action:

- Animate floor 5 as safe.
- Update the displayed multiplier from the response.
- Enable Cash Out because at least one floor is now complete.
- Keep the round active because `result` is `null`.

### Crash/Loss

```json
{
  "data": {
    "betId": "42",
    "completedFloorCount": 4,
    "attemptedFloor": 5,
    "maxFloor": 24,
    "crashFloor": 5,
    "winningAmount": 0,
    "payoutMultiplier": 0,
    "result": "lost",
    "clientSeed": "my-client-seed",
    "serverSeedHash": "hash",
    "nonce": 3
  },
  "errors": []
}
```

Frontend action:

- Animate `attemptedFloor` as the crashing floor.
- Keep only `completedFloorCount` floors marked safe.
- Show zero winnings.
- Clear the active round after the loss animation.
- Enable a new bet.

### Final Floor Auto-Win

```json
{
  "data": {
    "betId": "42",
    "completedFloorCount": 24,
    "maxFloor": 24,
    "crashFloor": 25,
    "winningAmount": 242.5,
    "payoutMultiplier": 24.25,
    "result": "won",
    "balance": 1242.5,
    "clientSeed": "my-client-seed",
    "serverSeedHash": "hash",
    "nonce": 3
  },
  "errors": []
}
```

Frontend action:

- Animate visible floor 24 as safe.
- Do not animate floor 25.
- Show the automatic win and returned balance.
- Clear the active round after the win animation.
- Do not call Cash Out after this response.

`winningAmount` can be limited by `maxProfit`, so it may be lower than `betAmount * payoutMultiplier`. Display the backend value.

## 10. Cash Out

```http
POST /api/v1/original-games/mega-block/cash-out
Authorization: AccessToken=<TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "betId": "42"
}
```

Cash-out is allowed only after at least one successful drop.

Response:

```json
{
  "data": {
    "betId": "42",
    "betAmount": "10.00000000",
    "currency": "SC",
    "completedFloorCount": 10,
    "maxFloor": 24,
    "crashFloor": 18,
    "winningAmount": 16.17,
    "payoutMultiplier": 1.616666,
    "result": "won",
    "balance": 1006.17,
    "clientSeed": "my-client-seed",
    "serverSeedHash": "hash",
    "nonce": 3
  },
  "errors": []
}
```

Frontend action:

- Show the returned `winningAmount` and `balance`.
- End the active round.
- Stop further Drop or Cash Out calls.
- `crashFloor` is now safe to display in history or fairness details because the round has ended.

## 11. Bet History

```http
GET /api/v1/original-games/mega-block/bets?page=1&perPage=10
Authorization: AccessToken=<TOKEN>
```

Rules:

- `page` starts at 1.
- `perPage` must be from 1 through 20.
- Only completed `won` and `lost` rounds are returned.
- Results are ordered newest first.

Response:

```json
{
  "data": {
    "totalCount": 21,
    "currentPage": 1,
    "totalPages": 3,
    "data": [
      {
        "id": "42",
        "currency": "SC",
        "roundId": "6b0c48a4-77ad-4b32-a203-c100c610c730",
        "betAmount": "10.00000000",
        "gameDifficulty": "easy",
        "currentFloorCount": 10,
        "maxFloor": 24,
        "crashFloor": 18,
        "winningAmount": "16.17000000",
        "payoutMultiplier": "1.61666600",
        "result": "won",
        "clientSeed": "my-client-seed",
        "serverSeedHash": "hash",
        "nonce": 3,
        "createdAt": "2026-08-17T10:00:00.000Z",
        "updatedAt": "2026-08-17T10:05:00.000Z"
      }
    ]
  },
  "errors": []
}
```

Sequelize decimal fields such as `betAmount`, `winningAmount`, and `payoutMultiplier` may be strings in database-read endpoints. Convert them with `Number(value)` only for calculations/formatting, while retaining the original value when exact serialization matters.

## 12. Get Bet by ID

```http
GET /api/v1/original-games/mega-block/bets/42
Authorization: AccessToken=<TOKEN>
```

This returns the full owned bet row plus:

```json
{
  "seedRevealed": false
}
```

Behavior:

- An open bet does not contain `crashFloor` and always reports `seedRevealed: false`.
- A completed bet contains `crashFloor`.
- A plaintext `serverSeed` is never returned here.
- Use the provably-fair verification endpoint to obtain a revealed server seed.

## 13. Provably Fair APIs

These APIs use the same token but live under `/provably-fair`.

### Current Seed State

```http
GET /api/v1/original-games/provably-fair/state
Authorization: AccessToken=<TOKEN>
```

Use this for the current hash, next hash, and nonce fairness panel.

### Rotate Seed

```http
POST /api/v1/original-games/provably-fair/rotate-seed
Authorization: AccessToken=<TOKEN>
Content-Type: application/json

{}
```

Rotation is blocked while any stateful original game round is open, including MegaBlock. Do not offer seed rotation during an active round.

### Verify Completed MegaBlock Bet

```http
POST /api/v1/original-games/provably-fair/verify
Authorization: AccessToken=<TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "betId": "42",
  "gameKey": "mega-block"
}
```

Response after the relevant seed has been rotated/revealed:

```json
{
  "data": {
    "betId": "42",
    "clientSeed": "my-client-seed",
    "nonce": 3,
    "serverSeedHash": "hash",
    "serverSeed": "revealed-plain-server-seed",
    "seedRevealed": true
  },
  "errors": []
}
```

Before rotation, `serverSeed` is `null` and `seedRevealed` is `false`. An open MegaBlock round never reveals its server seed.

## 14. Frontend Endpoint Functions

Add these functions to `src/services/endpoints.js` using the existing helpers:

```js
export const getMegaBlockSettings = (token) =>
  getRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/settings`,
    undefined,
    originalGamesAuthHeaders(token)
  );

export const getUnfinishedMegaBlockBet = (token) =>
  getRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/unfinished-bet`,
    undefined,
    originalGamesAuthHeaders(token)
  );

export const placeMegaBlockBet = (data, token) =>
  postRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/place-bet`,
    data,
    originalGamesAuthHeaders(token)
  );

export const dropMegaBlock = (betId, token) =>
  postRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/drop-block`,
    { betId: String(betId) },
    originalGamesAuthHeaders(token)
  );

export const cashOutMegaBlock = (betId, token) =>
  postRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/cash-out`,
    { betId: String(betId) },
    originalGamesAuthHeaders(token)
  );

export const getMegaBlockBets = (page = 1, perPage = 10, token) =>
  getRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/bets`,
    { page, perPage },
    originalGamesAuthHeaders(token)
  );

export const getMegaBlockBetById = (betId, token) =>
  getRequest(
    `${ORIGINAL_GAMES_API_URL}/mega-block/bets/${betId}`,
    undefined,
    originalGamesAuthHeaders(token)
  );
```

## 15. Suggested Frontend State

The integration is implemented in:

```text
src/components/original-games/megablock/hooks/useMegaBlockGame.js
```

Consume it from the visual game component:

```js
const {
  canPlace,
  canDrop,
  canCashOut,
  controlsLocked,
  initializing,
  processing,
  round,
  settings,
  placeBet,
  drop,
  cashOut,
  resetResolvedRound,
  retryInitialization
} = useMegaBlockGame();
```

- Use `controlsLocked` for amount and difficulty inputs.
- Use `canPlace`, `canDrop`, and `canCashOut` for their matching buttons.
- Show a blocking loading state while `initializing` is true.
- If initialization fails, keep Place disabled and connect Retry to `retryInitialization`.
- After the result animation, call `resetResolvedRound`; Place remains disabled until this confirms no unfinished round remains.

```js
const initialMegaBlockState = {
  status: 'idle', // idle | placing | active | dropping | cashingOut | won | lost
  betId: null,
  betAmount: 0,
  currency: null,
  difficulty: 'easy',
  maxFloor: 24,
  completedFloorCount: 0,
  payoutMultiplier: 1,
  winningAmount: 0,
  balance: null,
  clientSeed: '',
  serverSeedHash: null,
  nonce: null,
  crashFloor: null,
  error: null
};
```

Use `completedFloorCount` from backend responses as the source of truth. Do not increment it optimistically before a Drop response arrives.

## 16. Error Handling

Important backend errors:

| Error | Meaning | Frontend action |
|---|---|---|
| Authentication error | Token missing, expired, or for another game | Stop play and restart the launch flow |
| `OperatorSessionInvalidErrorType` | A1 session is invalid or expired | Show session-expired state |
| `OriginalGameNotFoundErrorType` | MegaBlock/currency settings are missing | Show game unavailable |
| `OriginalGameNotAvailableErrorType` | Game is inactive | Show game unavailable |
| `BetAmountOutOfRangeErrorType` | Amount is outside current limits | Refresh settings and highlight amount |
| `InsufficientBalanceErrorType` | Wallet cannot debit the stake | Show insufficient balance |
| `OpenBetExistsErrorType` | Player already has an open MegaBlock round | Call `unfinished-bet` and restore it |
| `NoOpenBetErrorType` | Bet is not open, not owned, or already resolved | Clear local active state and refresh history |
| `MegaBlockNoFloorsCompletedErrorType` | Cash-out attempted at floor 0 | Keep Cash Out disabled until one safe floor |
| `WalletServiceUnavailableErrorType` | External wallet settlement failed | Keep current UI state and allow a controlled retry |
| Input validation error | Body/query does not match the API schema | Treat as a frontend implementation error |

Do not infer game outcome from an HTTP error. Only a successful response with `result: "won"` or `result: "lost"` resolves the frontend round.

## 17. Interaction Safety

- Allow only one Place, Drop, or Cash Out request at a time.
- Treat unfinished-bet loading as a blocking initialization state, not as an optional background request.
- Disable Place while an unfinished round exists.
- Disable Cash Out when `completedFloorCount === 0`.
- Disable Drop and Cash Out permanently after `result` becomes `won` or `lost`.
- If a Drop or Cash Out request times out, call `GET /unfinished-bet` before retrying. The original request may have completed even if the response was lost.
- If the timeout happened during Place Bet, call `GET /unfinished-bet` before allowing another Place request. The debit and bet creation may already have succeeded.
- Never display or log operator tokens, casino session IDs, plaintext server seeds, or an open round's crash floor.
- Format wallet amounts using the currency rules, but always use backend `winningAmount` and `balance` as authoritative values.

## 18. Minimal Call Sequence

```text
POST /launch
  -> GET /mega-block/settings
  -> GET /mega-block/unfinished-bet
  -> POST /mega-block/place-bet
  -> POST /mega-block/drop-block (repeat while result is null)
       -> crash: result=lost, stop
       -> final safe floor: result=won, stop
       -> otherwise: result=null, continue or cash out
  -> POST /mega-block/cash-out (optional after at least one safe floor)
  -> GET /mega-block/bets
```
