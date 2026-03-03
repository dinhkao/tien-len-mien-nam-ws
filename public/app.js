function normalizeWsUrl(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value) return '';

  if (value.startsWith('ws://') || value.startsWith('wss://')) return value;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  return value;
}

function resolveWsUrl() {
  const configured = normalizeWsUrl(window.TLMN_CONFIG?.WS_URL);
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}`;
}

const WS_URL = resolveWsUrl();
const ws = new WebSocket(WS_URL);
let hand = [];
let selected = new Set();
let seat = null;
let latestGameState = null;

const nameEl = document.getElementById('name');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const playBtn = document.getElementById('playBtn');
const passBtn = document.getElementById('passBtn');
const handEl = document.getElementById('hand');
const gameEl = document.getElementById('game');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const seatTopEl = document.getElementById('seat-top');
const seatLeftEl = document.getElementById('seat-left');
const seatRightEl = document.getElementById('seat-right');
const seatBottomEl = document.getElementById('seat-bottom');
const turnInfoEl = document.getElementById('turnInfo');
const lastPlayByEl = document.getElementById('lastPlayBy');
const lastPlayCardsEl = document.getElementById('lastPlayCards');
const SUIT_ICON = { S: '♠', C: '♣', D: '♦', H: '♥' };
const RED_SUITS = new Set(['D', 'H']);
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 3]));
const SUIT_VALUE = { S: 1, C: 2, D: 3, H: 4 };

function parseCard(cardId) {
  const m = String(cardId).match(/^(10|[3-9JQKA2])([SCDH])$/);
  if (!m) return null;
  return { rank: m[1], suit: m[2] };
}

function cardValue(card) {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

function sortCards(cards) {
  return [...cards].sort((a, b) => cardValue(a) - cardValue(b));
}

function getComboFromIds(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const parsed = cardIds.map((id) => {
    const p = parseCard(id);
    return p ? { id, rank: p.rank, suit: p.suit } : null;
  });
  if (parsed.some((c) => !c)) return null;
  if (new Set(cardIds).size !== cardIds.length) return null;

  const cards = sortCards(parsed);
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.rank)) groups.set(c.rank, []);
    groups.get(c.rank).push(c);
  }

  const count = cards.length;
  const ranks = [...groups.keys()].sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b]);

  if (count === 1) {
    return {
      type: 'single',
      size: 1,
      highRankValue: RANK_VALUE[cards[0].rank],
      highSuitValue: SUIT_VALUE[cards[0].suit],
      containsTwo: cards[0].rank === '2',
    };
  }

  if (groups.size === 1) {
    const rank = cards[0].rank;
    if (count === 2 || count === 3 || count === 4) {
      return {
        type: count === 2 ? 'pair' : count === 3 ? 'triple' : 'quad',
        size: count,
        highRankValue: RANK_VALUE[rank],
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
        containsTwo: false,
      };
    }
  }

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

  if (next.type !== current.type || next.size !== current.size) return false;

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

function isSelectedPlayable(gameState) {
  if (!gameState || seat === null) return false;
  if (!gameState.started || gameState.ended) return false;
  if (gameState.currentTurn !== seat) return false;

  const selectedIds = [...selected];
  const nextCombo = getComboFromIds(selectedIds);
  if (!nextCombo) return false;

  const openingPlay = gameState.trickCombo === null && Array.isArray(gameState.trickHistory) && gameState.trickHistory.length === 0;
  if (openingPlay && !selectedIds.includes('3S')) return false;

  if (!gameState.trickCombo) return true;

  const currentCombo = getComboFromIds(gameState.trickCombo.cards || []);
  if (!currentCombo) return false;

  return comboBeats(nextCombo, currentCombo);
}

function updateActionButtons() {
  const joined = seat !== null;
  const game = latestGameState;

  if (!game) {
    startBtn.disabled = true;
    playBtn.disabled = true;
    passBtn.disabled = true;
    return;
  }

  const yourTurn = game.currentTurn === seat;
  const canPlayTurn = joined && game.started && !game.ended && yourTurn;
  const canPass = canPlayTurn && !!game.trickCombo && game.lastPlaySeat !== seat;

  startBtn.disabled = !joined || !game.canStart;
  playBtn.disabled = !canPlayTurn || !isSelectedPlayable(game);
  passBtn.disabled = !canPass;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rotateToSeat(order, startSeat) {
  if (!Array.isArray(order) || order.length === 0) return [];
  const idx = order.indexOf(startSeat);
  if (idx === -1) return [...order];
  return [...order.slice(idx), ...order.slice(0, idx)];
}

function renderOpponentCards(count, vertical = false) {
  const shown = Math.min(count, 10);
  const backs = Array.from({ length: shown }, (_, i) => `<span class="card-back" style="--i:${i}"></span>`).join('');
  const extra = count > shown ? `<span class="card-more">+${count - shown}</span>` : '';
  return `<div class="opponent-cards ${vertical ? 'vertical' : ''}">${backs}${extra}</div>`;
}

function renderFaceCard(cardId, className) {
  const parsed = parseCard(cardId);
  if (!parsed) return `<div class="${className}">${escapeHtml(cardId)}</div>`;
  const colorClass = RED_SUITS.has(parsed.suit) ? 'red' : 'black';
  return `<div class="${className} ${colorClass}"><span class="rank">${parsed.rank}</span><span class="suit">${SUIT_ICON[parsed.suit]}</span></div>`;
}

function log(msg) {
  logEl.textContent = `${new Date().toLocaleTimeString()} ${msg}\n` + logEl.textContent;
}

function renderTurnInfo(gameState, currentPlayer) {
  if (!gameState.started) {
    turnInfoEl.textContent = 'Chờ bắt đầu ván (2-4 người)';
    turnInfoEl.classList.remove('you');
    return;
  }
  if (gameState.ended) {
    const winner = gameState.players.find((p) => p.seat === gameState.winnerSeat);
    turnInfoEl.textContent = winner ? `${winner.name} thắng ván` : 'Ván đã kết thúc';
    turnInfoEl.classList.remove('you');
    return;
  }

  if (!currentPlayer) {
    turnInfoEl.textContent = 'Đang chờ lượt';
    turnInfoEl.classList.remove('you');
    return;
  }

  if (currentPlayer.seat === seat) {
    turnInfoEl.textContent = `Đến lượt bạn`;
    turnInfoEl.classList.add('you');
    return;
  }

  turnInfoEl.textContent = `Đến lượt ${currentPlayer.name}`;
  turnInfoEl.classList.remove('you');
}

function layoutHand() {
  const count = hand.length;
  const style = getComputedStyle(handEl);
  const cardWidth = parseFloat(style.getPropertyValue('--hand-card-width')) || 62;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const usableWidth = Math.max(0, handEl.clientWidth - padLeft - padRight);

  if (count <= 1) {
    handEl.style.setProperty('--computed-card-step', `${cardWidth}px`);
    return;
  }

  // Fit exactly in one row: total = cardWidth + (count - 1) * step
  const rawStep = (usableWidth - cardWidth) / (count - 1);
  const step = Math.max(2, rawStep);
  handEl.style.setProperty('--computed-card-step', `${step}px`);
}

function renderHand() {
  handEl.innerHTML = '';
  for (const card of hand) {
    const parsed = parseCard(card);
    const suitIcon = parsed ? SUIT_ICON[parsed.suit] : '?';
    const rankText = parsed ? parsed.rank : card;

    const b = document.createElement('button');
    b.className = `card ${selected.has(card) ? 'selected' : ''} ${
      parsed && RED_SUITS.has(parsed.suit) ? 'red' : 'black'
    }`;
    b.innerHTML = `<span class="rank">${rankText}</span><span class="suit">${suitIcon}</span>`;
    b.title = card;
    b.onclick = () => {
      if (selected.has(card)) selected.delete(card);
      else selected.add(card);
      renderHand();
      updateActionButtons();
    };
    handEl.appendChild(b);
  }

  layoutHand();
}

function renderSeats(gameState) {
  const slotEls = {
    top: seatTopEl,
    left: seatLeftEl,
    right: seatRightEl,
    bottom: seatBottomEl,
  };
  const positions = ['bottom', 'right', 'top', 'left'];
  const playersBySeat = new Map(gameState.players.map((p) => [p.seat, p]));
  const baseOrder = Array.isArray(gameState.seatOrder) ? gameState.seatOrder : gameState.players.map((p) => p.seat);
  const order = seat !== null ? rotateToSeat(baseOrder, seat) : baseOrder;

  Object.values(slotEls).forEach((el) => {
    el.innerHTML = '<div class="empty-seat">Đang chờ người chơi...</div>';
  });

  for (let i = 0; i < order.length && i < 4; i++) {
    const player = playersBySeat.get(order[i]);
    if (!player) continue;
    const pos = positions[i];
    const slot = slotEls[pos];
    const isTurn = gameState.started && !gameState.ended && gameState.currentTurn === player.seat;
    const isYou = player.seat === seat;
    const vertical = pos === 'left' || pos === 'right';
    const label = isYou ? 'Bạn' : `Ghế ${player.seat}`;

    slot.innerHTML = `
      <div class="player-panel ${isTurn ? 'turn' : ''} ${isYou ? 'you' : ''}">
        <div class="player-row">
          <span class="player-name">${escapeHtml(player.name)}</span>
          <span class="badge">${label}</span>
        </div>
        <div class="player-meta">${player.cardsCount} lá bài</div>
        ${isYou ? '' : renderOpponentCards(player.cardsCount, vertical)}
      </div>
    `;
  }
}

function renderCenter(gameState) {
  const currentPlayer = gameState.players.find((p) => p.seat === gameState.currentTurn);
  renderTurnInfo(gameState, currentPlayer);

  if (gameState.ended) {
    const winner = gameState.players.find((p) => p.seat === gameState.winnerSeat);
    lastPlayByEl.textContent = winner ? `Người thắng: ${winner.name}` : 'Ván kết thúc';
    lastPlayCardsEl.innerHTML = '';
    return;
  }

  if (!gameState.trickCombo || !Array.isArray(gameState.trickCombo.cards) || gameState.trickCombo.cards.length === 0) {
    lastPlayByEl.textContent = 'Lượt mới: chưa có bài ở giữa';
    lastPlayCardsEl.innerHTML = '';
    return;
  }

  const bySeat = gameState.lastPlaySeat;
  const byPlayer = gameState.players.find((p) => p.seat === bySeat);
  lastPlayByEl.textContent = byPlayer ? `Bài vừa đánh: ${byPlayer.name}` : 'Bài vừa đánh';
  lastPlayCardsEl.innerHTML = gameState.trickCombo.cards.map((c) => renderFaceCard(c, 'center-card')).join('');
}

joinBtn.onclick = () => {
  ws.send(JSON.stringify({ type: 'join', name: nameEl.value.trim() || undefined }));
};

startBtn.onclick = () => {
  ws.send(JSON.stringify({ type: 'start' }));
};

playBtn.onclick = () => {
  const cards = [...selected];
  ws.send(JSON.stringify({ type: 'play', cards }));
};

passBtn.onclick = () => {
  ws.send(JSON.stringify({ type: 'pass' }));
};

ws.onopen = () => {
  statusEl.textContent = `Connected: ${WS_URL}`;
  log('Connected');
};

ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);

  if (data.type === 'error') log(`Error: ${data.message}`);
  if (data.type === 'welcome') {
    statusEl.textContent = 'Connected';
    log(data.message);
  }
  if (data.type === 'joined') {
    seat = data.seat;
    statusEl.textContent = `Đã vào bàn: ${data.name} (ghế ${seat})`;
    log('Joined room');
    updateActionButtons();
  }
  if (data.type === 'player_joined') log(`${data.name} joined (seat ${data.seat})`);
  if (data.type === 'player_left') log(`${data.name} left`);
  if (data.type === 'game_started') log(`Game started, first turn seat ${data.firstTurn}`);
  if (data.type === 'round_reset') log(`Round reset, seat ${data.nextTurn} starts`);
  if (data.type === 'game_ended') log(`Winner: ${data.winnerName} (seat ${data.winnerSeat})`);
  if (data.type === 'info') log(data.message);

  if (data.type === 'state') {
    latestGameState = data.game;
    hand = data.you.cards;
    selected = new Set([...selected].filter((c) => hand.includes(c)));
    renderHand();
    renderSeats(latestGameState);
    renderCenter(latestGameState);
    gameEl.textContent = JSON.stringify(latestGameState, null, 2);
    updateActionButtons();
  }
};

ws.onclose = () => {
  latestGameState = null;
  statusEl.textContent = 'Disconnected';
  updateActionButtons();
  log('Disconnected');
};

ws.onerror = () => {
  statusEl.textContent = `Cannot connect to ${WS_URL}`;
};

window.addEventListener('resize', () => {
  layoutHand();
});

updateActionButtons();
