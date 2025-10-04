// Pupiletra bíblica con generador por semilla y selección interactiva
// Autor: Cascade

(function(){
  // Utilidades de semilla
  function xmur3(str){
    let h = 1779033703 ^ str.length;
    for (let i=0;i<str.length;i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function(){
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a){
    return function(){
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFromSeed(seedStr){
    const seedFn = xmur3(String(seedStr));
    const a = seedFn();
    return mulberry32(a);
  }
  function choice(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

  // Normalización de acentos y mayúsculas para la cuadrícula
  function normalize(s){
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu,'')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g,'')
      .toUpperCase()
      .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U')
      .replace(/Ü/g,'U').replace(/Ñ/g,'N');
  }

  // Lista de nombres bíblicos (muestra representativa, puedes ampliar)
  const BIBLE_NAMES = [
    'Abraham','Sara','Isaac','Rebeca','Jacob','Raquel','Lea','José','Moisés','Aarón','Miriam',
    'Josué','Caleb','Samuel','David','Salomón','Elías','Eliseo','Isaías','Jeremías','Ezequiel','Daniel',
    'Oseas','Joel','Amós','Abdías','Jonás','Miqueas','Nahúm','Habacuc','Sofonías','Hageo','Zacarías','Malaquías',
    'Ester','Rut','Noemí','Job','Nehemías','Esdras','Débora','Gedeón','Sansón','Samuel','Natán','Elí',
    'Zaqueo','Lázaro','Marta','María','José','Juan','Pedro','Santiago','Andrés','Felipe','Bartolomé','Tomás',
    'Mateo','Simón','Judas','Pablo','Bernabé','Timoteo','Tito','Filemón','Silas','Lucas','Marcos'
  ];

  // Estado global simple
  const state = {
    size: 14,
    seed: 'amigos2025',
    rng: null,
    grid: [], // letras
    words: [], // {display, norm}
    placed: [], // {word, cells: [{r,c}]}
    foundSet: new Set(),
    selecting: {
      active: false,
      start: null, // {r,c}
      path: [] // celdas mientras arrastra
    }
  };

  // Persistencia de progreso por semilla y tamaño
  function storageKey(){
    return `pupiletra:${state.seed}:${state.size}`;
  }
  function saveProgress(){
    try{
      const payload = {
        found: Array.from(state.foundSet),
        ts: Date.now()
      };
      localStorage.setItem(storageKey(), JSON.stringify(payload));
    }catch{ /* ignore */ }
  }
  function loadProgress(){
    try{
      const raw = localStorage.getItem(storageKey());
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.found)) return data.found;
    }catch{ /* ignore */ }
    return [];
  }

  // Direcciones (8)
  const DIRS = [
    {dr: 0, dc: 1}, {dr: 0, dc: -1}, {dr: 1, dc: 0}, {dr: -1, dc: 0},
    {dr: 1, dc: 1}, {dr: 1, dc: -1}, {dr: -1, dc: 1}, {dr: -1, dc: -1}
  ];

  // UI refs
  const gridEl = document.getElementById('grid');
  const wordListEl = document.getElementById('wordList');
  const foundCountEl = document.getElementById('foundCount');
  const totalCountEl = document.getElementById('totalCount');
  const sizeInput = document.getElementById('sizeInput');
  const seedInput = document.getElementById('seedInput');
  const newBtn = document.getElementById('newBtn');
  const shareBtn = document.getElementById('shareBtn');
  const shareLink = document.getElementById('shareLink');

  function parseParams(){
    const url = new URL(location.href);
    const seed = url.searchParams.get('seed') || state.seed;
    const size = parseInt(url.searchParams.get('size')|| state.size, 10);
    state.seed = seed;
    state.size = Math.max(8, Math.min(24, isNaN(size) ? 14 : size));
    seedInput.value = seed;
    sizeInput.value = String(state.size);
  }

  function updateURL(){
    const url = new URL(location.href);
    url.searchParams.set('seed', state.seed);
    url.searchParams.set('size', String(state.size));
    history.replaceState(null, '', url.toString());
    shareLink.value = url.toString();
  }

  function reseed(){
    state.rng = rngFromSeed(state.seed);
  }

  function pickWords(){
    // Selecciona 12-16 palabras en función del tamaño
    const n = Math.min(16, Math.max(10, Math.floor(state.size * 0.9)));
    const pool = [...BIBLE_NAMES];
    const selected = [];
    while (selected.length < n && pool.length) {
      const idx = Math.floor(state.rng() * pool.length);
      const display = pool.splice(idx,1)[0];
      const norm = normalize(display);
      if (norm.length <= state.size) selected.push({display, norm});
    }
    state.words = selected;
  }

  function emptyGrid(){
    state.grid = Array.from({length: state.size}, () => Array(state.size).fill(''));
    state.placed = [];
    state.foundSet.clear();
  }

  function inBounds(r,c){ return r>=0 && r<state.size && c>=0 && c<state.size; }

  function canPlace(word, r, c, dir){
    const {dr, dc} = dir;
    for (let i=0;i<word.length;i++){
      const rr = r + dr*i, cc = c + dc*i;
      if (!inBounds(rr,cc)) return false;
      const ch = state.grid[rr][cc];
      if (ch && ch !== word[i]) return false;
    }
    return true;
  }

  function placeWord(word){
    // intenta varias posiciones
    const attempts = state.size * state.size * 6;
    for (let t=0; t<attempts; t++){
      const dir = choice(state.rng, DIRS);
      const r = Math.floor(state.rng()*state.size);
      const c = Math.floor(state.rng()*state.size);
      if (canPlace(word, r, c, dir)){
        const cells = [];
        for (let i=0;i<word.length;i++){
          const rr = r + dir.dr*i, cc = c + dir.dc*i;
          state.grid[rr][cc] = word[i];
          cells.push({r: rr, c: cc});
        }
        state.placed.push({word, cells});
        return true;
      }
    }
    return false;
  }

  function fillRandom(){
    for (let r=0;r<state.size;r++){
      for (let c=0;c<state.size;c++){
        if (!state.grid[r][c]){
          state.grid[r][c] = String.fromCharCode(65 + Math.floor(state.rng()*26));
        }
      }
    }
  }

  function generate(){
    emptyGrid();
    pickWords();
    // ordenar por longitud desc para facilitar colocación
    const wordsByLen = [...state.words].sort((a,b)=>b.norm.length - a.norm.length);
    for (const w of wordsByLen){ placeWord(w.norm); }
    fillRandom();
  }

  function render(){
    // grid
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${state.size}, 36px)`;
    gridEl.style.gridTemplateRows = `repeat(${state.size}, 36px)`;
    for (let r=0;r<state.size;r++){
      for (let c=0;c<state.size;c++){
        const div = document.createElement('div');
        div.className = 'cell';
        div.textContent = state.grid[r][c];
        div.dataset.r = r;
        div.dataset.c = c;
        gridEl.appendChild(div);
      }
    }

    // lista de palabras
    wordListEl.innerHTML = '';
    for (const {display, norm} of state.words){
      const li = document.createElement('li');
      li.dataset.word = norm;
      li.textContent = display;
      wordListEl.appendChild(li);
    }
    totalCountEl.textContent = String(state.words.length);
    foundCountEl.textContent = '0';
  }

  function markFound(wordNorm){
    state.foundSet.add(wordNorm);
    // resaltar celdas
    const placed = state.placed.find(p => p.word === wordNorm || p.word === wordNorm.split('').reverse().join(''));
    if (placed){
      for (const {r,c} of placed.cells){
        const idx = r*state.size + c;
        const el = gridEl.children[idx];
        el.classList.add('found');
      }
    }
    // lista
    const li = wordListEl.querySelector(`li[data-word="${CSS.escape(wordNorm)}"]`);
    if (li) li.classList.add('found');

    foundCountEl.textContent = String(state.foundSet.size);
    // guardar progreso
    saveProgress();
  }

  function clearSelectionVisual(){
    [...gridEl.children].forEach(el => el.classList.remove('selected','path'));
  }

  function setPathVisual(path){
    for (const {r,c} of path){
      const idx = r*state.size + c;
      const el = gridEl.children[idx];
      el.classList.add('path');
    }
  }

  function sameLine(start, end){
    const dr = end.r - start.r;
    const dc = end.c - start.c;
    if (dr === 0 && dc === 0) return null;
    const stepR = Math.sign(dr);
    const stepC = Math.sign(dc);
    // debe ser horizontal, vertical o diagonal perfecta
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
    const path = [];
    for (let i=0;i<len;i++){
      const r = start.r + stepR*i;
      const c = start.c + stepC*i;
      if (!inBounds(r,c)) return null;
      path.push({r,c});
    }
    return path;
  }

  function wordFromPath(path){
    return path.map(({r,c}) => state.grid[r][c]).join('');
  }

  function onMouseDown(e){
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    state.selecting.active = true;
    state.selecting.start = {r,c};
    state.selecting.path = [{r,c}];
    clearSelectionVisual();
    cell.classList.add('selected');
  }
  function onMouseEnter(e){
    if (!state.selecting.active) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    const start = state.selecting.start;
    const path = sameLine(start, {r,c});
    clearSelectionVisual();
    if (path){
      setPathVisual(path);
      state.selecting.path = path;
    }
  }
  function onMouseUp(){
    if (!state.selecting.active) return;
    const path = state.selecting.path;
    state.selecting.active = false;
    state.selecting.start = null;

    if (!path || path.length < 2){
      clearSelectionVisual();
      return;
    }
    const word = wordFromPath(path);
    const rev = word.split('').reverse().join('');
    const target = state.words.find(w => w.norm === word || w.norm === rev);
    if (target && !state.foundSet.has(target.norm)){
      markFound(target.norm);
    }
    clearSelectionVisual();
  }

  function attachEvents(){
    gridEl.addEventListener('mousedown', onMouseDown);
    gridEl.addEventListener('mouseenter', e => {
      // habilita recibir mouseenter en celdas mientras arrastra
      if (e.target === gridEl && state.selecting.active) e.preventDefault();
    }, true);
    gridEl.addEventListener('mouseover', onMouseEnter);
    window.addEventListener('mouseup', onMouseUp);

    newBtn.addEventListener('click', () => {
      const size = parseInt(sizeInput.value, 10);
      const seed = seedInput.value.trim() || 'amigos2025';
      state.size = Math.max(8, Math.min(24, isNaN(size) ? 14 : size));
      state.seed = seed;
      reseed();
      generate();
      render();
      updateURL();
      // restaurar progreso previo (si existe) para esta combinación de semilla/tamaño
      const saved = loadProgress();
      for (const w of saved){
        // solo marcar si la palabra pertenece al tablero actual
        if (state.words.some(x => x.norm === w)) markFound(w);
      }
    });

    shareBtn.addEventListener('click', async () => {
      updateURL();
      try{
        await navigator.clipboard.writeText(shareLink.value);
        shareBtn.textContent = '¡Copiado!';
        setTimeout(()=> shareBtn.textContent = 'Copiar enlace', 1200);
      }catch{
        shareLink.select();
        document.execCommand('copy');
      }
    });
  }

  function init(){
    parseParams();
    updateURL();
    reseed();
    generate();
    render();
    attachEvents();
    // aplicar progreso guardado (misma semilla y tamaño)
    const saved = loadProgress();
    for (const w of saved){
      if (state.words.some(x => x.norm === w)) markFound(w);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
