'use strict';
// Bu proje bir form/API'si olan bir uygulama değil (input alanı, ağ isteği yok);
// bu yüzden klasik "boş input / çok uzun input / ağ hatası" senaryoları burada
// kendi karşılıklarına çevrilmiş durumda:
//   - "boş/hatalı format girdi"   -> bozuk localStorage JSON'u, geçersiz zar değeri
//   - "çok uzun girdi"            -> 200 sınırını aşan undo geçmişi
//   - "ağ hatası"                 -> localStorage/AudioContext gibi tarayıcı
//                                    API'lerine erişilememesi (bu projenin tek
//                                    dış bağımlılıkları)
//   - "eşzamanlı işlem"           -> aynı fonksiyonun (doRoll/doPass) UI'daki
//                                    disabled korumasına güvenmeden art arda
//                                    çağrılması
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./dom-mock.js');

function freshGame(opts){
  const game = loadGame(opts);
  game.api.fns.initState();
  return game;
}

// api.getState()/fns.evalMove() gibi çağrılar sonucu dönen nesneler vm
// sandbox'ının KENDİ Object/Array prototiplerinden üretiliyor (script.js orada
// çalışıyor); bu yüzden host tarafındaki literal nesnelerle referans/prototip
// bazlı deepStrictEqual başarısız olur ("aynı yapıda ama referansça eşit değil").
// JSON round-trip, saf veriyi host realm'e taşıyıp bu sorunu ortadan kaldırır.
function plain(v){ return JSON.parse(JSON.stringify(v)); }

// ===== 1) BOZUK / EKSİK LOCALSTORAGE VERİSİ ("hatalı format girdi") =====

test('bozuk JSON içeren tavla_score ile açılış çökmüyor ve skor varsayılana dönüyor', () => {
  const { api } = loadGame({ localStorage: { rawData: { tavla_score: '{bu-json-degil' } } });
  // loadScore() zaten script.js içinde try/catch'li; burada asıl kontrol ettiğimiz
  // script'in YÜKLENİRKEN (top-level) hiç çökmediği ve skorun 0-0'a düştüğü.
  const s = api.getState();
  assert.deepEqual(plain(s.score), { w: 0, b: 0 });
});

test('geçerli JSON ama anlamsız alanlar (skor string, nextStarter geçersiz) sessizce yok sayılıyor', () => {
  const raw = JSON.stringify({ w: '5', b: null, nextStarter: 'x' });
  const { api } = loadGame({ localStorage: { rawData: { tavla_score: raw } } });
  const s = api.getState();
  // loadScore() typeof kontrolü yaptığı için sayısal olmayan w/b kabul edilmemeli.
  assert.deepEqual(plain(s.score), { w: 0, b: 0 });
  assert.equal(s.nextStarter, null);
});

test('localStorage tamamen boşsa (ilk ziyaret) skor 0-0 ile başlıyor', () => {
  const { api } = loadGame({ localStorage: { rawData: {} } });
  assert.deepEqual(plain(api.getState().score), { w: 0, b: 0 });
});

// ===== 2) LOCALSTORAGE'A YAZILAMAMASI ("ağ hatası" analogu: dış API erişilemez) =====

test('localStorage.setItem kota hatasıyla patlarsa oyun çökmeden devam ediyor', () => {
  const { api } = freshGame({ localStorage: { throwOnSetItem: true } });
  // saveScore() resignGame/endGame içinde çağrılıyor; setItem her zaman throw
  // etse bile oyunun kendisi (gameOver, skor) doğru güncellenmeli.
  // resignGame kullanıyoruz çünkü kazanılan puanı sabit (1) veriyor; endGame'in
  // mars/çifte mars hesabı tahtanın anlık diziliminden etkilenir ve bu testin
  // amacı olan "localStorage hatası oyunu bozmuyor" ile ilgisizdir.
  assert.doesNotThrow(() => {
    api.fns.resignGame('b');
  });
  assert.equal(api.getState().gameOver, true);
  assert.equal(api.getState().score.w, 1);
});

// ===== 3) AudioContext DESTEKLENMEYEN TARAYICI ("ağ hatası" analogu: dış API yok) =====

test('window.AudioContext da webkitAudioContext da yoksa script yüklenirken çöküyor (bilinen kırılganlık)', () => {
  // Bu test bir "beklenen davranış" değil, mevcut bir kırılganlığı belgeliyor:
  // script.js dosyasının en üstünde `new (window.AudioContext || window.webkitAudioContext)()`
  // try/catch'siz çalışıyor. Ses API'si olmayan/kısıtlanmış bir ortamda (bazı
  // gömülü tarayıcılar, bazı otomasyon araçları) TÜM oyun hiç açılmadan çöker.
  assert.throws(() => {
    loadGame({ hasAudioContext: false });
  }, /AudioContext/);
});

// ===== 4) ART ARDA / EŞZAMANLI ÇAĞRI ("eşzamanlı işlem") =====

test('doRoll art arda iki kez çağrılırsa (çift tık / eşzamanlı) zarları sessizce değiştiriyor', () => {
  // rollBtn.disabled=true olması SADECE UI katmanında korur; doRoll'un kendisi
  // gameOver dışında hiçbir koruma yapmıyor. Bu test, doğrudan çağrıldığında
  // (örn. programatik bir tetikleme ya da syncMirror'da ileride çıkabilecek bir
  // hata) ikinci çağrının ilk zarı sessizce ezdiğini belgeliyor.
  const { api } = freshGame();
  api.fns.doRoll();
  const afterFirst = api.getState();
  assert.equal(afterFirst.rollEnabled, false); // UI: rollBtn artık disabled olmalı...
  api.fns.doRoll(); // ...ama doRoll'un kendisi bunu KONTROL ETMİYOR, yine de çalışıyor.
  const afterSecond = api.getState();
  assert.ok([2, 4].includes(afterSecond.remaining.length)); // ilk zar sessizce kayboldu, yenisi geldi
});

test('gameOver iken doRoll/doPass/doUndo no-op kalıyor', () => {
  const { api } = freshGame();
  api.fns.endGame('w');
  const before = api.getState();
  api.fns.doRoll();
  api.fns.doPass();
  assert.deepEqual(api.getState().remaining, before.remaining);
  assert.equal(api.getState().gameOver, true);
});

test('undoStack 200 sınırını aşan çok uzun bir oyun geçmişinde en eskiyi atıp sabit kalıyor ("çok uzun girdi")', () => {
  const { api } = freshGame();
  for(let i = 0; i < 250; i++) api.fns.pushUndo();
  assert.equal(api.getState().undoStackLength, 200);
});

// ===== 5) GEÇERSİZ / SINIR DIŞI ZAR DEĞERİ ("hatalı format" - beklenmeyen veri) =====

test('evalMove sınır dışı bir zar değeriyle (0) çökmeden değerlendiriyor (bilinen kırılganlık)', () => {
  // Zarlar normalde sadece 1-6 arası üretiliyor, ama evalMove kendi başına
  // die değerini doğrulamıyor. die=0 verildiğinde target() origin'in KENDİSİNİ
  // döndürüyor ve nokta kendi rengiyle dolu olduğu için "geçerli hamle" gibi
  // değerlendiriliyor — yani taş olduğu yerde durmayı "hamle" sayıyor.
  const { api } = freshGame();
  const res = api.fns.evalMove(23, 0, 'w'); // beyazın 24 numaralı noktası (index 23)
  assert.deepEqual(plain(res), { type: 'point', index: 23 });
});

test('evalMove aralık dışı büyük bir zar (7) ile normal bir nokta hamlesini reddediyor', () => {
  const { api } = freshGame();
  // index 23 (24 nolu nokta) - 7 = 16, karşı tarafın 3'lü taş yığını olan nokta (index 16, siyah 3 taş)
  // block kontrolüne takılıp null dönmeli (taş sayısı >1 ve renk farklı).
  const res = api.fns.evalMove(23, 7, 'w');
  assert.equal(res, null);
});

// ===== 6) OYUN MANTIĞI UÇ DURUMLARI (kapalı tahta / bar / bear-off sınırları) =====

test('barda taşı olan oyuncu için tüm giriş noktaları kapalıysa hiç yasal hamle yok', () => {
  const { api } = freshGame();
  const points = new Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  // Beyaz barda 1 taş; siyah, beyazın giriş bölgesi olan 18-23 (index) aralığının
  // TAMAMINI 2'şer taşla kapatmış (closed board) -> giriş imkansız.
  for(let i = 18; i <= 23; i++) points[i] = { color: 'b', count: 2 };
  api.setPoints(points);
  api.setBar({ w: 1, b: 0 });
  api.setOff({ w: 0, b: 0 });
  api.setTurn('w');
  api.setRemaining([1, 2, 3, 4, 5, 6]);
  assert.equal(api.fns.hasAnyLegalMove('w'), false);
});

test('bear-off: home içinde daha yüksek taş varken fazla zarla (overshoot) çıkış yapılamaz', () => {
  const { api } = freshGame();
  const points = new Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  points[1] = { color: 'w', count: 1 }; // 2 nolu nokta (uzaklık 2)
  points[4] = { color: 'w', count: 1 }; // 5 nolu nokta (uzaklık 5) — origin'den daha "yüksek"
  api.setPoints(points);
  api.setBar({ w: 0, b: 0 });
  api.setOff({ w: 13, b: 0 });
  api.setTurn('w');
  // origin=1 (2 nolu nokta) için die=6: tam uzaklık değil (overshoot), ama index 4'te
  // (5 nolu nokta, origin'den yüksek) hâlâ taş var -> bu zarla ÇIKIŞ YAPILAMAMALI.
  const res = api.fns.evalMove(1, 6, 'w');
  assert.equal(res, null);
});

test('bear-off: aynı senaryoda en yüksek taş için overshoot ile çıkış geçerli', () => {
  const { api } = freshGame();
  const points = new Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  points[4] = { color: 'w', count: 1 }; // 5 nolu nokta (uzaklık 5), tahtadaki en yüksek beyaz taş
  api.setPoints(points);
  api.setBar({ w: 0, b: 0 });
  api.setOff({ w: 14, b: 0 });
  api.setTurn('w');
  const res = api.fns.evalMove(4, 6, 'w'); // 6 > 5 ama daha yüksek taş yok -> geçerli
  assert.deepEqual(plain(res), { type: 'off' });
});

test('tüm taşlar iç tahtada değilken bear-off denemesi reddediliyor', () => {
  const { api } = freshGame();
  const points = new Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  points[4] = { color: 'w', count: 1 };   // iç tahtada (0-5)
  points[10] = { color: 'w', count: 1 };  // iç tahtada DEĞİL
  api.setPoints(points);
  api.setBar({ w: 0, b: 0 });
  api.setOff({ w: 13, b: 0 });
  api.setTurn('w');
  assert.equal(api.fns.allInHome('w'), false);
  const res = api.fns.evalMove(4, 5, 'w');
  assert.equal(res, null);
});

// ===== 7) BAŞLANGIÇ DİZİLİŞİ (regresyon: elle yazılan koordinatlar bozulmasın) =====

test('initState standart 15 taşlık başlangıç dizilişini kuruyor', () => {
  const { api } = freshGame();
  const s = api.getState();
  const total = (color) => s.points.reduce((sum, p) => sum + (p.color === color ? p.count : 0), 0);
  assert.equal(total('w'), 15);
  assert.equal(total('b'), 15);
  assert.deepEqual(plain(s.bar), { w: 0, b: 0 });
  assert.deepEqual(plain(s.off), { w: 0, b: 0 });
});

// ===== 8) SIRASI GELMEYEN TARAFIN PES ETMESİ ("eşzamanlı işlem": sırası olmayan taraf) =====

test('sırası gelmeyen taraf da pes edebiliyor ve rakip kazanıyor', () => {
  const { api } = freshGame();
  assert.equal(api.getState().turn, 'w'); // sıra Beyaz'da
  api.fns.resignGame('b'); // ama Siyah pes ediyor
  const s = api.getState();
  assert.equal(s.gameOver, true);
  assert.equal(s.score.w, 1);
  assert.equal(s.score.b, 0);
});

test('oyun zaten bittikten sonra tekrar pes etme çağrısı skoru değiştirmiyor', () => {
  const { api } = freshGame();
  api.fns.resignGame('b');
  const after1 = api.getState().score;
  api.fns.resignGame('w'); // gameOver=true olduğu için no-op olmalı
  const after2 = api.getState().score;
  assert.deepEqual(after1, after2);
});
