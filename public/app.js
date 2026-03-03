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
const leaveSeatBtn = document.getElementById('leaveSeatBtn');
const playBtn = document.getElementById('playBtn');
const passBtn = document.getElementById('passBtn');
const handEl = document.getElementById('hand');
const gameEl = document.getElementById('game');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const joinSeatBarEl = document.querySelector('.join-seat-bar');
const seatTopEl = document.getElementById('seat-top');
const seatLeftEl = document.getElementById('seat-left');
const seatRightEl = document.getElementById('seat-right');
const seatBottomEl = document.getElementById('seat-bottom');
const turnInfoEl = document.getElementById('turnInfo');
const lastPlayByEl = document.getElementById('lastPlayBy');
const lastPlayCardsEl = document.getElementById('lastPlayCards');
const landscapeLockEl = document.getElementById('landscapeLock');
const lockLandscapeBtn = document.getElementById('lockLandscapeBtn');
const SUIT_ICON = { S: '♠', C: '♣', D: '♦', H: '♥' };
const RED_SUITS = new Set(['D', 'H']);
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 3]));
const SUIT_VALUE = { S: 1, C: 2, D: 3, H: 4 };
const MOBILE_QUERY = '(max-width: 1024px) and (pointer: coarse)';
const LS_NAME_KEY = 'tlmn_player_name';
let audioCtx = null;
let audioUnlocked = false;
let lastSoundAt = 0;
let lastTurnSfxKey = '';
let bgmStarted = false;
let bgmTimer = null;
const seatPositionByAbsolute = new Map();

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function getStoredPlayerName() {
  try {
    return localStorage.getItem(LS_NAME_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredPlayerName(name) {
  try {
    localStorage.setItem(LS_NAME_KEY, name);
  } catch {
    // ignore storage errors
  }
}

function updateJoinBarVisibility() {
  if (!joinSeatBarEl) return;
  joinSeatBarEl.classList.toggle('hidden', seat !== null);
}

function parseCard(cardId) {
  const m = String(cardId).match(/^(10|[3-9JQKA2])([SCDH])$/);
  if (!m) return null;
  return { rank: m[1], suit: m[2] };
}

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

async function unlockAudio() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') await ctx.resume();
    audioUnlocked = ctx.state === 'running';
    if (audioUnlocked) maybeStartBackgroundMusic();
  } catch {
    audioUnlocked = false;
  }
}

function playTone({ freq = 440, duration = 0.08, gain = 0.05, type = 'sine', when = 0, endFreq = null }) {
  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const t0 = ctx.currentTime + when;
  const t1 = t0 + duration;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t1);
  }

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.01);
}

function playCardSfx() {
  playTone({ freq: 640, duration: 0.05, gain: 0.045, type: 'triangle', when: 0 });
  playTone({ freq: 820, duration: 0.06, gain: 0.04, type: 'triangle', when: 0.045 });
}

function playBombSfx() {
  playTone({ freq: 180, endFreq: 48, duration: 0.34, gain: 0.12, type: 'sawtooth', when: 0 });
  playTone({ freq: 90, endFreq: 38, duration: 0.28, gain: 0.08, type: 'triangle', when: 0.04 });
  playTone({ freq: 1200, endFreq: 170, duration: 0.16, gain: 0.045, type: 'square', when: 0.02 });
}

function playYourTurnSfx() {
  playTone({ freq: 520, duration: 0.08, gain: 0.06, type: 'triangle', when: 0 });
  playTone({ freq: 700, duration: 0.09, gain: 0.065, type: 'triangle', when: 0.07 });
  playTone({ freq: 940, duration: 0.12, gain: 0.07, type: 'sine', when: 0.15 });
}

function playUserJoinedSfx() {
  playTone({ freq: 460, duration: 0.08, gain: 0.058, type: 'triangle', when: 0 });
  playTone({ freq: 620, duration: 0.09, gain: 0.06, type: 'sine', when: 0.08 });
  playTone({ freq: 780, duration: 0.1, gain: 0.064, type: 'sine', when: 0.16 });
}

function playGameEndSfx() {
  playTone({ freq: 523, duration: 0.12, gain: 0.07, type: 'triangle', when: 0 });
  playTone({ freq: 659, duration: 0.12, gain: 0.072, type: 'triangle', when: 0.11 });
  playTone({ freq: 784, duration: 0.16, gain: 0.076, type: 'triangle', when: 0.22 });
  playTone({ freq: 1046, duration: 0.2, gain: 0.08, type: 'sine', when: 0.34 });
}

function playPoopSfx() {
  playTone({ freq: 160, endFreq: 72, duration: 0.18, gain: 0.075, type: 'sawtooth', when: 0 });
  playTone({ freq: 250, endFreq: 130, duration: 0.12, gain: 0.06, type: 'square', when: 0.1 });
  playTone({ freq: 420, endFreq: 180, duration: 0.08, gain: 0.04, type: 'triangle', when: 0.18 });
}

function canSendPoopToSeat(targetSeat) {
  if (!Number.isInteger(targetSeat)) return false;
  if (seat === null || targetSeat === seat) return false;
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (!latestGameState || !Array.isArray(latestGameState.players)) return false;
  return latestGameState.players.some((p) => p.seat === targetSeat);
}

function sendPoopToSeat(targetSeat) {
  if (!canSendPoopToSeat(targetSeat)) return;
  ws.send(JSON.stringify({ type: 'poop', toSeat: targetSeat }));
}

function bindPoopButtons() {
  const buttons = document.querySelectorAll('.poop-btn');
  buttons.forEach((btn) => {
    const targetSeat = Number(btn.dataset.seat);
    btn.disabled = !canSendPoopToSeat(targetSeat);
    btn.onclick = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      sendPoopToSeat(targetSeat);
    };
  });
}

function showPoopBurst(targetSeat, fromName, toName) {
  const anchor = getSeatElementByAbsoluteSeat(targetSeat);
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.className = 'poop-burst';
  burst.textContent = '💩';
  burst.style.left = `${rect.left + rect.width * 0.5}px`;
  burst.style.top = `${rect.top + rect.height * 0.35}px`;
  document.body.appendChild(burst);
  window.requestAnimationFrame(() => burst.classList.add('show'));
  window.setTimeout(() => burst.remove(), 920);

  const sender = String(fromName || 'Someone');
  const receiver = String(toName || `seat ${targetSeat}`);
  log(`${sender} sent 💩 to ${receiver}`);
}

function buildTurnSfxKey(gameState) {
  const historyLen = Array.isArray(gameState?.trickHistory) ? gameState.trickHistory.length : 0;
  const comboSize = Array.isArray(gameState?.trickCombo?.cards) ? gameState.trickCombo.cards.length : 0;
  const turn = gameState?.currentTurn ?? 'x';
  const last = gameState?.lastPlaySeat ?? 'x';
  return `${turn}|${historyLen}|${comboSize}|${last}`;
}

function processTurnSfx(gameState, mySeat) {
  const yourTurn = mySeat !== null && gameState?.started && !gameState?.ended && gameState?.currentTurn === mySeat;
  if (!yourTurn) {
    lastTurnSfxKey = '';
    return;
  }

  const key = buildTurnSfxKey(gameState);
  if (key !== lastTurnSfxKey) {
    playYourTurnSfx();
    lastTurnSfxKey = key;
  }
}

function scheduleBgmLoop() {
  if (!audioUnlocked) return;
  // Very light continuous background loop.
  playTone({ freq: 220, duration: 0.22, gain: 0.014, type: 'sine', when: 0 });
  playTone({ freq: 277, duration: 0.2, gain: 0.012, type: 'sine', when: 0.45 });
  playTone({ freq: 330, duration: 0.24, gain: 0.013, type: 'sine', when: 0.9 });
  playTone({ freq: 277, duration: 0.2, gain: 0.012, type: 'sine', when: 1.35 });
}

function maybeStartBackgroundMusic() {
  if (!audioUnlocked || bgmStarted) return;
  bgmStarted = true;
  scheduleBgmLoop();
  bgmTimer = window.setInterval(() => {
    if (!audioUnlocked) return;
    scheduleBgmLoop();
  }, 1800);
}

function isMobileDevice() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function isLandscape() {
  return window.matchMedia('(orientation: landscape)').matches;
}

async function tryLockLandscape() {
  if (!isMobileDevice()) return;

  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
        } catch {
          // Ignore fullscreen errors and still attempt orientation lock.
        }
      }
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Ignore lock failures; overlay fallback will still enforce orientation.
  }
}

function updateLandscapeGate() {
  const force = isMobileDevice() && !isLandscape();
  if (landscapeLockEl) {
    landscapeLockEl.hidden = !force;
  }
  document.body.classList.toggle('force-landscape', force);
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
  const mustContain3S = gameState.openingMustContain3S !== false;
  if (openingPlay && mustContain3S && !selectedIds.includes('3S')) return false;

  if (!gameState.trickCombo) return true;

  const currentCombo = getComboFromIds(gameState.trickCombo.cards || []);
  if (!currentCombo) return false;

  return comboBeats(nextCombo, currentCombo);
}

function isTwoCombo(comboLike) {
  if (!comboLike || !Array.isArray(comboLike.cards)) return false;
  const parsed = comboLike.cards.map((id) => parseCard(id)).filter(Boolean);
  if (comboLike.type === 'single' && parsed.length === 1) return parsed[0].rank === '2';
  if (comboLike.type === 'pair' && parsed.length === 2) return parsed.every((c) => c.rank === '2');
  return false;
}

function isBombAgainstTwo(playedCombo) {
  if (!playedCombo) return false;
  if (playedCombo.type === 'quad') return true;
  if (playedCombo.type === 'pair_straight' && playedCombo.chainLength >= 3) return true;
  return false;
}

function processStateSounds(prevState, nextState) {
  if (!nextState || !Array.isArray(nextState.trickHistory)) return null;
  const history = nextState.trickHistory;
  const newestAt = history.reduce((max, h) => (typeof h.at === 'number' ? Math.max(max, h.at) : max), 0);
  if (newestAt <= 0) return null;

  if (!prevState) {
    lastSoundAt = newestAt;
    return null;
  }

  const newEntries = history
    .filter((h) => h && typeof h.at === 'number' && h.at > lastSoundAt)
    .sort((a, b) => a.at - b.at);

  if (newEntries.length === 0) {
    lastSoundAt = Math.max(lastSoundAt, newestAt);
    return null;
  }

  const latestPlay = [...newEntries].reverse().find((e) => e.action === 'play');
  if (latestPlay) {
    const playedCombo = getComboFromIds(latestPlay.cards || []);
    const chopTwo = isTwoCombo(prevState.trickCombo) && isBombAgainstTwo(playedCombo);
    if (chopTwo) playBombSfx();
    else playCardSfx();
    lastSoundAt = newestAt;
    return latestPlay;
  }

  lastSoundAt = newestAt;
  return null;
}

function processGameEndSfx(prevState, nextState) {
  if (!nextState?.ended) return;
  if (prevState?.ended) return;
  playGameEndSfx();
}

function updateActionButtons() {
  const joined = seat !== null;
  const game = latestGameState;

  if (!game) {
    startBtn.disabled = true;
    leaveSeatBtn.disabled = true;
    playBtn.disabled = true;
    passBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = !(nameEl && nameEl.value.trim());
    return;
  }

  const yourTurn = game.currentTurn === seat;
  const canPlayTurn = joined && game.started && !game.ended && yourTurn;
  const canPass = canPlayTurn && !!game.trickCombo && game.lastPlaySeat !== seat;
  const canLeaveSeat = joined && (!game.started || game.ended);
  const canJoinSeat = !joined && (!game.started || game.ended) && !!(nameEl && nameEl.value.trim());

  startBtn.disabled = !joined || !game.canStart;
  leaveSeatBtn.disabled = !canLeaveSeat;
  playBtn.disabled = !canPlayTurn || !isSelectedPlayable(game);
  passBtn.disabled = !canPass;
  if (joinBtn) joinBtn.disabled = !canJoinSeat;
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

function renderRevealedCards(cardIds, vertical = false) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return `<div class="revealed-cards ${vertical ? 'vertical' : ''} empty">Hết bài</div>`;
  }
  let styleAttr = '';
  if (cardIds.length > 1) {
    const mobile = isMobileDevice();
    const maxSpan = vertical ? (mobile ? 80 : 102) : (mobile ? 96 : 192);
    const cardMainSize = vertical ? (mobile ? 32 : 42) : (mobile ? 22 : 30);
    const minStep = vertical ? 2 : mobile ? 6 : 8;
    const maxStep = vertical ? 12 : cardMainSize;
    const rawStep = (maxSpan - cardMainSize) / (cardIds.length - 1);
    const step = Math.min(maxStep, Math.max(minStep, rawStep));
    styleAttr = ` style="--revealed-step:${step.toFixed(2)}px"`;
  }
  const cards = cardIds
    .map((cardId, i) => `<span class="revealed-wrap" style="--i:${i}">${renderFaceCard(cardId, 'revealed-card')}</span>`)
    .join('');
  return `<div class="revealed-cards ${vertical ? 'vertical' : ''}"${styleAttr}>${cards}</div>`;
}

function renderFaceCard(cardId, className) {
  const parsed = parseCard(cardId);
  if (!parsed) return `<div class="${className}">${escapeHtml(cardId)}</div>`;
  const colorClass = RED_SUITS.has(parsed.suit) ? 'red' : 'black';
  return `<div class="${className} ${colorClass}"><span class="rank">${parsed.rank}</span><span class="suit">${SUIT_ICON[parsed.suit]}</span></div>`;
}

function getSeatElementByAbsoluteSeat(absSeat) {
  const pos = seatPositionByAbsolute.get(absSeat);
  if (pos === 'top') return seatTopEl;
  if (pos === 'left') return seatLeftEl;
  if (pos === 'right') return seatRightEl;
  return seatBottomEl;
}

function animatePlayToCenter(playEntry) {
  if (!playEntry || !Array.isArray(playEntry.cards) || playEntry.cards.length === 0) return;

  const fromEl = getSeatElementByAbsoluteSeat(playEntry.seat);
  const toEl = lastPlayCardsEl;
  if (!fromEl || !toEl) return;

  const startRect = fromEl.getBoundingClientRect();
  const endRect = toEl.getBoundingClientRect();
  if (!startRect.width || !startRect.height || !endRect.width || !endRect.height) return;

  const fromX = startRect.left + startRect.width / 2;
  const fromY = startRect.top + startRect.height / 2;
  const toX = endRect.left + endRect.width / 2;
  const toY = endRect.top + endRect.height / 2;

  const cardsForAnim = playEntry.cards.slice(0, Math.min(playEntry.cards.length, 6));
  cardsForAnim.forEach((cardId, i) => {
    const card = document.createElement('div');
    card.className = 'fly-card';
    card.innerHTML = renderFaceCard(cardId, 'fly-card-face');
    card.style.left = `${fromX - 16 + i * 3}px`;
    card.style.top = `${fromY - 24 + i * 2}px`;
    card.style.setProperty('--dx', `${toX - fromX + (i - cardsForAnim.length / 2) * 9}px`);
    card.style.setProperty('--dy', `${toY - fromY + (i - cardsForAnim.length / 2) * 4}px`);
    card.style.animationDelay = `${i * 22}ms`;

    document.body.appendChild(card);
    window.setTimeout(() => card.classList.add('go'), 16);
    window.setTimeout(() => card.remove(), 560 + i * 22);
  });
}

function renderPileStack(cards) {
  const key = cards.join('|');
  const existingTop = lastPlayCardsEl.querySelector('.pile-layer.top');
  if (existingTop && existingTop.dataset.key === key) return;

  const oldLayers = [...lastPlayCardsEl.querySelectorAll('.pile-layer')];
  oldLayers.forEach((layer) => {
    layer.classList.remove('top', 'incoming');
    layer.classList.add('under');
  });

  const layer = document.createElement('div');
  layer.className = 'pile-layer top incoming';
  layer.dataset.key = key;
  layer.innerHTML = cards.map((c) => renderFaceCard(c, 'center-card')).join('');
  lastPlayCardsEl.appendChild(layer);

  const allLayers = [...lastPlayCardsEl.querySelectorAll('.pile-layer')];
  while (allLayers.length > 2) {
    const first = allLayers.shift();
    if (first) first.remove();
  }

  window.setTimeout(() => {
    layer.classList.remove('incoming');
  }, 240);
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
  const maxStep = parseFloat(style.getPropertyValue('--hand-max-step')) || cardWidth;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const usableWidth = Math.max(0, handEl.clientWidth - padLeft - padRight);

  if (count <= 1) {
    handEl.style.setProperty('--computed-card-step', `${cardWidth}px`);
    return;
  }

  // Fit exactly in one row: total = cardWidth + (count - 1) * step
  const rawStep = (usableWidth - cardWidth) / (count - 1);
  const step = Math.max(2, Math.min(maxStep, rawStep));
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
  const baseOrder =
    Array.isArray(gameState.seatOrder) && gameState.seatOrder.length === 4
      ? gameState.seatOrder
      : [0, 1, 2, 3];
  const order = seat !== null ? rotateToSeat(baseOrder, seat) : baseOrder;

  Object.values(slotEls).forEach((el) => {
    el.innerHTML = '';
  });

  for (let i = 0; i < order.length && i < 4; i++) {
    const absoluteSeat = order[i];
    seatPositionByAbsolute.set(absoluteSeat, positions[i]);
    const player = playersBySeat.get(absoluteSeat);
    if (!player) continue;
    const pos = positions[i];
    const slot = slotEls[pos];
    const isTurn = gameState.started && !gameState.ended && gameState.currentTurn === player.seat;
    const isYou = player.seat === seat;
    const vertical = pos === 'left' || pos === 'right';
    const label = isYou ? 'Bạn' : `Ghế ${player.seat}`;
    const showReveal = gameState.ended && Array.isArray(player.revealedCards);
    const revealVertical = vertical && !isMobileDevice();
    const cardsBlock = showReveal
      ? renderRevealedCards(player.revealedCards, revealVertical)
      : isYou
        ? ''
        : renderOpponentCards(player.cardsCount, vertical);
    const poopButton = isYou ? '' : `<button class="poop-btn" data-seat="${player.seat}" title="Send poop">💩</button>`;

    slot.innerHTML = `
      <div class="player-panel ${isTurn ? 'turn' : ''} ${isYou ? 'you' : ''}">
        <div class="player-row">
          <span class="player-name">${escapeHtml(player.name)}</span>
          <span class="badge">${label}</span>
          ${poopButton}
        </div>
        <div class="player-meta">${player.cardsCount} lá bài</div>
        ${cardsBlock}
      </div>
    `;
  }

  for (let i = 0; i < order.length && i < 4; i++) {
    const absoluteSeat = order[i];
    if (playersBySeat.has(absoluteSeat)) continue;
    const pos = positions[i];
    const slot = slotEls[pos];

    slot.innerHTML = `
      <div class=\"empty-seat\">
        <span>Ghế ${absoluteSeat}</span>
        <span>Trong</span>
      </div>
    `;
  }

  bindPoopButtons();
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
  renderPileStack(gameState.trickCombo.cards);
}

if (joinBtn) {
  joinBtn.onclick = () => {
    void tryLockLandscape();
    const inputName = nameEl?.value?.trim() || '';
    if (!inputName) {
      log('Error: Nhap ten truoc khi tham gia.');
      updateActionButtons();
      return;
    }
    setStoredPlayerName(inputName);
    ws.send(JSON.stringify({ type: 'sit', name: inputName }));
  };
}

if (nameEl) {
  const stored = getStoredPlayerName();
  if (stored) nameEl.value = stored;
  nameEl.addEventListener('input', () => {
    const v = nameEl.value.trim();
    if (v) setStoredPlayerName(v);
    updateActionButtons();
  });
}

startBtn.onclick = () => {
  void tryLockLandscape();
  ws.send(JSON.stringify({ type: 'start' }));
};

leaveSeatBtn.onclick = () => {
  void tryLockLandscape();
  ws.send(JSON.stringify({ type: 'leave_seat' }));
};

playBtn.onclick = () => {
  void tryLockLandscape();
  const cards = [...selected];
  ws.send(JSON.stringify({ type: 'play', cards }));
};

passBtn.onclick = () => {
  void tryLockLandscape();
  ws.send(JSON.stringify({ type: 'pass' }));
};

ws.onopen = () => {
  setStatus(`Connected: ${WS_URL}`);
  log('Connected');
};

ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);

  if (data.type === 'error') log(`Error: ${data.message}`);
  if (data.type === 'welcome') {
    setStatus('Connected');
    log(data.message);
  }
  if (data.type === 'joined') {
    seat = data.seat ?? null;
    updateJoinBarVisibility();
    if (seat === null) {
      setStatus(`Chế độ xem - ${data.name}. Bấm Tham gia để ngồi vào bàn.`);
      log('Viewer mode');
    } else {
      setStatus(`Đã ngồi ghế ${seat}: ${data.name}`);
      log(`Sat at seat ${seat}`);
    }
    updateActionButtons();
  }
  if (data.type === 'player_joined') {
    log(`${data.name} joined (seat ${data.seat})`);
    const isSelfJoin = seat !== null && data.seat === seat;
    if (!isSelfJoin) playUserJoinedSfx();
  }
  if (data.type === 'player_left') log(`${data.name} left`);
  if (data.type === 'game_started') log(`Game started, first turn seat ${data.firstTurn}`);
  if (data.type === 'round_reset') log(`Round reset, seat ${data.nextTurn} starts`);
  if (data.type === 'game_ended') log(`Winner: ${data.winnerName} (seat ${data.winnerSeat})`);
  if (data.type === 'poop') {
    showPoopBurst(data.toSeat, data.fromName, data.toName);
    playPoopSfx();
  }
  if (data.type === 'info') log(data.message);

  if (data.type === 'state') {
    processGameEndSfx(latestGameState, data.game);
    const latestPlay = processStateSounds(latestGameState, data.game);
    const nextSeat = data.you?.seat ?? null;
    processTurnSfx(data.game, nextSeat);
    latestGameState = data.game;
    seat = nextSeat;
    updateJoinBarVisibility();
    hand = data.you.cards;
    selected = new Set([...selected].filter((c) => hand.includes(c)));
    if (seat === null) {
      setStatus(`Chế độ xem - ${data.you?.name || 'Guest'}. Bấm Tham gia để ngồi vào bàn.`);
    } else {
      setStatus(`Bạn đang ngồi ghế ${seat} (${data.you?.name || 'Player'})`);
    }
    renderHand();
    renderSeats(latestGameState);
    renderCenter(latestGameState);
    if (latestPlay) animatePlayToCenter(latestPlay);
    gameEl.textContent = JSON.stringify(latestGameState, null, 2);
    updateActionButtons();
  }
};

ws.onclose = () => {
  latestGameState = null;
  lastTurnSfxKey = '';
  setStatus('Disconnected');
  updateActionButtons();
  log('Disconnected');
};

ws.onerror = () => {
  setStatus(`Cannot connect to ${WS_URL}`);
};

window.addEventListener('resize', () => {
  layoutHand();
  updateLandscapeGate();
});

window.addEventListener('orientationchange', () => {
  updateLandscapeGate();
  layoutHand();
});

if (lockLandscapeBtn) {
  lockLandscapeBtn.onclick = async () => {
    await unlockAudio();
    await tryLockLandscape();
    updateLandscapeGate();
  };
}

window.addEventListener('pointerdown', () => {
  void unlockAudio();
}, { passive: true });

window.addEventListener('touchstart', () => {
  void unlockAudio();
}, { passive: true });

window.addEventListener('keydown', () => {
  void unlockAudio();
});

window.addEventListener('pagehide', () => {
  if (bgmTimer) {
    window.clearInterval(bgmTimer);
    bgmTimer = null;
  }
});

updateLandscapeGate();
updateJoinBarVisibility();
updateActionButtons();
