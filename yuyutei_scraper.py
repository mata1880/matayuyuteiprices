#!/usr/bin/env python3
"""
Yuyu-tei Scraper (local clone of lulzasaur/yuyutei-scraper on Apify)
=====================================================================

Scrapes yuyu-tei.jp (Japan's largest TCG singles shop) for sell prices
and/or buylist (kaitori) prices, by set code, and merges them into the
same record shape the Apify actor produces:

    {
      "game": "ws",
      "setCode": "osk3.0",
      "cardNumber": "OSK/S133-002SSP",
      "name": "Happy Spring Day MEMちょ(サイン入り)",
      "rarity": "SSP",
      "sellPriceJpy": 12800,
      "buyPriceJpy": 7000,
      "buyPriceBaseJpy": null,
      "buyPriceBoosted": false,
      "spreadJpy": 5800,
      "stock": 2,
      "condition": "near_mint",
      "availability": "In Stock",
      "imageUrl": "...",
      "url": "https://yuyu-tei.jp/sell/ws/card/osk3.0/10248",
      "scrapedAt": "2026-09-16T12:00:00Z"
    }

USAGE
-----
    pip install -r requirements.txt

    # Full set, sell + buylist merged (matches the screenshot table)
    python yuyutei_scraper.py --game ws --set osk3.0 --mode both --out cards.csv

    # Sell prices only
    python yuyutei_scraper.py --game poc --set sv08a --mode sell --out cards.json

    # Multiple sets in one run
    python yuyutei_scraper.py --game ygo --set wpp6 --set rota --mode both --out cards.csv

NOTES
-----
- This talks directly to yuyu-tei.jp's public pages. No login, no API key.
- Yuyu-tei is JP-only content; set codes come from the set's URL, e.g.
  https://yuyu-tei.jp/sell/poc/s/sv08a  ->  set code is "sv08a"
- Be polite: the script sleeps between requests (--delay, default 1.5s).
  Hammering the site can get your IP rate-limited or blocked.
- The parser is written to be resilient to markup tweaks (it anchors on
  each card's own detail-page link rather than guessing CSS class names),
  but retail sites do change their HTML. If a run comes back with 0 cards,
  re-run with --debug to dump the raw HTML of one page to debug_page.html
  and inspect it / send it back for a selector fix.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

import requests
from bs4 import BeautifulSoup

# =============================================================================
# EDIT THESE if you just want to hit "Run" in VS Code instead of using the
# command line. They're only used when you run the script with no --game/
# --set/etc. arguments; anything you type on the command line overrides them.
# =============================================================================
DEFAULT_GAME = "ws"              # e.g. ws, poc, ygo, opc, dm, ua, vg, digi, bs
DEFAULT_SETS = ["osk3.0"]        # one or more set codes, e.g. ["osk3.0", "key20th"]
DEFAULT_MODE = "both"            # "sell", "buy", or "both"
DEFAULT_OUT = "cards.csv"        # output file, .csv or .json
DEFAULT_DELAY = 1.5              # seconds between requests
# =============================================================================

BASE_URL = "https://yuyu-tei.jp"
CARD_LINK_RE = re.compile(r"/(sell|buy)/([a-z0-9]+)/card/([^/]+)/(\d+)")
RARITY_HEADING_RE = re.compile(r"^([^\s]+)\s*Card List$")
YEN_RE = re.compile(r"([\d,]+)\s*円")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
}


@dataclass
class CardRecord:
    game: str
    setCode: str
    cardId: str
    cardNumber: str
    name: str
    rarity: Optional[str] = None
    condition: str = "near_mint"
    sellPriceJpy: Optional[int] = None
    buyPriceJpy: Optional[int] = None
    buyPriceBaseJpy: Optional[int] = None
    buyPriceBoosted: bool = False
    spreadJpy: Optional[int] = None
    stock: Optional[int] = None
    availability: Optional[str] = None
    imageUrl: Optional[str] = None
    url: Optional[str] = None
    scrapedAt: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def fetch(session: requests.Session, url: str, delay: float, debug: bool = False) -> str:
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    time.sleep(delay)
    if debug:
        with open("debug_page.html", "w", encoding="utf-8") as f:
            f.write(resp.text)
        print(f"[debug] saved raw HTML of {url} -> debug_page.html")
    return resp.text


def parse_yen(text: str) -> Optional[int]:
    m = YEN_RE.search(text)
    if not m:
        return None
    return int(m.group(1).replace(",", ""))


def find_container(a_tag):
    """
    Walk up from a card's <a> link to the smallest ancestor block that
    also contains a yen price, which is a reliable proxy for "this is the
    whole product row/card, not the whole page".
    """
    node = a_tag
    for _ in range(6):  # don't walk up forever
        parent = node.parent
        if parent is None:
            break
        text = parent.get_text(" ", strip=True)
        if "円" in text and len(text) < 400:
            return parent
        node = parent
    return a_tag.parent or a_tag


def parse_listing_page(html: str, game: str, set_code: str, listing_type: str):
    """
    listing_type: "sell" or "buy"
    Returns a list of dicts with raw scraped fields for one listing page.
    """
    soup = BeautifulSoup(html, "html.parser")

    current_rarity = None
    seen_card_ids = set()
    rows = []

    for el in soup.descendants:
        # Track the most recent "XXX Card List" heading text as we walk the DOM.
        if isinstance(el, str):
            stripped = el.strip()
            m = RARITY_HEADING_RE.match(stripped)
            if m:
                current_rarity = m.group(1)
            continue

        if el.name != "a":
            continue
        href = el.get("href", "")
        m = CARD_LINK_RE.search(href)
        if not m:
            continue

        _type, url_game, url_set, card_id = m.groups()
        key = (url_game, url_set, card_id)
        if key in seen_card_ids:
            continue

        container = find_container(el)
        block_text = container.get_text("\n", strip=True)
        lines = [l for l in block_text.split("\n") if l.strip()]

        # Card number is usually the first short line (e.g. "OSK/S133-002SSP")
        card_number = None
        for l in lines:
            if re.match(r"^[A-Za-z0-9][A-Za-z0-9/._\-]{2,25}$", l) and "円" not in l:
                card_number = l
                break

        # Name: prefer the <a> tag's own text if it looks like "code rarity name",
        # else fall back to the longest non-numeric line in the block.
        name = None
        a_text = el.get_text(" ", strip=True)
        if card_number and a_text.startswith(card_number):
            rest = a_text[len(card_number):].strip()
            # strip a leading rarity token if present (e.g. "SSP Happy ...")
            parts = rest.split(" ", 1)
            if len(parts) == 2 and len(parts[0]) <= 8:
                name = parts[1]
            elif rest:
                name = rest
        if not name:
            candidates = [l for l in lines if "円" not in l and l != card_number]
            name = max(candidates, key=len) if candidates else a_text

        # Prices: collect all yen amounts in the block, in order of appearance.
        prices = [int(x.replace(",", "")) for x in YEN_RE.findall(block_text)]

        # Stock / availability heuristics
        sold_out = ("SOLD OUT" in block_text.upper()) or ("売り切れ" in block_text)
        has_cart_button = ("カートへ" in block_text) or ("買取リストへ" in block_text)
        has_qty_stepper = "- +" in block_text or re.search(r"[-−]\s*\+", block_text)

        if sold_out or not has_qty_stepper:
            stock = 0
            availability = "Sold Out"
        else:
            stock = None  # yuyu-tei doesn't expose exact qty on listing pages beyond in/out of stock
            availability = "In Stock"

        boosted = "PRICE UP" in block_text.upper()

        img_tag = container.find("img")
        image_url = None
        if img_tag:
            image_url = img_tag.get("src") or img_tag.get("data-src")
            if image_url and image_url.startswith("//"):
                image_url = "https:" + image_url
            elif image_url and image_url.startswith("/"):
                image_url = BASE_URL + image_url

        rows.append(
            {
                "game": game,
                "setCode": set_code,
                "cardId": card_id,
                "cardNumber": card_number or "",
                "name": name or "",
                "rarity": current_rarity,
                "prices": prices,
                "boosted": boosted,
                "stock": stock,
                "availability": availability,
                "imageUrl": image_url,
                "url": BASE_URL + href if href.startswith("/") else href,
                "listing_type": listing_type,
            }
        )
        seen_card_ids.add(key)

    return rows


def scrape_set(session: requests.Session, game: str, set_code: str, mode: str,
                delay: float, debug: bool = False):
    sell_rows, buy_rows = [], []

    if mode in ("sell", "both"):
        url = f"{BASE_URL}/sell/{game}/s/{set_code}"
        print(f"Fetching sell listing: {url}")
        html = fetch(session, url, delay, debug)
        sell_rows = parse_listing_page(html, game, set_code, "sell")
        print(f"  -> parsed {len(sell_rows)} sell rows")

    if mode in ("buy", "both"):
        url = f"{BASE_URL}/buy/{game}/s/{set_code}"
        print(f"Fetching buylist: {url}")
        html = fetch(session, url, delay, debug)
        buy_rows = parse_listing_page(html, game, set_code, "buy")
        print(f"  -> parsed {len(buy_rows)} buy rows")

    return merge_rows(sell_rows, buy_rows, mode)


def merge_rows(sell_rows, buy_rows, mode):
    by_number = {}

    for r in sell_rows:
        rec = CardRecord(
            game=r["game"], setCode=r["setCode"], cardId=r["cardId"],
            cardNumber=r["cardNumber"], name=r["name"], rarity=r["rarity"],
            stock=r["stock"], availability=r["availability"],
            imageUrl=r["imageUrl"], url=r["url"],
        )
        # first (non-discount) price is the sell price
        if r["prices"]:
            rec.sellPriceJpy = r["prices"][0]
        by_number[r["cardNumber"]] = rec

    for r in buy_rows:
        rec = by_number.get(r["cardNumber"])
        if rec is None:
            rec = CardRecord(
                game=r["game"], setCode=r["setCode"], cardId=r["cardId"],
                cardNumber=r["cardNumber"], name=r["name"], rarity=r["rarity"],
                imageUrl=r["imageUrl"], url=r["url"],
            )
            by_number[r["cardNumber"]] = rec

        prices = r["prices"]
        if r["boosted"] and len(prices) >= 2:
            # boosted listings show both the boosted and base buy price
            rec.buyPriceJpy = max(prices[:2])
            rec.buyPriceBaseJpy = min(prices[:2])
            rec.buyPriceBoosted = True
        elif prices:
            rec.buyPriceJpy = prices[0]

    records = list(by_number.values())
    for rec in records:
        if rec.sellPriceJpy is not None and rec.buyPriceJpy is not None:
            rec.spreadJpy = rec.sellPriceJpy - rec.buyPriceJpy
        if mode == "sell":
            rec.buyPriceJpy = rec.buyPriceBaseJpy = None
            rec.buyPriceBoosted = False
        if mode == "buy":
            rec.sellPriceJpy = None

    return records


def update_site_data(records, game: str, set_code: str, mode: str, site_dir: str = "docs"):
    """
    Writes per-set JSON into <site_dir>/data/ and keeps data/manifest.json
    up to date, so the index.html viewer can list available game/set
    combos and load them on demand. Safe to call repeatedly; re-scraping a
    set just overwrites its entry.
    """
    data_dir = os.path.join(site_dir, "data")
    os.makedirs(data_dir, exist_ok=True)

    fname = f"{game}_{set_code}.json"
    fpath = os.path.join(data_dir, fname)
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in records], f, ensure_ascii=False, indent=2)

    manifest_path = os.path.join(data_dir, "manifest.json")
    manifest = []
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            try:
                manifest = json.load(f)
            except json.JSONDecodeError:
                manifest = []

    manifest = [m for m in manifest if not (m["game"] == game and m["set"] == set_code)]
    manifest.append({
        "game": game,
        "set": set_code,
        "file": f"data/{fname}",
        "mode": mode,
        "count": len(records),
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    })
    manifest.sort(key=lambda m: (m["game"], m["set"]))

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"Updated site data -> {fpath} (+ manifest.json, {len(manifest)} set(s) total)")


def write_output(records, out_path: str):
    if not records:
        print("No records scraped — nothing written.")
        return

    if out_path.lower().endswith(".json"):
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump([asdict(r) for r in records], f, ensure_ascii=False, indent=2)
    else:
        fieldnames = list(asdict(records[0]).keys())
        with open(out_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in records:
                writer.writerow(asdict(r))

    print(f"Wrote {len(records)} records -> {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Scrape yuyu-tei.jp sell/buylist prices for a set.")
    parser.add_argument("--game", default=DEFAULT_GAME, help="Game section code, e.g. ws, poc, ygo, opc, dm, ua, vg, digi, bs")
    parser.add_argument("--set", dest="sets", action="append",
                         help="Set code from the set's URL (yuyu-tei.jp/sell/<game>/s/<setCode>). Repeatable.")
    parser.add_argument("--mode", choices=["sell", "buy", "both"], default=DEFAULT_MODE)
    parser.add_argument("--out", default=DEFAULT_OUT, help="Output file (.csv or .json)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Seconds to sleep between requests")
    parser.add_argument("--debug", action="store_true", help="Dump raw HTML of each fetched page to debug_page.html")
    parser.add_argument("--site", action="store_true",
                         help="Also write per-set JSON + manifest.json into docs/data/ for the index.html viewer")
    parser.add_argument("--site-dir", default="docs", help="Folder the GitHub Pages site lives in (default: docs)")
    args = parser.parse_args()

    if not args.sets:
        args.sets = DEFAULT_SETS

    session = requests.Session()
    all_records = []

    for set_code in args.sets:
        try:
            records = scrape_set(session, args.game, set_code, args.mode, args.delay, args.debug)
            all_records.extend(records)
            if args.site:
                update_site_data(records, args.game, set_code, args.mode, args.site_dir)
        except requests.HTTPError as e:
            print(f"[error] HTTP error scraping {set_code}: {e}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"[error] Network error scraping {set_code}: {e}", file=sys.stderr)

    write_output(all_records, args.out)


if __name__ == "__main__":
    main()
