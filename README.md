# Yuyu-tei Scraper (local, free clone of the Apify actor)

Scrapes [yuyu-tei.jp](https://yuyu-tei.jp) — Japan's biggest TCG singles shop —
for sell prices and buylist (kaitori) prices by set code, and merges them
into one row per card, matching the shape of the `lulzasaur/yuyutei-scraper`
Apify actor's output. Runs entirely on your machine, no Apify account or fee.

## Please use responsibly

Yuyu-tei's `robots.txt` asks automated tools not to crawl the site. This
script is meant for light, personal, occasional use — checking prices on a
handful of sets you actually care about, not bulk-downloading their whole
catalog. Keep `--delay` at a reasonable value (1.5s+), don't run it on a
schedule/cron, and don't hammer it with many sets back-to-back.

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

There's also a static site in `docs/` — locked to Weiss Schwarz, with a
single search box: type a set's name, its yuyu-tei code, **or the code
printed on the card** (e.g. `OSK/S133`) and it suggests matches from sets
you've already scraped, each showing when it was last updated. Picking one
loads a Rarity tick-box filter (only showing rarities that set actually
has) plus a text filter for individual cards. Important difference from
something like a live calculator app: **it's not live** — GitHub Pages
can't run Python or call yuyu-tei.jp for you (no server, and the browser
would be blocked by CORS anyway). The page just reads JSON files you
generate locally, and can only suggest sets already in `docs/data/`.

### Workflow: scrape directly using the code printed on the card (simplest)

Yuyu-tei's own search already filters cleanly to just that set, so there's
no real need to translate the card's code into their internal slug first —
just scrape straight from the search results:

```bash
python yuyutei_scraper.py --card-code "OSK/S133" --mode both --site
```
```
Searching sell listings for "OSK/S133": ...
  -> matched 24 sell rows (dropped 6 unrelated)
Searching buylist for "OSK/S133": ...
  -> matched 24 buy rows (dropped 5 unrelated)

24 card(s) found — "【推しの子】Vol.3" (osk3.0)
```
One command, done — this both scrapes the set and adds it (with its real
name) to `docs/data/` for the website's search box. This is what you'll
use most of the time.

### Workflow: find yuyu-tei's internal code without scraping yet

If you just want to check what a printed code maps to, without committing
to a full scrape yet:

```bash
python yuyutei_scraper.py --find-set "OSK/S133"
```
```
Searching yuyu-tei for "OSK/S133"...
Found cards from 1 set(s):
  osk3.0          ( 24 matching cards)  -> 【推しの子】Vol.3

Run this for whichever one is right:
  python yuyutei_scraper.py --game ws --set osk3.0 --mode both --site
```

### Workflow: already know the internal code

If you'd rather just double-check a code you already have:

```bash
python yuyutei_scraper.py --lookup key20th
```
```
"key20th" is: Key 20th Anniversary

If that's the right set, run:
  python yuyutei_scraper.py --game ws --set key20th --mode both --site
```

### Full setup

1. Look up and scrape whichever sets you care about (repeat as needed):
   ```bash
   python yuyutei_scraper.py --lookup osk3.0
   python yuyutei_scraper.py --game ws --set osk3.0 --mode both --site
   ```
   Each scrape adds/updates `docs/data/ws_<code>.json` and refreshes
   `docs/data/manifest.json` (what the search box reads from). Re-run the
   same command any time to refresh a set's prices.

2. Preview locally before pushing anything, from the `docs/` folder:
   ```bash
   cd docs
   python3 -m http.server 8000
   ```
   Open `http://localhost:8000` — opening `index.html` directly by
   double-clicking won't work, browsers block `fetch()` on `file://` pages.

3. Push it to GitHub (repeatable — just `git add`, `commit`, `push` each
   time you scrape something new):
   ```bash
   git add .
   git commit -m "update prices"
   git push
   ```
   First-time setup if you haven't already:
   ```bash
   git init
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   Then on GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main`, folder: `/docs`** → Save.
   The repo (and Pages) must be **public** on a free GitHub account.

The repo ships with one sample set already in `docs/data/` so the page
isn't empty the first time you open it — delete `docs/data/ws_sample.json`
and its entry in `manifest.json` once you've scraped a real set.

## Card catalog (`wstcg_scraper.py`) — official card details

A second, separate scraper pulls from **ws-tcg.com**, the official
Bushiroad card database — a real JSON API, unlike yuyu-tei's scraped HTML.
This gets you things yuyu-tei doesn't have at all: full card text, traits,
level/cost/power/soul/color/trigger, and the real expansion name (fetched
automatically from the site's own filter-options endpoint and cached
locally — no manual copying needed).

```bash
python wstcg_scraper.py --query OSK --site
```
`--query` matches whatever you'd type into ws-tcg.com's own search box —
a title code like `OSK`, or a card/series name. `--site` writes into
`docs/data/catalog_<query>.json` (+ `catalog_manifest.json`), which
`collection.html` automatically cross-references against your price data
by card number — click the ⓘ next to a card's name to see its full text
and stats once both scrapers have run.

This is entirely optional — prices work fine without it. It's purely an
enrichment layer for the collection page.

## Collection & Wishlist — Browse / Wishlist / Collection pages

Three linked pages (nav bar at the top of every page), all reading the
same scraped data:

- **`browse.html`** — a card grid (bigger artwork, closer to how yuyu-tei
  or a card-database site displays cards) of everything in your selected
  sets, paginated (24/48/96 per page), filterable by set/rarity/name.
  Each card has a **+** (top-left, add to collection) and a **♥**
  (top-right, add to wishlist) right on the tile. Click the card image
  itself to open a detail popup with full card text and stats (needs the
  catalog scraper to have run for that card — see below).
- **`wishlist.html`** — the same grid, but only cards you've hearted,
  pulled from every set you've scraped (not just what's selected in
  Browse).
- **`collection.html`** — same idea for cards you've added with **+**,
  and shows your total owned copies.

On the **+** button: click adds a copy, right-click removes one. The
number shown on the button is how many you own.

These three pages share one JS/CSS file (`assets/wsdata.js` /
`assets/wsdata.css`) — if you ever edit filtering or tile behavior, that's
the one file to change; the pages themselves are thin wrappers around it.

**Important limitation:** your collection and wishlist are saved with
`localStorage`, meaning **only in the browser you used to mark them** — not
synced anywhere, and wiped if that browser's site data is ever cleared.
Use the **Export backup** button (on the Wishlist/Collection pages)
regularly to save a JSON file, and **Import backup** to restore it (in the
same browser after clearing data, or to carry your collection into a
different browser/computer). This isn't automatic — it's on you to export
when you want a backup.

If you outgrow this later, the fix is a small backend (there's a note
about this in the price-viewer section above) so your collection is
properly stored and synced instead of living in browser storage.

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
