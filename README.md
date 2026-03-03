# Tien Len Mien Nam (2-4 Players, WebSocket)

Node.js app for 2 to 4 players to play Tiến Lên Miền Nam over WebSocket.

## Run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in 2-4 browser tabs/windows.

## Deploy on Netlify

This repo is prepared for Netlify static hosting of the frontend (`public/`).

1. Deploy this repository to Netlify (publish dir is already set in `netlify.toml`).
2. Set your websocket backend URL in [public/config.js](/Volumes/ilyarozanov/tien%20len%20mien%20nam/public/config.js):

```js
window.TLMN_CONFIG = { WS_URL: 'wss://your-backend-domain' };
```

3. Redeploy.

Notes:
- Netlify serves the client UI.
- The realtime websocket game server still needs to run on a websocket-capable backend host.

## Gameplay implemented

- 2 to 4 players in one room
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
