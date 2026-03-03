# Tien Len Mien Nam (2-4 Players, WebSocket)

Node.js app for 2 to 4 players to play Tiến Lên Miền Nam over WebSocket.

## Run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in 2-4 browser tabs/windows.

## Deploy on Railway (recommended)

This app is ready to run on Railway as a single service (frontend + websocket backend in one `server.js` process).

### Option A: Deploy from GitHub

1. Push code to GitHub.
2. In Railway dashboard: `New Project` -> `Deploy from GitHub repo`.
3. Railway auto-detects Node and runs `npm start`.
4. Open the generated Railway domain.

### Option B: Deploy with Railway CLI

```bash
railway login
railway init
railway up
```

### Environment variables

- `PORT`: auto-injected by Railway (already supported in code).
- `WS_URL` (optional): if set, frontend will use this websocket URL via dynamic `/config.js`.
  - For single-service Railway deploy, leave `WS_URL` empty.

### Healthcheck

- `GET /health` returns `ok`.
- `railway.json` is included with start command + healthcheck path.

## Deploy on Netlify (frontend only, optional)

If you deploy frontend on Netlify, you still need a separate websocket backend host and set `WS_URL` accordingly.

## Gameplay implemented

- Single shared table for all connected clients (spectators can watch live)
- Click `+` on an empty seat to sit and play
- 2 to 4 seated players per game
- Auto-start when player 4 joins, or click **Start Game** with 2-3 players
- 52-card deck distributed evenly in round-robin among current players
- First turn must include `3S` (3 of Spades)
- Turn actions: `play` or `pass`
- Round resets after all other active players pass following a valid play
- Winner is the first player with 0 cards

## Supported combinations

- `single`
- `pair`
- `triple`
- `quad` (four of a kind)
- `straight` (length >= 3, cannot include 2)
- `pair_straight` / `doi_thong` (3 or more consecutive pairs, cannot include 2)

Comparison rules in this implementation:

- Must match combination type and size to beat, except bomb/chặt rules
- Singles compare rank, then suit (`S < C < D < H`)
- Other same-type combinations compare rank
- Chặt rules:
  - `3 đôi thông` beats `single 2` and lower `3 đôi thông`
  - `tứ quý` beats `single 2`, `pair 2`, `3 đôi thông`, and lower `tứ quý`
  - `4 đôi thông` beats `single 2`, `pair 2`, `3 đôi thông`, `tứ quý`, and lower `4 đôi thông`

## WebSocket protocol

Client -> Server:

- `{"type":"join","name":"Alice"}`
- `{"type":"start"}`
- `{"type":"play","cards":["3S","3D"]}`
- `{"type":"pass"}`

Server -> Client (examples):

- `welcome`, `joined`, `player_joined`, `player_left`
- `game_started`, `round_reset`, `game_ended`
- `state` (your hand + public game state)
- `error`
