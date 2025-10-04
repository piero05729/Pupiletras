// Pupiletras Adventista
// Genera una sopa de letras con nombres relacionados al adventismo.

const NAMES_POOL = [
  // Pioneros y apellidos conocidos
  "ELENA", "ELLEN", "WHITE", "ANDREWS", "BATES", "MILLER", "WAGGONER", "JONES", "HASKELL",
  "LOUGHBOROUGH", "KELLOGG", "BUTLER", "FROOM", "PRESCOTT", "DANIELLS", "WILCOX",
  // Nombres bíblicos comunes en la feligresía
  "ABEL", "ENOC", "NOE", "ABRAHAM", "SARA", "ISAAC", "REBECA", "JACOBO", "RAQUEL",
  "MOISES", "AARON", "JOSUE", "CALEB", "DAVID", "SALOMON", "ELIAS", "ELISEO",
  "DANIEL", "ESTER", "ESDRAS", "NEEMIAS", "ISAIAS", "JEREMIAS", "EZEQUIEL", "OSEAS",
  "MATEO", "MARCOS", "LUCAS", "JUAN", "PEDRO", "PABLO", "SANTIAGO", "TOMAS",
  // Otros nombres frecuentes en iglesias de habla hispana
  "RUTH", "DEBORA", "PRISCILA", "LYDIA", "TIMOTEO", "TITO", "SILAS", "BARNABAS",
  // Conceptos (opcionales) cortos usados como nombres de clubes/equipos juveniles
  "SABADO", "FE", "ESPERANZA", "AMOR"
];

const directions = [
  {dx:  1, dy:  0}, // →
  {dx: -1, dy:  0}, // ←
  {dx:  0, dy:  1}, // ↓
  {dx:  0, dy: -1}, // ↑
  {dx:  1, dy:  1}, // ↘
  {dx: -1, dy: -1}, // ↖
  {dx:  1, dy: -1}, // ↗
  {dx: -1, dy:  1}, // ↙
];

const boardEl = document.getElementById('board');
const wordsEl = document.getElementById('words');
const sizeEl = document.getElementById('gridSize');
const countEl = document.getElementById('wordCount');
const btnNew = document.getElementById('btnNew');
// Realtime UI
const usernameEl = document.getElementById('username');
const roomIdEl = document.getElementById('roomId');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const roomStatusEl = document.getElementById('roomStatus');
const eventsEl = document.getElementById('events');

let SIZE = 12;
let WORD_COUNT = 10;
let grid = [];
let placedWords = []; // {word, path:[{r,c}]}
let foundSet = new Set();

// Realtime (P2P) state
let isRealtime = false;
let isHost = false;
let currentUser = '';
let peer = null;           // PeerJS instance
let hostPeerId = null;     // Room ID (host's peer id)
let connections = [];      // For host: DataConnections to clients
let hostConn = null;       // For client: DataConnection to host

// Estados de selección
let isDragging = false;
let selectionPath = []; // [{r,c,el}]

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function inBounds(r, c) { return r >= 0 && c >= 0 && r < SIZE && c < SIZE; }

function makeEmptyGrid(n) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => ''));
}

function canPlace(word, r, c, dir, grid) {
  const { dx, dy } = dir;
  for (let i = 0; i < word.length; i++) {
    const rr = r + dy * i, cc = c + dx * i;
    if (!inBounds(rr, cc)) return false;
    const cur = grid[rr][cc];
    if (cur !== '' && cur !== word[i]) return false;
  }
  return true;
}

function placeWord(word, grid) {
  // Intentos aleatorios para ubicar la palabra
  for (let tries = 0; tries < 400; tries++) {
    const dir = randomChoice(directions);
    // Para ajustar el rango de inicio y reducir out-of-bounds
    const maxR = SIZE - 1, maxC = SIZE - 1;
    let startR = randInt(0, maxR), startC = randInt(0, maxC);
    if (!canPlace(word, startR, startC, dir, grid)) continue;

    // Colocar
    const path = [];
    for (let i = 0; i < word.length; i++) {
      const rr = startR + dir.dy * i, cc = startC + dir.dx * i;
      grid[rr][cc] = word[i];
      path.push({ r: rr, c: cc });
    }
    return path;
  }
  return null; // no se pudo colocar
}

function fillRandom(grid) {
  const letters = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) {
        grid[r][c] = letters[randInt(0, letters.length - 1)];
      }
    }
  }
}

function pickWords(pool, count, size) {
  // Filtrar que quepan
  const filtered = pool.filter(w => w.length <= size);
  const out = new Set();
  const max = Math.min(count, filtered.length);
  while (out.size < max) {
    out.add(randomChoice(filtered));
  }
  return Array.from(out);
}

function renderBoard() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${SIZE}, 36px)`;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const div = document.createElement('div');
      div.className = 'cell';
      div.textContent = grid[r][c];
      div.dataset.r = r;
      div.dataset.c = c;
      div.setAttribute('role', 'gridcell');
      // Eventos de selección (mouse)
      div.addEventListener('mousedown', onCellDown);
      div.addEventListener('mouseenter', onCellEnter);
      // Eventos táctiles básicos
      div.addEventListener('touchstart', onTouchStart, { passive: false });
      div.addEventListener('touchmove', onTouchMove, { passive: false });
      div.addEventListener('touchend', onTouchEnd);
      boardEl.appendChild(div);
    }
  }
  // Fin de arrastre (mouse)
  document.addEventListener('mouseup', onMouseUp);

  // Aplicar celdas encontradas desde foundSet
  for (const w of placedWords) {
    if (!foundSet.has(w.word)) continue;
    for (const p of w.path) {
      const cell = boardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
      if (cell) cell.classList.add('found', 'locked');
    }
    const li = document.getElementById(`w-${w.word}`);
    if (li) li.classList.add('found');
  }
}

function renderWordsList() {
  wordsEl.innerHTML = '';
  for (const w of placedWords) {
    const li = document.createElement('li');
    li.textContent = w.word;
    li.id = `w-${w.word}`;
    if (foundSet.has(w.word)) li.classList.add('found');
    wordsEl.appendChild(li);
  }
}

function buildPuzzle() {
  SIZE = parseInt(sizeEl.value, 10);
  WORD_COUNT = parseInt(countEl.value, 10);

  grid = makeEmptyGrid(SIZE);
  placedWords = [];
  foundSet = new Set();

  const pick = pickWords(NAMES_POOL, WORD_COUNT, SIZE)
    // Mezclar para variar orden de intento
    .sort(() => Math.random() - 0.5)
    // Intentar primero más largas
    .sort((a, b) => b.length - a.length);

  for (const word of pick) {
    const upper = word.toUpperCase();
    const path = placeWord(upper, grid);
    if (path) placedWords.push({ word: upper, path });
  }

  // Si no se lograron todas, no pasa nada; se colocan las que cupieron
  fillRandom(grid);
  renderBoard();
  renderWordsList();

  // Si estamos en sala y soy host, publicar nuevo estado
  if (isRealtime && isHost) {
    broadcast({ type: 'new_puzzle', by: currentUser, state: toRoomState() });
    pushEvent(`${currentUser || 'Alguien'} generó una nueva sopa`);
  }
}

// Utilidades de selección
function getCellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !el.classList || !el.classList.contains('cell')) return null;
  return el;
}

function clearSelectionPreview() {
  for (const item of selectionPath) item.el.classList.remove('selecting');
}

function pushSelectionCell(el) {
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  if (selectionPath.length > 0) {
    const last = selectionPath[selectionPath.length - 1];
    // Evitar duplicados consecutivos
    if (last.r === r && last.c === c) return;
  }
  selectionPath.push({ r, c, el });
  el.classList.add('selecting');
}

function lineIsStraight(path) {
  if (path.length < 2) return false;
  const dx = path[1].c - path[0].c;
  const dy = path[1].r - path[0].r;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // Debe ser horizontal, vertical o diagonal
  if (!((stepX === 0 || stepY === 0) || Math.abs(stepX) === Math.abs(stepY))) {
    return false;
  }
  // Comprobar continuidad
  for (let i = 1; i < path.length; i++) {
    const dx2 = path[i].c - path[i-1].c;
    const dy2 = path[i].r - path[i-1].r;
    if (Math.sign(dx2) !== stepX || Math.sign(dy2) !== stepY || Math.abs(dx2) > 1 || Math.abs(dy2) > 1) return false;
  }
  return true;
}

function pathToString(path) {
  return path.map(p => grid[p.r][p.c]).join('');
}

function tryCommitSelection(path) {
  if (!lineIsStraight(path)) return false;
  const s = pathToString(path);
  const sRev = s.split('').reverse().join('');
  const target = placedWords.find(w => (w.word === s || w.word === sRev));
  if (!target) return false;
  if (foundSet.has(target.word)) return false;

  if (isRealtime) {
    if (isHost) {
      // Host aplica y difunde
      applyFound(target.word, currentUser);
      broadcast({ type: 'found', word: target.word, by: currentUser });
    } else if (hostConn && hostConn.open) {
      // Cliente solicita al host registrar el hallazgo
      hostConn.send({ type: 'found', word: target.word, by: currentUser });
    }
  } else {
    // Modo local
    applyFound(target.word, currentUser);
  }
  return true;
}

function endSelection(commit) {
  if (selectionPath.length === 0) return;
  if (commit) {
    const ok = tryCommitSelection(selectionPath);
    if (!ok) {
      // limpiar preview si no hizo match
      clearSelectionPreview();
    }
  } else {
    clearSelectionPreview();
  }
  selectionPath = [];
  isDragging = false;
}

// Handlers Mouse
function onCellDown(e) {
  e.preventDefault();
  isDragging = true;
  selectionPath = [];
  pushSelectionCell(e.currentTarget);
}

function onCellEnter(e) {
  if (!isDragging) return;
  pushSelectionCell(e.currentTarget);
}

function onMouseUp() {
  if (!isDragging) return;
  endSelection(true);
}

// Handlers Touch
function onTouchStart(e) {
  e.preventDefault();
  isDragging = true;
  selectionPath = [];
  const touch = e.touches[0];
  const el = getCellFromPoint(touch.clientX, touch.clientY);
  if (el) pushSelectionCell(el);
}

function onTouchMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  const el = getCellFromPoint(touch.clientX, touch.clientY);
  if (el) pushSelectionCell(el);
}

function onTouchEnd() {
  if (!isDragging) return;
  endSelection(true);
}

// Controles
// btnNew handler se define más abajo con lógica P2P
function onConfigChange() {
  if (isRealtime && !isHost && hostConn && hostConn.open) {
    // Cliente solicita nueva sopa con los valores seleccionados
    const desiredSize = parseInt(sizeEl.value, 10);
    const desiredCount = parseInt(countEl.value, 10);
    hostConn.send({ type: 'request_new_puzzle', by: currentUser, size: desiredSize, wordCount: desiredCount });
    // No reconstruir localmente para evitar desincronización; esperar broadcast del host
  } else {
    // Local u host: reconstruir inmediatamente con los valores actuales
    buildPuzzle();
  }
}
sizeEl.addEventListener('change', onConfigChange);
countEl.addEventListener('change', onConfigChange);

// Inicial
buildPuzzle();

// ==========================
// Realtime (PeerJS) Logic
// ==========================

function toRoomState() {
  return {
    size: SIZE,
    wordCount: WORD_COUNT,
    grid: grid.map(row => row.join('')),
    placedWords: placedWords.map(w => ({ word: w.word, path: w.path })),
    found: Array.from(foundSet),
    updatedAt: Date.now()
  };
}

function applyRoomState(state) {
  if (!state) return;
  SIZE = state.size || SIZE;
  WORD_COUNT = state.wordCount || WORD_COUNT;
  sizeEl.value = String(SIZE);
  countEl.value = String(WORD_COUNT);
  grid = (state.grid || []).map(row => row.split(''));
  placedWords = (state.placedWords || []);
  foundSet = new Set(state.found || []);
  renderBoard();
  renderWordsList();
}

function applyFound(word, by) {
  if (foundSet.has(word)) return;
  const target = placedWords.find(w => w.word === word);
  if (!target) return;
  // Marcar celdas y lista
  for (const p of target.path) {
    const cell = boardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
    if (cell) cell.classList.add('found', 'locked');
  }
  foundSet.add(word);
  const li = document.getElementById(`w-${word}`);
  if (li) li.classList.add('found');
  pushEvent(`${by || 'Alguien'} encontró: ${word}`);
}

function pushEvent(text) {
  const li = document.createElement('li');
  li.textContent = text;
  eventsEl.prepend(li);
}

function setRoomStatus(text, ok=true) {
  roomStatusEl.textContent = text || '';
  roomStatusEl.style.color = ok ? '#0f766e' : '#b91c1c';
}

function broadcast(msg) {
  for (const c of connections) {
    if (c.open) c.send(msg);
  }
}

function handleHostConnection(conn) {
  connections.push(conn);
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      conn.send({ type: 'init_state', state: toRoomState() });
    }
    if (msg.type === 'found') {
      // Validar y difundir
      const word = msg.word;
      if (!foundSet.has(word) && placedWords.find(w => w.word === word)) {
        applyFound(word, msg.by);
        broadcast({ type: 'found', word, by: msg.by });
      }
    }
    if (msg.type === 'request_new_puzzle') {
      // Si el cliente envía tamaño/cantidad deseados, el host los aplica
      if (typeof msg.size === 'number') {
        SIZE = Math.max(6, Math.min(30, msg.size|0));
        sizeEl.value = String(SIZE);
      }
      if (typeof msg.wordCount === 'number') {
        WORD_COUNT = Math.max(4, Math.min(40, msg.wordCount|0));
        countEl.value = String(WORD_COUNT);
      }
      buildPuzzle(); // buildPuzzle broadcasting desde host
    }
  });
  conn.on('close', () => {
    connections = connections.filter(c => c !== conn);
  });
  // Enviar estado inicial
  conn.on('open', () => {
    conn.send({ type: 'init_state', state: toRoomState() });
  });
}

function createRoom() {
  currentUser = (usernameEl.value || '').trim() || 'Jugador';
  const roomId = (roomIdEl.value || '').trim();
  if (!roomId) { setRoomStatus('Ingresa un ID de sala', false); return; }
  isRealtime = true; isHost = true; hostPeerId = roomId;
  peer = new Peer(hostPeerId, { debug: 2 });
  peer.on('open', () => {
    setRoomStatus(`Sala (host): ${hostPeerId}`);
    // Generar puzzle inicial y listo
    buildPuzzle();
  });
  peer.on('connection', handleHostConnection);
  peer.on('error', err => setRoomStatus('Error PeerJS: ' + err, false));
}

function joinRoom() {
  currentUser = (usernameEl.value || '').trim() || 'Jugador';
  const roomId = hostPeerId; // ya definido por auto-connect
  if (!roomId) { setRoomStatus('No hay sala', false); return; }
  isRealtime = true; isHost = false;
  peer = new Peer(undefined, { debug: 2 });
  peer.on('open', () => {
    hostConn = peer.connect(hostPeerId);
    hostConn.on('open', () => {
      setRoomStatus(`Conectado a: ${hostPeerId}`);
      hostConn.send({ type: 'hello', name: currentUser });
    });
    hostConn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'init_state') applyRoomState(msg.state);
      if (msg.type === 'found') applyFound(msg.word, msg.by);
      if (msg.type === 'new_puzzle' && msg.state) {
        applyRoomState(msg.state);
        pushEvent(`${msg.by || 'Alguien'} generó una nueva sopa`);
      }
    });
    hostConn.on('close', () => setRoomStatus('Desconectado del host', false));
  });
  peer.on('error', err => setRoomStatus('Error PeerJS: ' + err, false));
}

// Controles de UI para PeerJS
btnCreateRoom && btnCreateRoom.addEventListener('click', createRoom);
btnJoinRoom && btnJoinRoom.addEventListener('click', joinRoom);

// Botón Nueva sopa en tiempo real: solo host genera; clientes piden
btnNew.addEventListener('click', () => {
  if (isRealtime && !isHost && hostConn && hostConn.open) {
    hostConn.send({ type: 'request_new_puzzle', by: currentUser });
  } else if (!isRealtime || isHost) {
    buildPuzzle();
  }
});

// ==========================
// Auto-join same link logic
// ==========================
function deriveRoomIdFromUrl() {
  try {
    const base = (location.host + location.pathname).toLowerCase();
    const cleaned = base.replace(/[^a-z0-9]/g, '');
    return ('pupiletras_' + cleaned).slice(0, 48) || 'pupiletras_default';
  } catch {
    return 'pupiletras_default';
  }
}

function ensureUsername() {
  let name = (usernameEl && usernameEl.value || '').trim();
  if (!name) {
    name = 'Jugador-' + Math.floor(Math.random()*1000).toString().padStart(3,'0');
    if (usernameEl) usernameEl.value = name;
  }
  currentUser = name;
}

function autoConnectSameLink() {
  hostPeerId = deriveRoomIdFromUrl();
  ensureUsername();
  // Intentar ser host con ID fijo; si el ID está tomado, ser cliente
  isRealtime = true;
  isHost = true;
  peer = new Peer(hostPeerId, { debug: 2 });
  let opened = false;
  peer.on('open', () => {
    opened = true;
    setRoomStatus(`Sala (host): ${hostPeerId}`);
    buildPuzzle();
    peer.on('connection', handleHostConnection);
  });
  peer.on('error', (err) => {
    const msg = String(err && err.type || err);
    if (!opened && (err.type === 'unavailable-id' || /unavailable/i.test(msg))) {
      // ID ya en uso: convertirse en cliente
      try { peer.destroy(); } catch {}
      isHost = false;
      // Crear peer sin ID y conectar al host existente
      peer = new Peer(undefined, { debug: 2 });
      peer.on('open', () => {
        setRoomStatus(`Conectado a: ${hostPeerId}`);
        hostConn = peer.connect(hostPeerId);
        hostConn.on('open', () => {
          hostConn.send({ type: 'hello', name: currentUser });
        });
        hostConn.on('data', (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'init_state') applyRoomState(msg.state);
          if (msg.type === 'found') applyFound(msg.word, msg.by);
          if (msg.type === 'new_puzzle' && msg.state) {
            applyRoomState(msg.state);
            pushEvent(`${msg.by || 'Alguien'} generó una nueva sopa`);
          }
        });
        hostConn.on('close', () => setRoomStatus('Desconectado del host', false));
      });
      peer.on('error', e2 => setRoomStatus('Error PeerJS: ' + e2, false));
    } else {
      setRoomStatus('Error PeerJS: ' + msg, false);
    }
  });
}

// Arrancar conexión automática
autoConnectSameLink();
