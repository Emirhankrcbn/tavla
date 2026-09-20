'use strict';
// script.js düz bir <script> dosyası (modül değil) ve doğrudan document/window/
// localStorage/AudioContext/navigator'a dokunuyor. Bu dosya, gerçek bir tarayıcı
// olmadan script.js'i Node içinde çalıştırabilmek için gereken minimum sahte
// (mock) ortamı kurar; script.js'in TEK BİR SATIRI bile değiştirilmez.
//
// Kritik nokta: script.js'teki oyun durumu (points/bar/off/turn/remaining/...)
// `let` ile tanımlı ve dışarıya export edilmiyor. Bunlara testlerden erişebilmek
// için script.js kaynağının SONUNA, aynı vm bağlamında (dolayısıyla aynı
// top-level lexical scope'ta) çalışacak küçük bir "köprü" kodu ekliyoruz —
// bu köprü de script.js içeriğiyle aynı script metninin parçası olduğu için
// `points`, `turn` gibi değişkenlere doğrudan erişebiliyor.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'script.js');

function noop(){}

// Her DOM elemanı için: addEventListener/dispatch çifti gerçek olay akışını taklit eder.
function makeElement(id){
  const listeners = Object.create(null);
  const children = [];
  const el = {
    id,
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    title: '',
    children,
    appendChild(child){ children.push(child); return child; },
    addEventListener(type, fn){
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    dispatch(type, evt){
      for(const fn of (listeners[type] || [])) fn(evt || {});
    },
    click(){ el.dispatch('click', {}); },
  };
  return el;
}

// draw() sadece canvas 2D context metodlarını/özelliklerini kullanıyor;
// gerçek çizim yapmasına gerek yok, sadece çökmemesi yeterli.
function makeCanvasContext(){
  const ctx = {};
  for(const m of ['clearRect','fillRect','strokeRect','beginPath','moveTo','lineTo','closePath','fill','stroke','arc','fillText']){
    ctx[m] = noop;
  }
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.font = ''; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return ctx;
}

function makeCanvas(){
  const el = makeElement('board');
  el.width = 820; el.height = 600;
  el.getContext = () => makeCanvasContext();
  // width/height = 820/600 => click.js'teki (W/rect.width) ölçeklemesi 1:1 olur,
  // böylece testlerde clientX/clientY doğrudan canvas piksel koordinatı olarak kullanılabilir.
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 820, height: 600 });
  return el;
}

// localStorage mock'u: gerçek Storage API'siyle aynı imzaya sahip, bellek içi bir Map.
// throwOnSetItem/rawData ile "kota dolu" veya "bozuk kayıtlı veri" senaryoları enjekte edilebilir.
function makeLocalStorage({ rawData = {}, throwOnSetItem = false } = {}){
  const store = new Map(Object.entries(rawData));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if(throwOnSetItem) throw new DOMExceptionLike('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store),
  };
}
function DOMExceptionLike(name){
  const e = new Error(name);
  e.name = name;
  return e;
}

// AudioContext mock'u: gerçek ses çalmaz, sadece script.js'in çağırdığı
// createOscillator/createGain/createBuffer/createBufferSource API yüzeyini karşılar.
class FakeAudioContext {
  constructor(){ this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  createOscillator(){
    return {
      type: '',
      frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
      connect(){ return this; },
      start: noop, stop: noop,
    };
  }
  createGain(){
    return { gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect(){ return this; } };
  }
  createBuffer(_channels, length){
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource(){
    return { buffer: null, connect(){ return this; }, start: noop };
  }
  resume(){ this.state = 'running'; }
}

// Testlerden erişilebilecek her şeyi (DOM elemanları, window olay dinleyicileri,
// localStorage) tek bir handle içinde toplar.
function createSandbox({ localStorage: lsOpts, hasAudioContext = true, vibrate = noop } = {}){
  const elements = new Map();
  function getElementById(id){
    if(!elements.has(id)) elements.set(id, id === 'board' ? makeCanvas() : makeElement(id));
    return elements.get(id);
  }
  const windowListeners = Object.create(null);
  const windowMock = {
    addEventListener(type, fn){ (windowListeners[type] || (windowListeners[type] = [])).push(fn); },
  };
  if(hasAudioContext) windowMock.AudioContext = FakeAudioContext;

  const localStorageMock = makeLocalStorage(lsOpts);

  const sandbox = {
    window: windowMock,
    document: {
      getElementById,
      createElement: () => makeElement('__created'),
      addEventListener: noop,
    },
    navigator: { vibrate },
    localStorage: localStorageMock,
    console,
    setTimeout, clearTimeout,
    Math, JSON, Array, Object, Set, Map, Date, Float32Array,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  return { context, elements, getElementById, localStorage: localStorageMock, windowListeners };
}

// script.js'i verilen sandbox içinde çalıştırır ve testler için bir "köprü"
// (__test__) ekleyip döndürür. Script her çağrıldığında SIFIRDAN çalışır
// (top-level init dahil), tıpkı sayfa yeniden yüklenmiş gibi.
function loadGame(sandboxOpts){
  const { context, elements, localStorage, windowListeners } = createSandbox(sandboxOpts);
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const bridge = `
;var __test__ = {
  getState: function(){
    return {
      points: (points || []).map(function(p){ return { color:p.color, count:p.count }; }),
      bar: Object.assign({}, bar),
      off: Object.assign({}, off),
      turn: turn,
      remaining: (remaining || []).slice(),
      selectedOrigin: selectedOrigin,
      gameOver: gameOver,
      score: Object.assign({}, score),
      nextStarter: nextStarter,
      undoStackLength: undoStack.length,
      rollEnabled: rollEnabled,
      passEnabled: passEnabled,
    };
  },
  setPoints: function(p){ points = p; },
  setBar: function(b){ bar = b; },
  setOff: function(o){ off = o; },
  setTurn: function(t){ turn = t; },
  setRemaining: function(r){ remaining = r; },
  setGameOver: function(g){ gameOver = g; },
  setSelectedOrigin: function(o){ selectedOrigin = o; legalMoves = computeLegalMoves(o, turn); combinedMoves = computeCombinedMoves(o, turn); },
  fns: {
    opp: opp, homeRange: homeRange, target: target, evalMove: evalMove,
    computeLegalMoves: computeLegalMoves, computeCombinedMoves: computeCombinedMoves,
    allInHome: allInHome, hasAnyLegalMove: hasAnyLegalMove,
    initState: initState, applyMove: applyMove, applyCombinedMove: applyCombinedMove,
    doRoll: doRoll, doPass: doPass, doUndo: doUndo, pushUndo: pushUndo,
    resignGame: resignGame, openResignConfirm: openResignConfirm,
    endGame: endGame, finishGameEnd: finishGameEnd,
    loadScore: loadScore, saveScore: saveScore, switchTurn: switchTurn,
  },
};
`;
  vm.runInContext(src + bridge, context, { filename: 'script.js(+test-bridge)' });
  return { context, elements, api: context.__test__, localStorage, windowListeners };
}

module.exports = { loadGame, createSandbox, makeElement, makeCanvas, makeLocalStorage, FakeAudioContext };
