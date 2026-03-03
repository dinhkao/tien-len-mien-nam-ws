const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['S', 'C', 'D', 'H'];
const SUIT_SYMBOL = { S: '♠', C: '♣', D: '♦', H: '♥' };
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 3]));
const SUIT_VALUE = { S: 1, C: 2, D: 3, H: 4 };

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardValue(card) {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

function sortCards(cards) {
  return [...cards].sort((a, b) => cardValue(a) - cardValue(b));
}

function cardsToPretty(cards) {
  return cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' ');
}

function byRankGroups(cards) {
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.rank)) groups.set(c.rank, []);
    groups.get(c.rank).push(c);
  }
  return groups;
}

function getCombo(cards) {
  if (!cards || cards.length === 0) return null;
  const sorted = sortCards(cards);
  const groups = byRankGroups(sorted);
  const count = sorted.length;
  const ranks = [...groups.keys()].sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b]);

  if (count === 1) {
    return {
      type: 'single',
      size: 1,
      rank: sorted[0].rank,
      highRankValue: RANK_VALUE[sorted[0].rank],
      highSuitValue: SUIT_VALUE[sorted[0].suit],
      cards: sorted,
      containsTwo: sorted[0].rank === '2',
    };
  }

  if (groups.size === 1) {
    const rank = sorted[0].rank;
    if (count === 2) {
      return {
        type: 'pair',
        size: 2,
        rank,
        highRankValue: RANK_VALUE[rank],
        cards: sorted,
        containsTwo: rank === '2',
      };
    }
    if (count === 3) {
      return {
        type: 'triple',
        size: 3,
        rank,
        highRankValue: RANK_VALUE[rank],
        cards: sorted,
        containsTwo: rank === '2',
      };
    }
    if (count === 4) {
      return {
        type: 'quad',
        size: 4,
        rank,
        highRankValue: RANK_VALUE[rank],
        cards: sorted,
        containsTwo: rank === '2',
      };
    }
  }

  if (count >= 3 && groups.size === count) {
    const rankValues = ranks.map((r) => RANK_VALUE[r]);
    if (rankValues.includes(RANK_VALUE['2'])) return null;
    let consecutive = true;
    for (let i = 1; i < rankValues.length; i++) {
      if (rankValues[i] !== rankValues[i - 1] + 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      return {
        type: 'straight',
        size: count,
        highRankValue: rankValues[rankValues.length - 1],
        cards: sorted,
        containsTwo: false,
      };
    }
  }

  // Pair straight (doi thong): 3 or more consecutive pairs, no 2.
  if (count >= 6 && count % 2 === 0) {
    const chainLength = count / 2;
    if (groups.size === chainLength) {
      const rankValues = ranks.map((r) => RANK_VALUE[r]);
      if (!rankValues.includes(RANK_VALUE['2'])) {
        const allPairs = ranks.every((r) => groups.get(r).length === 2);
        let consecutive = true;
        for (let i = 1; i < rankValues.length; i++) {
          if (rankValues[i] !== rankValues[i - 1] + 1) {
            consecutive = false;
            break;
          }
        }
        if (allPairs && consecutive) {
          return {
            type: 'pair_straight',
            size: count,
            chainLength,
            highRankValue: rankValues[rankValues.length - 1],
            cards: sorted,
            containsTwo: false,
          };
        }
      }
    }
  }

  return null;
}

function comboBeats(next, current) {
  if (!next) return false;
  if (!current) return true;

  const isSingleTwo = current.type === 'single' && current.containsTwo;
  const isPairTwo = current.type === 'pair' && current.containsTwo;
  const isQuad = current.type === 'quad';
  const isThreePairStraight = current.type === 'pair_straight' && current.chainLength === 3;
  const nextIsPairStraight = next.type === 'pair_straight';
  const nextIsThreePairStraight = nextIsPairStraight && next.chainLength === 3;
  const nextIsFourPlusPairStraight = nextIsPairStraight && next.chainLength >= 4;

  if (isSingleTwo) {
    if (next.type === 'quad') return true;
    if (nextIsPairStraight && next.chainLength >= 3) return true;
  }
  if (isPairTwo) {
    if (next.type === 'quad') return true;
    if (nextIsFourPlusPairStraight) return true;
  }
  if (isQuad) {
    if (next.type === 'quad') return next.highRankValue > current.highRankValue;
    if (nextIsFourPlusPairStraight) return true;
    return false;
  }
  if (isThreePairStraight) {
    if (next.type === 'quad') return true;
    if (nextIsFourPlusPairStraight) return true;
    if (nextIsThreePairStraight) return next.highRankValue > current.highRankValue;
    return false;
  }

  if (next.type !== current.type) return false;
  if (next.size !== current.size) return false;

  if (next.type === 'single') {
    if (next.highRankValue !== current.highRankValue) {
      return next.highRankValue > current.highRankValue;
    }
    return next.highSuitValue > current.highSuitValue;
  }

  if (next.type === 'pair_straight') {
    return next.highRankValue > current.highRankValue;
  }

  return next.highRankValue > current.highRankValue;
}

const room = {
  clients: new Map(),
  started: false,
  ended: false,
  currentTurn: 0,
  trickCombo: null,
  trickHistory: [],
  passCount: 0,
  lastPlaySeat: null,
  winnerSeat: null,
};

let nextClientId = 1;

function allClients() {
  return [...room.clients.values()];
}

function seatedClients() {
  return allClients()
    .filter((c) => c.seat !== null)
    .sort((a, b) => a.seat - b.seat);
}

function getClient(ws) {
  return room.clients.get(ws) || null;
}

function getClientBySeat(seat) {
  return seatedClients().find((c) => c.seat === seat) || null;
}

function seatOrder() {
  return [...Array(MAX_PLAYERS).keys()];
}

function nextActiveSeat(currentSeat) {
  const players = seatedClients();
  if (players.length === 0) return null;
  const idx = players.findIndex((p) => p.seat === currentSeat);
  if (idx === -1) return players[0].seat;
  return players[(idx + 1) % players.length].seat;
}

function canStartGame() {
  const count = seatedClients().length;
  return count >= MIN_PLAYERS && count <= MAX_PLAYERS && (!room.started || room.ended);
}

function sendTo(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const c of allClients()) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
  }
}

function publicState(forSeat) {
  const players = seatedClients();
  return {
    started: room.started,
    ended: room.ended,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    canStart: canStartGame(),
    currentTurn: room.currentTurn,
    trickCombo: room.trickCombo
      ? {
          type: room.trickCombo.type,
          size: room.trickCombo.size,
          cards: room.trickCombo.cards.map((c) => c.id),
        }
      : null,
    trickHistory: room.trickHistory.slice(-20),
    passCount: room.passCount,
    lastPlaySeat: room.lastPlaySeat,
    winnerSeat: room.winnerSeat,
    players: players.map((p) => ({
      seat: p.seat,
      name: p.name,
      connected: p.ws.readyState === p.ws.OPEN,
      cardsCount: p.cards.length,
      revealedCards: room.ended ? sortCards(p.cards).map((card) => card.id) : null,
      isYou: p.seat === forSeat,
    })),
    seatOrder: seatOrder(),
    viewerCount: Math.max(0, allClients().length - players.length),
  };
}

function sendState() {
  for (const c of allClients()) {
    sendTo(c.ws, {
      type: 'state',
      you: {
        seat: c.seat,
        name: c.name,
        cards: c.seat !== null ? sortCards(c.cards).map((card) => card.id) : [],
      },
      game: publicState(c.seat),
    });
  }
}

function resetRoundFrom(seat) {
  room.trickCombo = null;
  room.passCount = 0;
  room.lastPlaySeat = null;
  room.currentTurn = seat;
  broadcast({ type: 'round_reset', nextTurn: seat });
}

function resetGame(reason) {
  room.started = false;
  room.ended = false;
  room.currentTurn = 0;
  room.trickCombo = null;
  room.trickHistory = [];
  room.passCount = 0;
  room.lastPlaySeat = null;
  room.winnerSeat = null;
  for (const c of allClients()) c.cards = [];

  if (reason) broadcast({ type: 'info', message: reason });
  sendState();
}

function startGame() {
  if (!canStartGame()) return;

  const players = seatedClients();
  const deck = shuffle(createDeck());
  const cardsPerPlayer = 13;
  const totalCardsNeeded = players.length * cardsPerPlayer;

  // Ensure 3S is always in dealt cards so opening rule remains valid.
  const idx3S = deck.findIndex((c) => c.id === '3S');
  if (idx3S >= totalCardsNeeded && totalCardsNeeded > 0) {
    const swapIdx = randomInt(0, totalCardsNeeded);
    [deck[idx3S], deck[swapIdx]] = [deck[swapIdx], deck[idx3S]];
  }

  for (const c of allClients()) c.cards = [];
  const dealStart = randomInt(0, players.length);
  const clockwise = randomInt(0, 2) === 0;
  const playerCount = players.length;
  for (let i = 0; i < totalCardsNeeded; i++) {
    const offset = clockwise ? i : -i;
    const playerIdx = (dealStart + offset % playerCount + playerCount) % playerCount;
    players[playerIdx].cards.push(deck[i]);
  }

  room.started = true;
  room.ended = false;
  room.trickCombo = null;
  room.trickHistory = [];
  room.passCount = 0;
  room.lastPlaySeat = null;
  room.winnerSeat = null;

  const first = players.find((p) => p.cards.some((c) => c.id === '3S'));
  room.currentTurn = first ? first.seat : players[0].seat;

  broadcast({ type: 'game_started', firstTurn: room.currentTurn, playerCount: players.length });
  sendState();
}

function removePlayedCards(hand, cardsToRemove) {
  const ids = new Set(cardsToRemove.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
}

function validateOwnership(player, cardIds) {
  const handMap = new Map(player.cards.map((c) => [c.id, c]));
  const picked = [];
  for (const id of cardIds) {
    const c = handMap.get(id);
    if (!c) return { ok: false, cards: [] };
    picked.push(c);
  }

  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, cards: [] };
  }

  return { ok: true, cards: picked };
}

function handleSetName(client, data) {
  const name = String(data?.name || '').trim();
  if (name) {
    client.name = name.slice(0, 24);
    client.hasCustomName = true;
  }
  sendTo(client.ws, { type: 'joined', seat: client.seat, name: client.name });
  sendState();
}

function handleSit(client, data) {
  if (room.started && !room.ended) {
    return sendTo(client.ws, { type: 'error', message: 'Cannot sit while game is in progress.' });
  }

  const inputName = String(data?.name || '').trim();
  if (inputName) {
    client.name = inputName.slice(0, 24);
    client.hasCustomName = true;
  }

  if (!client.hasCustomName) {
    return sendTo(client.ws, { type: 'error', message: 'Please enter your name before joining the table.' });
  }

  if (client.seat !== null) {
    return sendTo(client.ws, { type: 'joined', seat: client.seat, name: client.name });
  }

  const freeSeats = [...Array(MAX_PLAYERS).keys()].filter((s) => !getClientBySeat(s));
  if (freeSeats.length === 0) {
    return sendTo(client.ws, { type: 'error', message: 'No empty seat is available.' });
  }

  const seat = freeSeats[0];

  const prevSeat = client.seat;
  client.seat = seat;
  client.cards = [];

  sendTo(client.ws, { type: 'joined', seat: client.seat, name: client.name });
  if (prevSeat !== seat) {
    broadcast({ type: 'player_joined', seat: client.seat, name: client.name });
  }

  if (seatedClients().length === MAX_PLAYERS && !room.started) startGame();
  else sendState();
}

function handleLeaveSeat(client) {
  if (client.seat === null) return;
  if (room.started && !room.ended) {
    return sendTo(client.ws, { type: 'error', message: 'Cannot leave seat while game is in progress.' });
  }

  const oldSeat = client.seat;
  client.seat = null;
  client.cards = [];

  broadcast({ type: 'player_left', seat: oldSeat, name: client.name });
  sendTo(client.ws, { type: 'joined', seat: null, name: client.name });
  sendState();
}

function handlePlay(client, data) {
  if (client.seat === null) {
    return sendTo(client.ws, { type: 'error', message: 'Sit on a seat before playing.' });
  }
  if (!room.started || room.ended) {
    return sendTo(client.ws, { type: 'error', message: 'Game is not active.' });
  }
  if (client.seat !== room.currentTurn) {
    return sendTo(client.ws, { type: 'error', message: 'Not your turn.' });
  }
  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    return sendTo(client.ws, { type: 'error', message: 'cards must be a non-empty array.' });
  }

  const own = validateOwnership(client, data.cards);
  if (!own.ok) {
    return sendTo(client.ws, { type: 'error', message: 'Invalid cards selection.' });
  }

  const combo = getCombo(own.cards);
  if (!combo) {
    return sendTo(client.ws, { type: 'error', message: 'Invalid combination.' });
  }

  const isOpeningPlay = room.trickCombo === null && room.trickHistory.length === 0;
  if (isOpeningPlay) {
    const has3S = own.cards.some((c) => c.id === '3S');
    if (!has3S) {
      return sendTo(client.ws, { type: 'error', message: 'First play must include 3S.' });
    }
  }

  if (!comboBeats(combo, room.trickCombo)) {
    return sendTo(client.ws, { type: 'error', message: 'Your play does not beat current combo.' });
  }

  client.cards = removePlayedCards(client.cards, own.cards);

  room.trickCombo = combo;
  room.lastPlaySeat = client.seat;
  room.passCount = 0;
  room.trickHistory.push({
    action: 'play',
    seat: client.seat,
    name: client.name,
    comboType: combo.type,
    cards: combo.cards.map((c) => c.id),
    pretty: cardsToPretty(combo.cards),
    at: Date.now(),
  });

  if (client.cards.length === 0) {
    room.ended = true;
    room.winnerSeat = client.seat;
    broadcast({ type: 'game_ended', winnerSeat: client.seat, winnerName: client.name });
    return sendState();
  }

  room.currentTurn = nextActiveSeat(client.seat);
  sendState();
}

function handlePass(client) {
  if (client.seat === null) {
    return sendTo(client.ws, { type: 'error', message: 'Sit on a seat before passing.' });
  }
  if (!room.started || room.ended) {
    return sendTo(client.ws, { type: 'error', message: 'Game is not active.' });
  }
  if (client.seat !== room.currentTurn) {
    return sendTo(client.ws, { type: 'error', message: 'Not your turn.' });
  }
  if (!room.trickCombo) {
    return sendTo(client.ws, { type: 'error', message: 'Cannot pass on an empty trick.' });
  }
  if (room.lastPlaySeat === client.seat) {
    return sendTo(client.ws, { type: 'error', message: 'Last player who played cannot pass.' });
  }

  room.passCount += 1;
  room.trickHistory.push({
    action: 'pass',
    seat: client.seat,
    name: client.name,
    at: Date.now(),
  });

  room.currentTurn = nextActiveSeat(client.seat);

  const activeCount = seatedClients().length;
  if (room.passCount >= activeCount - 1 && room.lastPlaySeat !== null) {
    resetRoundFrom(room.lastPlaySeat);
  }

  sendState();
}

function handleStart(client) {
  if (client.seat === null) {
    return sendTo(client.ws, { type: 'error', message: 'Sit on a seat before starting.' });
  }
  if (room.started && !room.ended) {
    return sendTo(client.ws, { type: 'error', message: 'Game is already in progress.' });
  }
  if (seatedClients().length < MIN_PLAYERS) {
    return sendTo(client.ws, { type: 'error', message: `Need at least ${MIN_PLAYERS} players to start.` });
  }
  startGame();
}

function handleDisconnect(ws) {
  const client = getClient(ws);
  if (!client) return;

  const hadSeat = client.seat !== null;
  const oldSeat = client.seat;
  const oldName = client.name;
  room.clients.delete(ws);

  if (hadSeat) {
    broadcast({ type: 'player_left', seat: oldSeat, name: oldName });
    if (room.started && !room.ended) {
      return resetGame('Game reset because a seated player disconnected.');
    }
  }

  sendState();
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (urlPath === '/config.js') {
    const wsUrl = String(process.env.WS_URL || '');
    const js = `window.TLMN_CONFIG = { WS_URL: ${JSON.stringify(wsUrl)} };`;
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(js);
    return;
  }

  let file = 'public/index.html';
  if (urlPath === '/app.js') file = 'public/app.js';
  if (urlPath === '/styles.css') file = 'public/styles.css';

  const fullPath = path.join(__dirname, file);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const typeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
    };

    res.writeHead(200, { 'Content-Type': typeMap[path.extname(fullPath)] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const client = {
    id: nextClientId,
    ws,
    name: `Guest ${nextClientId}`,
    hasCustomName: false,
    seat: null,
    cards: [],
  };
  nextClientId += 1;
  room.clients.set(ws, client);

  sendTo(ws, {
    type: 'welcome',
    message:
      'Everyone can watch. Send {"type":"sit","name":"Your name"} to join the table automatically.',
  });
  sendTo(ws, { type: 'joined', seat: client.seat, name: client.name });
  sendState();

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return sendTo(ws, { type: 'error', message: 'Invalid JSON.' });
    }

    const c = getClient(ws);
    if (!c) return;

    const t = data.type;
    if (t === 'join' || t === 'set_name') return handleSetName(c, data);
    if (t === 'sit') return handleSit(c, data);
    if (t === 'leave_seat') return handleLeaveSeat(c);
    if (t === 'play') return handlePlay(c, data);
    if (t === 'pass') return handlePass(c);
    if (t === 'start') return handleStart(c);

    return sendTo(ws, { type: 'error', message: `Unknown type: ${t}` });
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});

server.listen(PORT, () => {
  console.log(`Tien Len server listening on http://localhost:${PORT}`);
});
