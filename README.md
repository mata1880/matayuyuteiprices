# Yuyu-tei Scraper (local, free clone of the Apify actor)

Scrapes [yuyu-tei.jp](https://yuyu-tei.jp) — Japan's biggest TCG singles shop —
for sell prices and buylist (kaitori) prices by set code, and merges them
into one row per card, matching the shape of the `lulzasaur/yuyutei-scraper`
Apify actor's output. Runs entirely on your machine, no Apify account or fee.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Usage

```bash
# Sell + buylist merged, like the screenshot table
python yuyutei_scraper.py --game ws --set osk3.0 --mode both --out cards.csv

# Just sell prices, as JSON
python yuyutei_scraper.py --game poc --set sv08a --mode sell --out cards.json

# Several sets in one run
python yuyutei_scraper.py --game ygo --set wpp6 --set rota --mode both --out cards.csv
```

### Finding `--game` and `--set` codes

Open the set's sell page on yuyu-tei.jp and read the codes out of the URL:

```
https://yuyu-tei.jp/sell/ws/s/osk3.0
                       ^^  ^^^^^^^
                     game   set code
```

Common game codes: `poc` Pokémon, `ygo` Yu-Gi-Oh, `opc` One Piece,
`dm` Duel Masters, `ws` Weiss Schwarz, `vg` Vanguard, `bs` Battle Spirits,
`digi` Digimon, `ua` Union Arena.

## Output columns

Same fields as the Apify actor: `name`, `cardNumber`, `rarity`, `setCode`,
`sellPriceJpy`, `buyPriceJpy`, `buyPriceBaseJpy`, `buyPriceBoosted`,
`spreadJpy`, `stock`, `condition`, `availability`, `imageUrl`, `url`, `scrapedAt`.

Sell and buy rows are merged on `cardNumber` (e.g. `OSK/S133-002SSP`), which
already encodes set + collector number + rarity, so it's a reliable join key.

## Web viewer (GitHub Pages)

There's also a static site in `docs/` — a table you can filter by game, set,
and sell/buylist/both, similar in spirit to a page like
[riley31415.github.io/wuwa_calc](https://riley31415.github.io/wuwa_calc/).
Important difference: **it's not live** — GitHub Pages can't run Python or
call yuyu-tei.jp for you (no server, and the browser would be blocked by
CORS anyway). The page just reads JSON files you generate locally.

### Workflow

1. Scrape a set with `--site` added, which writes into `docs/data/`:
   ```bash
   python yuyutei_scraper.py --game ws --set osk3.0 --mode both --site
   python yuyutei_scraper.py --game poc --set sv08a --mode both --site
   ```
   Each run adds/updates `docs/data/<game>_<set>.json` and refreshes
   `docs/data/manifest.json` (the index the page uses to fill the dropdowns).
   Re-run any time to refresh a set's prices.

2. Preview locally before pushing anything, from the `docs/` folder:
   ```bash
   cd docs
   python3 -m http.server 8000
   ```
   Open `http://localhost:8000` — opening `index.html` directly by
   double-clicking won't work, browsers block `fetch()` on `file://` pages.

3. Push it to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Yuyu-tei price viewer"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   Then on GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main`, folder: `/docs`** → Save.
   Your page goes live at `https://<you>.github.io/<repo>/`.

4. To refresh prices later: re-run step 1 for whichever sets you want
   updated, then `git add docs/data && git commit -m "update prices" && git push`.

The repo ships with one sample set already in `docs/data/` so the page
isn't empty the first time you open it — delete `docs/data/ws_sample.json`
and its entry in `manifest.json` once you've scraped real sets.

## If it comes back with 0 results

Retail sites tweak their markup periodically. The parser is written to be
resilient — it anchors on each card's own detail-page link
(`/sell/<game>/card/<set>/<id>`) rather than guessing CSS class names — but
if a run ever returns nothing:

```bash
python yuyutei_scraper.py --game ws --set osk3.0 --mode sell --debug
```

This saves the raw HTML of the page to `debug_page.html` so you can inspect
it (or share it) to fix the selectors.

## Notes

- No login or API key needed — these are public catalog pages.
- The script sleeps `--delay` seconds (default 1.5s) between requests. Don't
  set this too low; be a good citizen and you're less likely to get
  rate-limited or IP-blocked.
- Yuyu-tei only lists Japanese-language cards, and card names on the site
  are in Japanese.
- `stock` on listing pages is exposed as in-stock vs. sold-out rather than
  an exact quantity (the actor's screenshot numbers like "2" or "3" come
  from a stepper max that isn't reliably exposed on this page type) — if
  you need a real quantity, fetch each card's own detail page
  (`/sell/<game>/card/<set>/<id>`) instead of the set-listing page.
