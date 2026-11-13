# Golden Trading Journal v2

Dnevnik trgovanja u okviru ekosistema The Golden Circle. Statična aplikacija: čist HTML, CSS i JavaScript (ES moduli), bez frameworka, bez build koraka i bez spoljnih zavisnosti u browseru.

Status: v2 zamenjuje v1 na GitHub Pages. Poslednje stanje v1 je označeno git tagom `v1` i može da se vrati.

## Pokretanje na localhostu

Potreban je Node.js 20 ili noviji.

```
npm start
```

Zatim otvori http://localhost:8080. Drugi port: `PORT=3000 npm start` (Windows PowerShell: `$env:PORT=3000; npm start`).

Bez Node-a radi i VS Code dodatak Live Server: desni klik na `index.html`, pa "Open with Live Server".

Dupli klik na `index.html` ne radi. Aplikacija koristi ES module, a browser ih ne učitava sa `file://` adrese. U tom slučaju na ekranu ostaje poruka sa uputstvom.

## Testovi

```
npm install
npm test
```

61 test, u tri grupe:

- `tests/calc.test.js`: obračun (PnL, R, drawdown, dnevni limiti, tilt, dani discipline, validacija unosa).
- `tests/store.test.js`: čuvanje, preuzimanje podataka iz v1, backup.
- `tests/ui.test.js`: cela aplikacija nad pravim `index.html` u simuliranom browseru (jsdom).

## Podaci iz v1

- Na istoj adresi (isti domen kao v1) podaci se preuzimaju sami pri prvom pokretanju. v1 podaci se pri tome ne menjaju i ne brišu.
- Na localhostu browser ne vidi podatke sa GitHub Pages adrese. Tu ide ručno: u v1 klikni "Backup JSON", pa u v2 "Imam backup, učitaj ga" na početnom ekranu ili Podešavanja, Učitaj backup.
- Rizik u dolarima se za v1 trade-ove obnavlja, ne preuzima. v1 je veličinu pozicije računala iz balansa koji je sama naduvala pogrešnim PnL-om, pa se ta vrednost ne koristi. Trade-ovi se prolaze redom kojim su uneti i svaki rizikuje svoj Risk % od tačnog balansa u tom trenutku. Zato su brojevi u v2 drugačiji nego u v1.
- Trade bez ispravnih cena ili bez Risk % se preskače, a poruka kaže koliko ih je preskočeno.

## Struktura

```
index.html            jedina stranica
css/styles.css        izgled, brend tokeni na vrhu fajla
assets/crown.png      originalna kruna, neizmenjena
js/main.js            ulazna tačka u browseru
js/app.js             stanje, čuvanje, navigacija, tilt sat
js/calc.js            sav obračun, čiste funkcije
js/trade.js           validacija, kreiranje i izmena trade-a, čitanje v1 zapisa
js/store.js           oblik dokumenta, backup, adapter za čuvanje
js/insights.js        uvidi na pregledu
js/format.js          formatiranje i bezbedan HTML šablon
js/ui.js              obaveštenja, dijalozi, preuzimanje i izbor fajla
js/trade-form.js      forma za unos i izmenu (ista forma za oba)
js/views/             pregled, istorija, analitika, podešavanja
tools/serve.mjs       lokalni server za testiranje
tests/                testovi
```

Dva pravila na kojima kod stoji:

1. Jedan obračun. `tradePnL()` u `js/calc.js` je jedino mesto gde se računa dolarski rezultat trade-a. Pregled, kalendar, analitika, limiti, kriva kapitala i CSV ga svi koriste.
2. Jedan put do čuvanja. Sve izmene idu kroz `app.commit()`, a čuvanje kroz adapter sa dve metode, `load()` i `save(doc)`. Danas je to localStorage. Baza se kasnije priključuje zamenom adaptera, bez diranja ostatka koda.

## Kako dnevnik računa

- Rizik u dolarima se fiksira pri unosu: balans u tom trenutku puta Risk %. Taj iznos je 1R.
- R je pomeranje cene od Entry do izlaza, podeljeno rastojanjem Entry do Stop Loss, u smeru trade-a.
- Bez Exit cene, Win se računa do Take Profit-a, a Loss kao -1R. BE je uvek 0.
- PnL je R puta rizik u dolarima. Spread, provizija i swap nisu uključeni.
- Win rate je broj Win trade-ova kroz ukupan broj trade-ova (BE ulazi u ukupan broj).
- Dan trade-a je lokalni datum koji je unet, ne UTC.

## Šta je drugačije nego u v1

Ispravke:

- Dolarski PnL je bio pogrešan (R se množio veličinom pozicije umesto rizikom u dolarima).
- Isti trade je davao različite brojke na različitim mestima. Sada postoji jedan obračun.
- Trade-ovi posle ponoći su se knjižili na prethodni dan.
- Dva trade-a u istom minutu su delila identifikator, pa je izmena ili brisanje moglo da pogodi pogrešan.
- Zaboravljen smer je tiho postajao Sell. Sada se unos odbija uz poruku pored polja.
- Result se više ne pogađa iz Take Profit-a.
- Tekst iz polja se uvek prikazuje kao tekst (zaštita od XSS).
- CSV pravilno navodi tekst i neutrališe formule.

Odluke koje menjaju ponašanje (lako se vraćaju ako ne odgovaraju):

- **Dani discipline** se računaju iz trade-ova: uzastopni dani trgovanja u kojima je svaki trade bio po planu. Dan bez trade-ova ne prekida niz (u v1 je vikend prekidao niz), a jedan trade van plana ga prekida (u v1 je bio dovoljan jedan trade po planu u danu).
- **Tilt** posle isteka pauze: ista serija gubitaka ne zaključava ponovo, ali sledeći gubitak u toj seriji zaključava odmah. Stari podaci pri učitavanju ne pokreću pauzu. Ispravka pogrešno unetog gubitka skida pauzu.
- **Dnevni gubitak** se meri prema balansu na početku dana, ne prema trenutnom.
- **Prosečan R** je ostvareni R, ne planirani.
- **Logout** je uklonjen jer naloga nema. Početni balans i Reset su u Podešavanjima.
- **Decimal.js** je uklonjen. Računa se običnim brojevima uz čišćenje zaokruživanja, što je dovoljno za R i PnL i uklanja zavisnost od CDN-a.
- **Emocije**: skala je označena kao 1 miran, 10 pod pritiskom. To je izvedeno iz pravila u v1 koje upozorava kada je prosek iznad 7.

Dodato uz postojeće segmente: potpuna izmena trade-a (datum, rizik, smer), provera strane za Stop Loss i Take Profit, prikaz rizika u dolarima i R:R tokom unosa, linijski grafikon kapitala, filter BE u istoriji, kolone smer i PnL, dijalozi za potvrdu umesto sistemskih.

## Brend

- Boje iz master dokumenta: crna `#111111`, zlatna `#FFB132`, krem `#F7F3EA`, bela `#FFFFFF`. Zlatna je samo akcenat. Nema gradijenata, sjaja ni senki.
- Kruna je originalni PNG, bajt po bajt isti kao dostavljeni fajl. Nije precrtavana ni bojena.
- Zelena `#7CC49A` i crvena `#E27D6D` su funkcionalne boje za dobitak i gubitak. Nisu deo brend palete i čekaju potvrdu.
- Fontovi su sistemski (serif za naslove, sans za podatke). Zvanični brend font još nije definisan, pa nijedan nije proglašen zvaničnim.

## Šta v2 namerno nema

Nalozi i baza, uvoz iz MT4/MT5, screenshot-ovi uz trade, prilagođeni setup-i, provizija i swap, više računa. To dolazi posle probe sa članovima.

Podaci žive samo u browseru u kom su uneti. Brisanje podataka browsera briše i dnevnik, zato postoji Backup.
