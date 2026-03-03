const http = require('http');
const fs = require('fs');
const path = require('path');
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
    const j = Math.floor(Math.random() * (i + 1));
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

  // Bomb interactions for common Tien Len Mien Nam rules.
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

function createGame() {
  return {
    players: [],
    started: false,
    ended: false,
    currentTurn: 0,
    trickCombo: null,
    trickHistory: [],
    passCount: 0,
    lastPlaySeat: null,
    winnerSeat: null,
  };
}

const game = createGame();

function seatOrder() {
  return activePlayersSorted().map((p) => p.seat);
}

function activePlayersSorted() {
  return [...game.players].sort((a, b) => a.seat - b.seat);
}

function nextActiveSeat(currentSeat) {
  const players = activePlayersSorted();
  if (players.length === 0) return null;
  const idx = players.findIndex((p) => p.seat === currentSeat);
  if (idx === -1) return players[0].seat;
  return players[(idx + 1) % players.length].seat;
}

function canStartGame() {
  return game.players.length >= MIN_PLAYERS && game.players.length <= MAX_PLAYERS && (!game.started || game.ended);
}

function getPlayerBySocket(ws) {
  return game.players.find((p) => p.ws === ws) || null;
}

function getPlayerBySeat(seat) {
  return game.players.find((p) => p.seat === seat) || null;
}

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const p of game.players) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
  }
}

function sendTo(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function publicState(forSeat) {
  return {
    started: game.started,
    ended: game.ended,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    canStart: canStartGame(),
    currentTurn: game.currentTurn,
    trickCombo: game.trickCombo
      ? {
          type: game.trickCombo.type,
          size: game.trickCombo.size,
          cards: game.trickCombo.cards.map((c) => c.id),
        }
      : null,
    trickHistory: game.trickHistory.slice(-20),
    passCount: game.passCount,
    lastPlaySeat: game.lastPlaySeat,
    winnerSeat: game.winnerSeat,
    players: [...game.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        connected: p.ws.readyState === p.ws.OPEN,
        cardsCount: p.cards.length,
        isYou: p.seat === forSeat,
      })),
    seatOrder: seatOrder(),
  };
}

function sendState() {
  for (const p of game.players) {
    sendTo(p.ws, {
      type: 'state',
      you: {
        seat: p.seat,
        name: p.name,
        cards: sortCards(p.cards).map((c) => c.id),
      },
      game: publicState(p.seat),
    });
  }
}

function resetRoundFrom(seat) {
  game.trickCombo = null;
  game.passCount = 0;
  game.lastPlaySeat = null;
  game.currentTurn = seat;
  broadcast({ type: 'round_reset', nextTurn: seat });
}

function startGame() {
  if (!canStartGame()) return;

  const deck = shuffle(createDeck());
  const players = activePlayersSorted();
  for (const p of players) p.cards = [];

  for (let i = 0; i < deck.length; i++) {
    players[i % players.length].cards.push(deck[i]);
  }

  game.started = true;
  game.ended = false;
  game.trickCombo = null;
  game.trickHistory = [];
  game.passCount = 0;
  game.lastPlaySeat = null;
  game.winnerSeat = null;

  // First turn: player with 3S.
  const first = players.find((p) => p.cards.some((c) => c.id === '3S'));
  game.currentTurn = first ? first.seat : players[0].seat;

  broadcast({ type: 'game_started', firstTurn: game.currentTurn, playerCount: players.length });
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

  // Duplicate IDs from client are invalid.
  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, cards: [] };
  }

  return { ok: true, cards: picked };
}

function handlePlay(player, data) {
  if (!game.started || game.ended) {
    return sendTo(player.ws, { type: 'error', message: 'Game is not active.' });
  }
  if (player.seat !== game.currentTurn) {
    return sendTo(player.ws, { type: 'error', message: 'Not your turn.' });
  }
  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    return sendTo(player.ws, { type: 'error', message: 'cards must be a non-empty array.' });
  }

  const own = validateOwnership(player, data.cards);
  if (!own.ok) {
    return sendTo(player.ws, { type: 'error', message: 'Invalid cards selection.' });
  }

  const combo = getCombo(own.cards);
  if (!combo) {
    return sendTo(player.ws, { type: 'error', message: 'Invalid combination.' });
  }

  const isOpeningPlay = game.trickCombo === null && game.trickHistory.length === 0;
  if (isOpeningPlay) {
    const has3S = own.cards.some((c) => c.id === '3S');
    if (!has3S) {
      return sendTo(player.ws, { type: 'error', message: 'First play must include 3S.' });
    }
  }

  if (!comboBeats(combo, game.trickCombo)) {
    return sendTo(player.ws, { type: 'error', message: 'Your play does not beat current combo.' });
  }

  player.cards = removePlayedCards(player.cards, own.cards);

  game.trickCombo = combo;
  game.lastPlaySeat = player.seat;
  game.passCount = 0;
  game.trickHistory.push({
    action: 'play',
    seat: player.seat,
    name: player.name,
    comboType: combo.type,
    cards: combo.cards.map((c) => c.id),
    pretty: cardsToPretty(combo.cards),
    at: Date.now(),
  });

  if (player.cards.length === 0) {
    game.ended = true;
    game.winnerSeat = player.seat;
    broadcast({ type: 'game_ended', winnerSeat: player.seat, winnerName: player.name });
    return sendState();
  }

  game.currentTurn = nextActiveSeat(player.seat);
  sendState();
}

function handlePass(player) {
  if (!game.started || game.ended) {
    return sendTo(player.ws, { type: 'error', message: 'Game is not active.' });
  }
  if (player.seat !== game.currentTurn) {
    return sendTo(player.ws, { type: 'error', message: 'Not your turn.' });
  }
  if (!game.trickCombo) {
    return sendTo(player.ws, { type: 'error', message: 'Cannot pass on an empty trick.' });
  }
  if (game.lastPlaySeat === player.seat) {
    return sendTo(player.ws, { type: 'error', message: 'Last player who played cannot pass.' });
  }

  game.passCount += 1;
  game.trickHistory.push({
    action: 'pass',
    seat: player.seat,
    name: player.name,
    at: Date.now(),
  });

  game.currentTurn = nextActiveSeat(player.seat);

  // When all other active players pass after the last valid play, that player leads next round.
  if (game.passCount >= game.players.length - 1 && game.lastPlaySeat !== null) {
    const next = game.lastPlaySeat;
    resetRoundFrom(next);
  }

  sendState();
}

function handleStart(player) {
  if (game.started && !game.ended) {
    return sendTo(player.ws, { type: 'error', message: 'Game is already in progress.' });
  }
  if (game.players.length < MIN_PLAYERS) {
    return sendTo(player.ws, { type: 'error', message: `Need at least ${MIN_PLAYERS} players to start.` });
  }
  startGame();
}

function attachPlayer(ws, name) {
  if (game.started && !game.ended) {
    sendTo(ws, { type: 'error', message: 'Game is in progress. Wait for next round.' });
    ws.close();
    return;
  }
  if (game.players.length >= MAX_PLAYERS) {
    sendTo(ws, { type: 'error', message: 'Room is full.' });
    ws.close();
    return;
  }

  const seat = [...Array(MAX_PLAYERS).keys()].find((s) => !game.players.some((p) => p.seat === s));
  const player = {
    ws,
    seat,
    name: String(name || `Player ${seat + 1}`).slice(0, 24),
    cards: [],
  };

  game.players.push(player);
  sendTo(ws, { type: 'joined', seat, name: player.name });
  broadcast({ type: 'player_joined', seat, name: player.name });

  if (game.players.length === MAX_PLAYERS && !game.started) {
    startGame();
  } else {
    sendState();
  }
}

function removePlayer(ws) {
  const player = getPlayerBySocket(ws);
  if (!player) return;

  game.players = game.players.filter((p) => p.ws !== ws);
  broadcast({ type: 'player_left', seat: player.seat, name: player.name });

  // Reset game if someone disconnects.
  game.started = false;
  game.ended = false;
  game.trickCombo = null;
  game.trickHistory = [];
  game.passCount = 0;
  game.lastPlaySeat = null;
  game.winnerSeat = null;
  game.currentTurn = 0;

  if (game.players.length > 0) {
    broadcast({ type: 'info', message: 'Game reset because a player disconnected.' });
    sendState();
  }
}

const server = http.createServer((req, res) => {
  let file = 'public/index.html';
  if (req.url === '/app.js') file = 'public/app.js';
  if (req.url === '/config.js') file = 'public/config.js';
  if (req.url === '/styles.css') file = 'public/styles.css';

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
  sendTo(ws, {
    type: 'welcome',
    message: 'Send {"type":"join","name":"Your name"} to join. Then send {"type":"start"} when 2-4 players are ready.',
  });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return sendTo(ws, { type: 'error', message: 'Invalid JSON.' });
    }

    const t = data.type;
    if (t === 'join') {
      const existing = getPlayerBySocket(ws);
      if (existing) {
        return sendTo(ws, { type: 'error', message: 'Already joined.' });
      }
      return attachPlayer(ws, data.name);
    }

    const player = getPlayerBySocket(ws);
    if (!player) {
      return sendTo(ws, { type: 'error', message: 'Join first.' });
    }

    if (t === 'play') return handlePlay(player, data);
    if (t === 'pass') return handlePass(player);
    if (t === 'start') return handleStart(player);

    return sendTo(ws, { type: 'error', message: `Unknown type: ${t}` });
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

server.listen(PORT, () => {
  console.log(`Tien Len server listening on http://localhost:${PORT}`);
});
