#  Tavla

Klasik kurallarla, 2 kişilik, aynı cihazdan (yüz yüze) sırayla oynanan tam bir tavla (backgammon) uygulaması.

**Oyna:** [Canlı link](https://emirhankrcbn.github.io/tavla/) *(GitHub Pages aktif edince çalışır)*

## Nasıl Oynanır
- Skorlar 0-0 iken önce Beyaz, sonra Siyah kendi zarını atar; yüksek zar atan oyunu başlatır (berabere olursa tekrar atılır)
- "Zar At" ile zar at (çift gelirse 4 hamle hakkı)
- Kendi taşına tıkla → geçerli noktalar yeşille işaretlenir → hedefe tıkla
- Barda taşın varsa önce onu oyuna sokman gerekir
- Tüm taşların iç tahtana girince taşları dışarı (off) çıkarabilirsin
- Yanlışlıkla bastıysan " Geri Al" ile son hamleni veya geçişini geri alabilirsin

## Özellikler
- Standart 15'er taş dizilişi, tam kurallar (vurma, bar, bear-off)
- Skor takibi: normal kazanışta 1, mars'ta 2, çifte mars'ta 3 puan; skor tarayıcıda saklanır
- Her turun kazananı bir sonraki turu başlatır, "Skoru Sıfırla" denene kadar bu böyle sürer
- Karşılıklı (yüz yüze) oynanış için tahtanın altında 180° döndürülmüş, üsttekiyle senkron ikinci bir kontrol çubuğu — herkesin "Zar At" butonu kendine bakar
- Sırası gelen tarafı gösteren, rengine göre parlayan büyük bir rozet ("BEYAZ OYNUYOR" / "SİYAH OYNUYOR")
- Son hamleyi/geçişi geri alma butonu
- Zar, hamle, vuruş ve kazanma sesleri
- Mobil ve yatay (landscape) ekranlara uyumlu düzen
- Harici bağımlılık yok — sade HTML + CSS + JS (`index.html`, `style.css`, `script.js`)

## Teknoloji
Vanilla JavaScript + HTML5 Canvas
