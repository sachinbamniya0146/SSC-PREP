#!/usr/bin/env python3
"""v7 §3 — self-sourced PYQ downloader (Hermes auto-fetch, v5 §34).

Fetches official SSC question-paper PDFs for a given exam from public archives
(Career Power free PYQ archive + ssc.gov.in press releases) into
~/Downloads/STUDY/SSC_PYQ_AUTOFETCH/<exam>/ and prints the paths — the files are
then pushed through the v2 ingestion pipeline (admin PDF import → extraction →
review queue) exactly like an admin-supplied PDF.

Usage: python3 scripts/self_source_pyqs.py [exam] [--limit N]
Exams: cgl chsl mts cpo gd je steno selection
"""
import argparse, re, sys, urllib.request, pathlib, time

BASE = pathlib.Path.home() / "Downloads/STUDY/SSC_PYQ_AUTOFETCH"

# Career Power free PYQ archive pages (public). Each page lists PDF links.
SOURCES = {
    "cgl": ["https://www.careerpower.in/ssc-cgl-previous-year-question-papers.html"],
    "chsl": ["https://www.careerpower.in/ssc-chsl-previous-year-question-papers.html"],
    "mts": ["https://www.careerpower.in/ssc-mts-previous-year-question-papers.html"],
    "cpo": ["https://www.careerpower.in/ssc-cpo-previous-year-question-papers.html"],
    "gd": ["https://www.careerpower.in/ssc-gd-constable-previous-year-question-papers.html"],
}
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}

def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def pdf_links(html, base_url):
    out = []
    for m in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, re.I):
        href = m.group(1)
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            href = base_url.split("/")[0] + "//" + base_url.split("/")[2] + href
        out.append(href)
    return list(dict.fromkeys(out))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exam", nargs="?", default="cgl")
    ap.add_argument("--limit", type=int, default=6)
    args = ap.parse_args()
    out_dir = BASE / args.exam.upper()
    out_dir.mkdir(parents=True, exist_ok=True)

    got = 0
    for page in SOURCES.get(args.exam, []):
        try:
            html = fetch(page).decode("utf-8", "ignore")
        except Exception as e:
            print(f"✗ page fetch failed: {page} ({e})")
            continue
        links = pdf_links(html, page)
        print(f"page {page}: {len(links)} pdf links")
        for i, url in enumerate(links):
            if got >= args.limit:
                break
            name = url.split("/")[-1].split("?")[0]
            if not name.lower().endswith(".pdf"):
                name = f"{args.exam}_{i}.pdf"
            dest = out_dir / name
            if dest.exists():
                continue
            try:
                data = fetch(url, timeout=45)
                if data[:4] == b"%PDF":
                    dest.write_bytes(data)
                    got += 1
                    print(f"  ✓ {name} ({len(data)//1024}KB) → {dest}")
                else:
                    print(f"  ✗ {name}: not a PDF ({data[:12]!r})")
            except Exception as e:
                print(f"  ✗ {url}: {e}")
            time.sleep(0.4)
    print(f"\nDONE: {got} papers in {out_dir} — push them via admin PDF Import next.")

if __name__ == "__main__":
    main()