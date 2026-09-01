const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ===== SES MOTORU =====
// Web Audio API ile küçük efekt sesleri (zar, hamle, vuruş, kazanma) üretir.
// Tarayıcılar kullanıcı etkileşimi olmadan ses çalmaya izin vermediği için
// ilk tıklama/tuş basımında AudioContext "unlock" edilir.
const actx = new (window.AudioContext || window.webkitAudioContext)();
function unlockAudio(){ if(actx.state==="suspended") actx.resume(); }
window.addEventListener('click', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// Tek bir osilatör notası çalar (zar/hamle/kazanma seslerinin temel yapı taşı).
function playTone(freq, duration, type='square', volume=0.15, glideTo=null){
  const osc = actx.createOscillator(), gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, actx.currentTime);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, actx.currentTime + duration);
  gain.gain.setValueAtTime(volume, actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
  osc.connect(gain).connect(actx.destination);
  osc.start(); osc.stop(actx.currentTime + duration);
}

// Kısa bir "gürültü" patlaması üretir (taş vurma sesinin çarpma efekti için).
function playNoise(duration, volume=0.2){
  const bufferSize = actx.sampleRate*duration;
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1)*(1-i/bufferSize);
  const noise = actx.createBufferSource();
  noise.buffer = buffer;
  const gain = actx.createGain();
  gain.gain.setValueAtTime(volume, actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+duration);
  noise.connect(gain).connect(actx.destination);
  noise.start();
}
function vibrate(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }

// Oyun boyunca tetiklenen tüm ses/titreşim efektleri, olay adına göre gruplanmış.
const sfx = {
  dice: () => { for(let i=0;i<4;i++) setTimeout(()=>playTone(200+Math.random()*300,0.05,'square',0.06),i*40); vibrate(15); },
  move: () => playTone(340,0.06,'triangle',0.1,420),
  hit: () => { playNoise(0.2,0.22); playTone(120,0.18,'sawtooth',0.14,50); vibrate(40); },
  bearoff: () => playTone(660,0.15,'square',0.12,880),
  win: () => { [523,659,784,1046].forEach((f,i)=> setTimeout(()=>playTone(f,0.3,'square',0.15),i*130)); vibrate([80,60,80,60,120]); },
  select: () => playTone(500,0.04,'square',0.06),
  invalid: () => { playTone(150,0.1,'sawtooth',0.1); vibrate(20); }
};

// ===== BOARD LAYOUT =====
// Tahtanın piksel geometrisi: kenar boşlukları, çeyrek/nokta genişlikleri, bar ve off tepsisi konumu.
const boardX=40, boardY=40, boardW=740, boardH=480, barWidth=44;
const quadWidth=(boardW-barWidth)/2, pointWidth=quadWidth/6, rowHeight=240;
const barX = boardX+quadWidth;
const offX = boardX+boardW+16, offW=26;

// 0-23 arası nokta indeksini canvas üzerindeki x koordinatına çevirir.
// Tavla noktaları saat yönünün tersine numaralandığı için dört çeyrek ayrı ayrı hesaplanır.
function pointX(index){
  if(index>=12 && index<=17) return boardX + (index-12)*pointWidth;
  if(index>=18 && index<=23) return barX+barWidth + (index-18)*pointWidth;
  if(index>=6 && index<=11) return boardX + (11-index)*pointWidth;
  if(index>=0 && index<=5) return barX+barWidth + (5-index)*pointWidth;
}
// 12-23 arası noktalar tahtanın üst sırasında, 0-11 arası alt sırasındadır.
function isTopRow(index){ return index>=12 && index<=23; }

// ===== GAME STATE =====
// points[i]: {color:'w'|'b'|null, count:n} — 24 nokta üzerindeki taş dizilişi.
// bar/off: her renk için barda bekleyen ve dışarı çıkmış taş sayısı.
// remaining: bu elde henüz kullanılmamış zar değerleri (çift gelirse 4 eleman).
let points, bar, off, turn, remaining, selectedOrigin, legalMoves, gameOver;

// ===== UNDO (protects against accidental taps) =====
// Her hamle/pas öncesi tam bir durum anlık görüntüsü (snapshot) buraya eklenir.
let undoStack = [];

// ===== SCORE (persists across "Yeni Oyun", only "Skoru Sıfırla" resets it) =====
// nextStarter: winner of the previous round, who starts the next one.
// Reset to null (needing a fresh opening dice roll) whenever score is reset to 0-0.
let score = {w:0, b:0};
let nextStarter = null;

// Skoru (ve bir sonraki eli kimin başlatacağını) tarayıcının localStorage'ından okur.
function loadScore(){
  try{
    const saved = JSON.parse(localStorage.getItem('tavla_score'));
    if(saved && typeof saved.w==='number' && typeof saved.b==='number'){
      score = {w:saved.w, b:saved.b};
      if(saved.nextStarter==='w' || saved.nextStarter==='b') nextStarter=saved.nextStarter;
    }
  }catch(e){}
}
// Skoru (ve nextStarter'ı) localStorage'a yazar; sayfa yenilense de kaybolmaz.
function saveScore(){
  try{ localStorage.setItem('tavla_score', JSON.stringify({w:score.w, b:score.b, nextStarter})); }catch(e){}
}
// Skor tahtasındaki Beyaz/Siyah puan yazılarını günceller.
function updateScoreHUD(){
  document.getElementById('scoreW').textContent = score.w;
  document.getElementById('scoreB').textContent = score.b;
}

// Yeni bir el başlatır: taşları standart diziliş üzerine kurar, zar/hamle
// durumunu sıfırlar ve sırayı nextStarter'a (bir önceki elin kazananına,
// yoksa Beyaz'a) verir.
function initState(){
  points = new Array(24).fill(null).map(()=>({color:null,count:0}));
  const set=(i,c,n)=>{points[i]={color:c,count:n};};
  set(23,'w',2); set(12,'w',5); set(7,'w',3); set(5,'w',5);
  set(0,'b',2); set(11,'b',5); set(16,'b',3); set(18,'b',5);
  bar = {w:0,b:0};
  off = {w:0,b:0};
  turn = nextStarter || 'w';
  remaining = [];
  selectedOrigin = null;
  legalMoves = [];
  gameOver = false;
  undoStack = [];
  updateUndoBtn();
  updateHUD();
  document.getElementById('msg').style.display='none';
  document.getElementById('restart').style.display='none';
  document.getElementById('rollBtn').disabled=false;
  document.getElementById('passBtn').disabled=true;
  renderDice();
  draw();
}

// Rengin rakibini döndürür ('w' <-> 'b').
function opp(c){ return c==='w'?'b':'w'; }

// Bir rengin "iç tahta" (ev bölgesi) aralığını döndürür; taşlar buraya
// girmeden dışarı (off) çıkarılamaz.
function homeRange(c){ return c==='w' ? [0,5] : [18,23]; }

// Verilen rengin tüm taşlarının (barda hiçbiri kalmadan) iç tahtada
// olup olmadığını kontrol eder — bear-off'a başlayabilmenin şartıdır.
function allInHome(c){
  const [lo,hi]=homeRange(c);
  let total=0;
  for(let i=0;i<24;i++) if(points[i].color===c) total+=points[i].count;
  let inHome=0;
  for(let i=lo;i<=hi;i++) if(points[i].color===c) inHome+=points[i].count;
  return total===inHome && bar[c]===0;
}

// Bir taşın belirli bir zar değeriyle nereye gideceğini hesaplar.
// Beyaz 24->1 yönünde, Siyah 1->24 yönünde ilerler; "bar"dan giriş özel bir başlangıç noktasıdır.
function target(origin, die, color){
  if(color==='w'){
    if(origin==='bar') return 24-die;
    return origin-die;
  } else {
    if(origin==='bar') return die-1;
    return origin+die;
  }
}

// Tek bir (origin, zar) kombinasyonunun geçerli olup olmadığını değerlendirir.
// returns {type:'point',index} | {type:'off'} | null(illegal)
function evalMove(origin, die, color){
  if(origin==='bar' && bar[color]<=0) return null;
  if(origin!=='bar' && bar[color]>0) return null; // must enter from bar first
  if(origin!=='bar' && points[origin].color!==color) return null;

  const t = target(origin, die, color);

  if(t>=0 && t<=23){
    const p = points[t];
    if(p.color===null || p.color===color || p.count<=1) return {type:'point', index:t};
    return null; // blocked
  }
  // bear off scenario
  if(!allInHome(color)) return null;
  if(color==='w'){
    if(t===-1 && die===origin+1) return {type:'off'};
    if(t<-1 || (t===-1)){
      // overshoot check: die > distance, allowed only if no checkers on higher points (indices > origin) within home
      const dist = origin+1;
      if(die>=dist){
        for(let i=origin+1;i<=5;i++) if(points[i].color==='w' && points[i].count>0) return null;
        return {type:'off'};
      }
    }
    return null;
  } else {
    const dist = 24-origin;
    if(t===24 && die===dist) return {type:'off'};
    if(t>24 || t===24){
      if(die>=dist){
        for(let i=18;i<origin;i++) if(points[i].color==='b' && points[i].count>0) return null;
        return {type:'off'};
      }
    }
    return null;
  }
}

// Seçili bir taş için kalan zarların her birine göre mümkün olan tüm hamleleri listeler
// (tahtada yeşille işaretlenecek hedefleri belirlemek için kullanılır).
function computeLegalMoves(origin, color){
  const moves=[];
  const uniqueDice = [...new Set(remaining)];
  for(const die of uniqueDice){
    const res = evalMove(origin, die, color);
    if(res) moves.push({die, ...res});
  }
  return moves;
}

// Verilen renk için kalan zarlarla oynanabilecek herhangi bir hamle var mı diye bakar.
// Yoksa "Hamle Yok - Geç" butonu devreye girer.
function hasAnyLegalMove(color){
  const uniqueDice = [...new Set(remaining)];
  if(uniqueDice.length===0) return false;
  if(bar[color]>0){
    return uniqueDice.some(d=>evalMove('bar', d, color));
  }
  for(let i=0;i<24;i++){
    if(points[i].color===color && points[i].count>0){
      if(uniqueDice.some(d=>evalMove(i,d,color))) return true;
    }
  }
  return false;
}

// ===== UNDO =====
// Geri alınabilecek her şeyi (tahta, bar, off, sıra, zarlar, skor, kazanma
// mesajı ve buton durumları) tek bir nesnede toplar.
function snapshotState(){
  return {
    points: points.map(p=>({color:p.color, count:p.count})),
    bar: {...bar},
    off: {...off},
    turn, remaining: [...remaining],
    score: {...score}, nextStarter, gameOver,
    msgText: document.getElementById('msg').textContent,
    msgDisplay: document.getElementById('msg').style.display,
    restartDisplay: document.getElementById('restart').style.display,
    rollBtnDisabled: document.getElementById('rollBtn').disabled,
    passBtnDisabled: document.getElementById('passBtn').disabled,
  };
}
// Her hamle/pas öncesi çağrılır; mevcut durumu yığına (stack) ekler.
function pushUndo(){
  undoStack.push(snapshotState());
  if(undoStack.length>200) undoStack.shift();
  updateUndoBtn();
}
// "Geri Al" butonunun etkin/pasif durumunu yığının doluluğuna göre ayarlar.
function updateUndoBtn(){
  document.getElementById('undoBtn').disabled = undoStack.length===0;
  syncMirror();
}
// Bir snapshot'ı geri yükler: tüm oyun değişkenlerini ve ilgili DOM
// elemanlarını (mesaj, butonlar, zarlar) o ana ait haline döndürür.
function restoreState(s){
  points = s.points.map(p=>({color:p.color, count:p.count}));
  bar = {...s.bar};
  off = {...s.off};
  turn = s.turn;
  remaining = [...s.remaining];
  score = {...s.score};
  nextStarter = s.nextStarter;
  gameOver = s.gameOver;
  selectedOrigin = null;
  legalMoves = [];
  saveScore();
  updateScoreHUD();
  updateHUD();
  const msg = document.getElementById('msg');
  msg.textContent = s.msgText;
  msg.style.display = s.msgDisplay;
  document.getElementById('restart').style.display = s.restartDisplay;
  document.getElementById('rollBtn').disabled = s.rollBtnDisabled;
  document.getElementById('passBtn').disabled = s.passBtnDisabled;
  const area = document.getElementById('diceArea');
  area.innerHTML='';
  for(const v of remaining){
    const d = document.createElement('div');
    d.className='die';
    d.innerHTML = diePips(v);
    area.appendChild(d);
  }
  syncMirror();
  draw();
}

// Seçilen taşı (origin) hedefine taşır: rakip taşı vurma, bar'a gönderme,
// zar tüketme ve el/oyun sonu kontrollerinin tamamı burada yapılır.
function applyMove(origin, move){
  pushUndo();
  const color = turn;
  // remove from origin
  if(origin==='bar'){ bar[color]--; }
  else {
    points[origin].count--;
    if(points[origin].count===0) points[origin].color=null;
  }
  if(move.type==='off'){
    off[color]++;
    sfx.bearoff();
  } else {
    const p = points[move.index];
    if(p.color!==null && p.color!==color && p.count>0){
      // hit
      bar[opp(color)]++;
      p.color=color; p.count=1;
      sfx.hit();
    } else {
      p.color=color; p.count++;
      sfx.move();
    }
  }
  // consume die
  const idx = remaining.indexOf(move.die);
  remaining.splice(idx,1);

  selectedOrigin=null; legalMoves=[];

  if(off[color]===15){
    endGame(color);
    return;
  }

  if(remaining.length>0 && !hasAnyLegalMove(color)){
    remaining=[];
  }
  if(remaining.length===0){
    switchTurn();
  } else {
    updateHUD();
  }
  draw();
}

// Sırayı rakip renge devreder ve zar/buton durumunu yeni el için sıfırlar.
function switchTurn(){
  turn = opp(turn);
  remaining=[];
  selectedOrigin=null; legalMoves=[];
  document.getElementById('rollBtn').disabled=false;
  document.getElementById('passBtn').disabled=true;
  updateHUD();
}

// Oyunu bitirir: mars/çifte mars durumuna göre kazanılan puanı hesaplar,
// skoru günceller, kazanma mesajını gösterir ve bir sonraki eli bu
// kazananın başlatacağını (nextStarter) kaydeder.
function endGame(winner){
  gameOver=true;
  const loser = opp(winner);
  let earned = 1;
  let tag = '';
  if(off[loser]===0){
    // Mars (gammon): loser bore off nothing.
    // Çifte mars (backgammon): loser also still has a checker on the bar
    // or trapped inside the winner's home board.
    const [hlo,hhi] = homeRange(winner);
    let doubleMars = bar[loser]>0;
    if(!doubleMars){
      for(let i=hlo;i<=hhi;i++){
        if(points[i].color===loser && points[i].count>0){ doubleMars=true; break; }
      }
    }
    earned = doubleMars ? 3 : 2;
    tag = doubleMars ? ' (ÇİFTE MARS! +3)' : ' (MARS! +2)';
  }
  score[winner] += earned;
  nextStarter = winner;
  saveScore();
  updateScoreHUD();

  const msg=document.getElementById('msg');
  msg.textContent = (winner==='w'?'BEYAZ':'SİYAH') + " KAZANDI!" + tag;
  msg.style.display='block';
  document.getElementById('restart').style.display='block';
  document.getElementById('rollBtn').disabled=true;
  syncMirror();
  sfx.win();
}

// "Zar At" işleminin tamamı: iki zar atar (çift gelirse 4 hamle hakkı),
// zarları gösterir ve hiç geçerli hamle yoksa "Geç" butonunu açar.
// Hem üstteki hem alttaki (Beyaz/Siyah'a bakan) buton bu fonksiyonu çağırır.
function doRoll(){
  if(gameOver) return;
  const d1 = 1+Math.floor(Math.random()*6);
  const d2 = 1+Math.floor(Math.random()*6);
  remaining = d1===d2 ? [d1,d1,d1,d1] : [d1,d2];
  sfx.dice();
  document.getElementById('rollBtn').disabled=true;
  renderDice([d1,d2], d1===d2);

  if(!hasAnyLegalMove(turn)){
    setTimeout(()=>{
      document.getElementById('passBtn').disabled=false;
      syncMirror();
    }, 300);
  }
  updateHUD();
  draw();
}
document.getElementById('rollBtn').addEventListener('click', doRoll);

// Oynanacak hamle kalmadığında sırayı diğer tarafa geçirir; öncesinde geri
// alınabilmesi için mevcut durum yığına eklenir.
function doPass(){
  pushUndo();
  switchTurn();
  renderDice();
}
document.getElementById('passBtn').addEventListener('click', doPass);

// Yığındaki son durumu geri yükler (yanlışlıkla basılan hamle/pas'ı iptal eder).
function doUndo(){
  if(undoStack.length===0) return;
  restoreState(undoStack.pop());
  updateUndoBtn();
}
document.getElementById('undoBtn').addEventListener('click', doUndo);

document.getElementById('restart').addEventListener('click', initState);

// Skoru sıfırlar ve yeni bir maç için açılış zar atışı ekranını açar.
document.getElementById('resetScoreBtn').addEventListener('click', ()=>{
  score = {w:0, b:0};
  nextStarter = null;
  undoStack = [];
  updateUndoBtn();
  saveScore();
  updateScoreHUD();
  showOpenRoll();
});

// ===== OPENING ROLL (who starts, only needed while score is 0-0) =====
// Each side rolls its own die on its own tap: 'w' -> 'b' -> 'done' (tie sends it back to 'w').
let openRollPhase = 'w';
let openRollDW = null, openRollDB = null;

// Açılış zar atışı modalındaki başlık/buton metnini mevcut aşamaya (openRollPhase) göre günceller.
function updateOpenRollUI(){
  const btn = document.getElementById('openRollBtn');
  const sub = document.getElementById('openRollSub');
  if(openRollPhase==='w'){
    sub.textContent = 'Skorlar 0-0. Sırayla zar atılacak: önce Beyaz atsın.';
    btn.textContent = 'Beyaz Zar Atsın';
  } else if(openRollPhase==='b'){
    sub.textContent = 'Şimdi sırada Siyah var.';
    btn.textContent = 'Siyah Zar Atsın';
  } else {
    btn.textContent = 'Oyuna Başla';
  }
  btn.disabled=false;
}
// Açılış zar atışı modalını sıfırlayıp gösterir (skor 0-0 olduğunda çağrılır).
function showOpenRoll(){
  openRollPhase='w';
  openRollDW=null; openRollDB=null;
  document.getElementById('orDieW').innerHTML='';
  document.getElementById('orDieB').innerHTML='';
  document.getElementById('openRollResult').textContent='';
  updateOpenRollUI();
  document.getElementById('openRollOverlay').style.display='flex';
}
function hideOpenRoll(){
  document.getElementById('openRollOverlay').style.display='none';
}
// Açılış zar atışı modalındaki tek butonun tüm akışı: önce Beyaz'ın zarı,
// sonra Siyah'ın zarı atılır; berabere olursa baştan başlanır, kazanan
// belirlenince "Oyuna Başla" ile asıl oyun (initState) tetiklenir.
document.getElementById('openRollBtn').addEventListener('click', ()=>{
  const resultEl = document.getElementById('openRollResult');

  if(openRollPhase==='done'){
    hideOpenRoll();
    initState();
    return;
  }

  if(openRollPhase==='w'){
    openRollDW = 1+Math.floor(Math.random()*6);
    document.getElementById('orDieW').innerHTML = diePips(openRollDW);
    sfx.dice();
    openRollPhase='b';
    updateOpenRollUI();
    return;
  }

  // openRollPhase==='b'
  openRollDB = 1+Math.floor(Math.random()*6);
  document.getElementById('orDieB').innerHTML = diePips(openRollDB);
  sfx.dice();

  if(openRollDW===openRollDB){
    resultEl.textContent = 'Berabere (' + openRollDW + '-' + openRollDB + ')! Baştan, yine Beyaz atsın.';
    openRollDW=null; openRollDB=null;
    document.getElementById('orDieW').innerHTML='';
    document.getElementById('orDieB').innerHTML='';
    openRollPhase='w';
    updateOpenRollUI();
    return;
  }

  const winner = openRollDW>openRollDB ? 'w' : 'b';
  nextStarter = winner;
  saveScore();
  resultEl.textContent = (winner==='w'?'Beyaz':'Siyah') + ' başlıyor! (' + openRollDW + '-' + openRollDB + ')';
  openRollPhase='done';
  updateOpenRollUI();
});

// Karşılıklı (yüz yüze) oynanışta tahtanın altındaki 180° döndürülmüş
// kontrol satırını üsttekiyle senkron tutar, böylece herkesin butonu kendine bakar.
function syncMirror(){
  const label = document.getElementById('turnLabel');
  const label2 = document.getElementById('turnLabel2');
  label2.innerHTML = label.innerHTML;
  label2.className = label.className;

  document.getElementById('diceArea2').innerHTML = document.getElementById('diceArea').innerHTML;

  document.getElementById('rollBtn2').disabled = document.getElementById('rollBtn').disabled;
  document.getElementById('passBtn2').disabled = document.getElementById('passBtn').disabled;
  document.getElementById('undoBtn2').disabled = document.getElementById('undoBtn').disabled;

  // Üst koltuk (rollBtn/passBtn) hep Beyaz'a, alt koltuk (rollBtn2/passBtn2) hep Siyah'a aittir.
  // Sırası gelmeyen tarafın Zar At / Geç butonu, karşı taraf adına basılmasın diye kilitlenir.
  const whiteTurn = turn === 'w';
  document.getElementById('rollBtn').disabled = document.getElementById('rollBtn').disabled || !whiteTurn;
  document.getElementById('passBtn').disabled = document.getElementById('passBtn').disabled || !whiteTurn;
  document.getElementById('rollBtn2').disabled = document.getElementById('rollBtn2').disabled || whiteTurn;
  document.getElementById('passBtn2').disabled = document.getElementById('passBtn2').disabled || whiteTurn;
}

// Siyah'a bakan (alt/üst konumdaki, role göre değişen) butonlar da aynı
// doRoll/doPass/doUndo fonksiyonlarını çağırır — .click() ile birincil
// butona devretmek yerine, kendi disabled durumuna göre bağımsız çalışırlar.
document.getElementById('rollBtn2').addEventListener('click', doRoll);
document.getElementById('passBtn2').addEventListener('click', doPass);
document.getElementById('undoBtn2').addEventListener('click', doUndo);

// Sıra etiketini ("BEYAZ OYNUYOR" / "SİYAH OYNUYOR" rozeti) günceller ve
// karşı tarafa bakan kopyasıyla senkronlar.
function updateHUD(){
  const label = document.getElementById('turnLabel');
  const isWhite = turn==='w';
  label.innerHTML = '<span class="turn-dot"></span>' + (isWhite ? 'BEYAZ OYNUYOR' : 'SİYAH OYNUYOR');
  label.className = isWhite ? 'turn-w' : 'turn-b';
  syncMirror();
}

// Zar atıldığında gösterilecek zar ikonlarını çizer (çift gelirse 4 zar).
function renderDice(vals, isDouble){
  const area = document.getElementById('diceArea');
  area.innerHTML='';
  const show = vals || [];
  const list = isDouble ? [vals[0],vals[0],vals[0],vals[0]] : show;
  for(const v of list){
    const d = document.createElement('div');
    d.className='die';
    d.innerHTML = diePips(v);
    area.appendChild(d);
  }
  syncMirror();
}
// 1-6 arası bir zar değerinin nokta (pip) desenini küçük bir SVG olarak üretir.
function diePips(n){
  const pos = {
    1:[[13,13]],
    2:[[6,6],[20,20]],
    3:[[6,6],[13,13],[20,20]],
    4:[[6,6],[6,20],[20,6],[20,20]],
    5:[[6,6],[6,20],[13,13],[20,6],[20,20]],
    6:[[6,6],[6,13],[6,20],[20,6],[20,13],[20,20]]
  };
  let svg = '<svg viewBox="0 0 26 26">';
  for(const [x,y] of pos[n]) svg += `<circle cx="${x}" cy="${y}" r="2.4" fill="#1a1206"/>`;
  svg += '</svg>';
  return svg;
}

// ===== CLICK HANDLING =====
// Tahta üzerindeki tüm tıklamaları yönetir: önce off tepsisi, sonra bar,
// sonra normal noktalar sırasıyla kontrol edilir. Bir taş zaten seçiliyse
// tıklama geçerli bir hedefse hamle uygulanır; değilse yeni bir taş seçilir.
canvas.addEventListener('click', (e)=>{
  if(gameOver || remaining.length===0) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX-rect.left) * (W/rect.width);
  const my = (e.clientY-rect.top) * (H/rect.height);

  // check off tray click (for bearing off when selected)
  if(selectedOrigin!==null && mx>=offX && mx<=offX+offW){
    const mv = legalMoves.find(m=>m.type==='off');
    if(mv){ applyMove(selectedOrigin, mv); renderRemainingDice(); return; }
  }

  // check bar click
  if(mx>=barX && mx<=barX+barWidth){
    if(bar[turn]>0){
      selectedOrigin='bar';
      legalMoves = computeLegalMoves('bar', turn);
      if(legalMoves.length===0) sfx.invalid(); else sfx.select();
      draw();
    }
    return;
  }

  // determine point index clicked
  let clickedIndex=null;
  for(let i=0;i<24;i++){
    const px=pointX(i);
    const top = isTopRow(i);
    const py = top ? boardY : boardY+rowHeight;
    if(mx>=px && mx<=px+pointWidth && my>=py && my<=py+rowHeight){
      clickedIndex=i; break;
    }
  }
  if(clickedIndex===null) return;

  // if a legal destination among current legalMoves
  if(selectedOrigin!==null){
    const mv = legalMoves.find(m=>m.type==='point' && m.index===clickedIndex);
    if(mv){ applyMove(selectedOrigin, mv); renderRemainingDice(); return; }
  }

  // otherwise try selecting this point as origin
  if(bar[turn]>0){ sfx.invalid(); return; } // must move from bar first
  if(points[clickedIndex].color===turn && points[clickedIndex].count>0){
    selectedOrigin=clickedIndex;
    legalMoves = computeLegalMoves(clickedIndex, turn);
    if(legalMoves.length===0) sfx.invalid(); else sfx.select();
    draw();
  } else {
    selectedOrigin=null; legalMoves=[];
    draw();
  }
});

// Bir hamleden sonra kalan zarları yeniden çizer; zar kalmadıysa "Zar At"ı,
// hiç hamle yoksa "Geç" butonunu açar.
function renderRemainingDice(){
  const area = document.getElementById('diceArea');
  area.innerHTML='';
  for(const v of remaining){
    const d = document.createElement('div');
    d.className='die';
    d.innerHTML = diePips(v);
    area.appendChild(d);
  }
  if(remaining.length===0){
    document.getElementById('rollBtn').disabled = gameOver;
  } else if(!hasAnyLegalMove(turn)){
    document.getElementById('passBtn').disabled=false;
  }
  syncMirror();
}

// ===== DRAWING =====
// Tahtanın tamamını (zemin, noktalar, taşlar, bar, off tepsisi) canvas
// üzerine yeniden çizer. Her durum değişikliğinden sonra çağrılır.
function draw(){
  ctx.clearRect(0,0,W,H);
  // wood background
  ctx.fillStyle='#5c3a21';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#3d2716';
  ctx.fillRect(boardX-8,boardY-8,boardW+16,boardH+16);
  ctx.fillStyle='#6b4526';
  ctx.fillRect(boardX,boardY,boardW,boardH);

  // bar
  ctx.fillStyle='#2a1a0f';
  ctx.fillRect(barX,boardY,barWidth,boardH);

  // points (triangles)
  for(let i=0;i<24;i++){
    const px=pointX(i);
    const top=isTopRow(i);
    const pointNum=i+1;
    const light = pointNum%2===0;
    ctx.fillStyle = light ? '#c9a876' : '#8a5a34';
    ctx.beginPath();
    if(top){
      ctx.moveTo(px,boardY);
      ctx.lineTo(px+pointWidth,boardY);
      ctx.lineTo(px+pointWidth/2, boardY+rowHeight-20);
    } else {
      ctx.moveTo(px,boardY+boardH);
      ctx.lineTo(px+pointWidth,boardY+boardH);
      ctx.lineTo(px+pointWidth/2, boardY+boardH-rowHeight+20);
    }
    ctx.closePath();
    ctx.fill();

    // highlight legal target
    const isLegalTarget = legalMoves.some(m=>m.type==='point' && m.index===i);
    if(isLegalTarget){
      ctx.fillStyle='rgba(92,255,140,0.35)';
      ctx.fill();
    }
    if(selectedOrigin===i){
      ctx.strokeStyle='#5cffe0'; ctx.lineWidth=3;
      ctx.stroke();
    }
  }

  // point number labels
  ctx.font='10px Arial'; ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.textAlign='center';
  for(let i=0;i<24;i++){
    const px=pointX(i)+pointWidth/2;
    const top=isTopRow(i);
    ctx.fillText(i+1, px, top?boardY-4:boardY+boardH+14);
  }

  // checkers on points
  for(let i=0;i<24;i++){
    const p=points[i];
    if(p.count===0) continue;
    drawStack(pointX(i)+pointWidth/2, i, p.color, p.count);
  }

  // bar checkers
  drawBarStack('w', bar.w);
  drawBarStack('b', bar.b);

  // bar selected highlight
  if(selectedOrigin==='bar'){
    ctx.strokeStyle='#5cffe0'; ctx.lineWidth=3;
    ctx.strokeRect(barX+2,boardY+2,barWidth-4,boardH-4);
  }

  // off trays
  ctx.fillStyle='#2a1a0f';
  ctx.fillRect(offX,boardY,offW,boardH);
  const offTargetLegal = legalMoves.some(m=>m.type==='off');
  if(offTargetLegal){
    ctx.fillStyle='rgba(92,255,140,0.35)';
    ctx.fillRect(offX,boardY,offW,boardH);
  }
  ctx.font='bold 13px Arial'; ctx.textAlign='center';
  ctx.fillStyle='#f0ead6';
  ctx.fillText('Beyaz', offX+offW/2, boardY+boardH-10);
  ctx.fillText(off.w, offX+offW/2, boardY+boardH-26);
  ctx.fillStyle='#2b2f38';
  ctx.fillStyle='#cfcfcf';
  ctx.fillText('Siyah', offX+offW/2, boardY+16);
  ctx.fillText(off.b, offX+offW/2, boardY+32);
}

function checkerColor(c){ return c==='w' ? '#f0ead6' : '#20232b'; }
function checkerStroke(c){ return c==='w' ? '#a89a72' : '#000'; }

// Bir nokta üzerindeki taş yığınını çizer; 5'ten fazla taş varsa üstte "+n" yazar.
function drawStack(cx, index, color, count){
  const top=isTopRow(index);
  const r=20;
  const maxShown=5;
  const shown=Math.min(count,maxShown);
  for(let s=0;s<shown;s++){
    const cy = top ? boardY+r+2+s*(r*1.85) : boardY+boardH-r-2-s*(r*1.85);
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=checkerColor(color);
    ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle=checkerStroke(color);
    ctx.stroke();
    if(s===shown-1 && count>maxShown){
      ctx.fillStyle = color==='w' ? '#1a1206' : '#f0ead6';
      ctx.font='bold 13px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('+'+(count-maxShown+1), cx, cy);
      ctx.textBaseline='alphabetic';
    }
  }
}

// Bardaki taş yığınını çizer (Beyaz alttan yukarı, Siyah üstten aşağı dizilir).
function drawBarStack(color, count){
  if(count===0) return;
  const cx = barX+barWidth/2;
  const r=18;
  const baseY = color==='w' ? boardY+boardH-r-4 : boardY+r+4;
  const dir = color==='w' ? -1 : 1;
  const shown=Math.min(count,4);
  for(let s=0;s<shown;s++){
    const cy = baseY + dir*s*(r*1.9);
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=checkerColor(color);
    ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle=checkerStroke(color);
    ctx.stroke();
    if(s===shown-1 && count>4){
      ctx.fillStyle = color==='w' ? '#1a1206' : '#f0ead6';
      ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('+'+(count-4+1), cx, cy);
      ctx.textBaseline='alphabetic';
    }
  }
}

// ===== BAŞLANGIÇ =====
// Kayıtlı skoru yükle; skor hâlâ 0-0 ve henüz bir başlatıcı belirlenmemişse
// açılış zar atışı ekranını göster, aksi halde doğrudan oyunu başlat.
loadScore();
updateScoreHUD();
if(nextStarter===null && score.w===0 && score.b===0){
  showOpenRoll();
} else {
  initState();
}
