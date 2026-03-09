#!/usr/bin/env python3
"""
DDGS Multi-Niche Discovery — finds business profiles across multiple verticals.
Expands beyond credit repair to: business credit, funding, tradelines, business setup.

Each profile gets tagged with discovery_keyword so we know what they DO
(and therefore what we CAN'T market to them — they already do it).
"""

import re
import json
import time
import hashlib
import sys
from datetime import datetime

try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

import psycopg2
import psycopg2.extras

# ─── Config ───────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway"
TENANT_ID = 1

# ─── Niches & Keywords ───────────────────────────────────────────────────────

NICHES = {
    "business_credit": {
        "keywords": [
            "business credit", "business credit builder", "business credit specialist",
            "business credit repair", "business credit coach", "EIN credit",
            "corporate credit", "business credit score", "net 30 accounts",
            "business credit funding",
        ],
        "hashtags": [
            "#businesscredit", "#businesscreditbuilder", "#businesscreditrepair",
            "#EINcredit", "#corporatecredit", "#net30",
        ],
        "marketable_products": ["personal_tradelines", "credit_repair", "funding", "business_setup"],
        "excluded_products": ["business_credit", "business_tradelines"],
    },
    "funding": {
        "keywords": [
            "business funding", "small business loans", "SBA loans",
            "business funding specialist", "startup funding", "revenue based financing",
            "merchant cash advance", "business line of credit", "equipment financing",
            "working capital",
        ],
        "hashtags": [
            "#businessfunding", "#smallbusinessloans", "#SBAloans",
            "#startupfunding", "#businessloans", "#workingcapital",
        ],
        "marketable_products": ["tradelines", "credit_repair", "business_credit", "business_setup"],
        "excluded_products": ["funding"],
    },
    "tradelines": {
        "keywords": [
            "tradeline", "authorized user tradeline", "primary tradeline",
            "tradeline company", "buy tradelines", "tradeline boost",
            "seasoned tradeline", "tradeline supplier",
        ],
        "hashtags": [
            "#tradelines", "#authorizeduser", "#tradelineboost",
            "#seasonedtradelines", "#primarytradelines",
        ],
        "marketable_products": ["credit_repair", "funding", "business_credit", "business_setup"],
        "excluded_products": ["tradelines"],
    },
    "business_setup": {
        "keywords": [
            "LLC formation", "business formation", "registered agent",
            "business setup specialist", "incorporate your business",
            "EIN registration", "business structure", "start your business",
        ],
        "hashtags": [
            "#LLCformation", "#businessformation", "#startabusiness",
            "#businesssetup", "#incorporatenow",
        ],
        "marketable_products": ["tradelines", "credit_repair", "funding", "business_credit"],
        "excluded_products": ["business_setup"],
    },
    "credit_repair": {
        "keywords": [
            "credit repair", "credit restoration", "credit specialist",
            "fix your credit", "credit consultant", "credit repair expert",
            "credit coaching", "credit education", "credit sweep",
            "debt relief specialist",
        ],
        "hashtags": [
            "#creditrepair", "#creditrestoration", "#fixmycredit",
            "#creditscore", "#creditspecialist", "#creditcoach",
        ],
        "marketable_products": ["tradelines", "funding", "business_credit", "business_setup"],
        "excluded_products": ["credit_repair"],
    },
}

CITIES = [
    "Houston", "Atlanta", "Dallas", "Miami", "Chicago",
    "Los Angeles", "Phoenix", "Philadelphia", "Charlotte", "Detroit",
    "San Antonio", "Jacksonville", "Indianapolis", "Columbus", "Memphis",
    "Baltimore", "Milwaukee", "Nashville", "Denver", "Las Vegas",
    "New York", "Brooklyn", "Tampa", "Orlando", "Sacramento",
]

# ─── Regex ────────────────────────────────────────────────────────────────────

IG_URL_RE = re.compile(r"instagram\.com/([a-zA-Z0-9_.]+)/?(?:\?|$|#)")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")

SKIP_HANDLES = {"p", "reel", "reels", "stories", "explore", "accounts", "about",
                "legal", "developer", "directory", "tags", "locations", "tv", "ar"}


def extract_handle(url):
    match = IG_URL_RE.search(url)
    if match:
        handle = match.group(1).lower()
        if handle not in SKIP_HANDLES and len(handle) > 1:
            return handle
    return None


def extract_from_snippet(title, body):
    text = f"{title} {body}"
    emails = list(set(EMAIL_RE.findall(text)))
    phones = list(set(PHONE_RE.findall(text)))

    display_name = None
    name_match = re.match(r"^(.+?)\s*[\(|@]", title)
    if name_match:
        display_name = name_match.group(1).strip()
        if display_name.endswith("|"):
            display_name = display_name[:-1].strip()

    lower_text = text.lower()
    business_indicators = ["llc", "inc", "services", "specialist", "expert",
                          "company", "consulting", "certified", "licensed"]
    is_business = any(ind in lower_text for ind in business_indicators)

    return {
        "display_name": display_name,
        "bio_text": body[:500] if body else None,
        "emails": emails,
        "phones": phones,
        "is_business": is_business,
    }


def text_hash(text):
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()[:64]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    # Allow selecting specific niches via command line
    selected_niches = sys.argv[1:] if len(sys.argv) > 1 else list(NICHES.keys())

    # Skip credit_repair if not explicitly requested (we already have 170 profiles)
    if "credit_repair" in selected_niches and len(sys.argv) <= 1:
        selected_niches.remove("credit_repair")

    print("=" * 65, flush=True)
    print("  DDGS Multi-Niche Discovery", flush=True)
    print(f"  Niches: {', '.join(selected_niches)}", flush=True)
    print("=" * 65, flush=True)

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    ddgs = DDGS()
    seen_handles = set()
    total_profiles = 0
    niche_counts = {}

    for niche_name in selected_niches:
        niche = NICHES[niche_name]
        niche_counts[niche_name] = 0

        print(f"\n{'─' * 60}", flush=True)
        print(f"  NICHE: {niche_name}", flush=True)
        print(f"  Marketable: {', '.join(niche['marketable_products'])}", flush=True)
        print(f"  Excluded: {', '.join(niche['excluded_products'])}", flush=True)
        print(f"{'─' * 60}", flush=True)

        # Build queries for this niche
        queries = []

        # Keyword + instagram searches
        for kw in niche["keywords"]:
            queries.append({
                "query": f"instagram {kw}",
                "type": "keyword",
                "label": f"Keyword: {kw}",
            })

        # City-specific (top 10 cities only per niche)
        for city in CITIES[:10]:
            queries.append({
                "query": f"instagram {niche['keywords'][0]} {city}",
                "type": "city",
                "label": f"City: {city}",
            })

        # Hashtag searches
        for ht in niche["hashtags"]:
            queries.append({
                "query": f"instagram {ht}",
                "type": "hashtag",
                "label": f"Hashtag: {ht}",
            })

        print(f"  Queries: {len(queries)}", flush=True)

        for i, q in enumerate(queries):
            print(f"  [{i+1}/{len(queries)}] {q['label']}", flush=True)

            # Create discovery run
            cur.execute(
                "INSERT INTO instagram_discovery_runs (tenant_id, search_query, search_type, status, started_at) "
                "VALUES (%s, %s, %s, 'running', NOW()) RETURNING id",
                (TENANT_ID, q["query"], f"niche:{niche_name}:{q['type']}")
            )
            run_id = cur.fetchone()["id"]

            try:
                results = ddgs.text(q["query"], max_results=20)
                profiles_in_run = 0

                for result in results:
                    url = result.get("href", "")
                    title = result.get("title", "")
                    body = result.get("body", "")

                    handle = extract_handle(url)
                    if not handle or handle in seen_handles:
                        continue
                    seen_handles.add(handle)

                    info = extract_from_snippet(title, body)
                    thash = text_hash(handle)

                    try:
                        cur.execute("""
                            INSERT INTO raw_instagram_profiles (
                                tenant_id, discovery_run_id, instagram_handle, profile_url,
                                display_name, bio_text, category, website_url,
                                public_email_candidate, public_phone_candidate,
                                location_clues, is_business, is_private,
                                discovery_reason, raw_metadata_json, processing_status, text_hash
                            ) VALUES (
                                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s, %s, 'pending', %s
                            )
                            ON CONFLICT (tenant_id, instagram_handle) DO NOTHING
                            RETURNING id
                        """, (
                            TENANT_ID, run_id, handle,
                            f"https://www.instagram.com/{handle}/",
                            info["display_name"], info["bio_text"], niche_name,
                            None,
                            info["emails"][0] if info["emails"] else None,
                            info["phones"][0] if info["phones"] else None,
                            None,
                            info["is_business"],
                            f"niche:{niche_name} | {q['type']}: {q['query']}",
                            json.dumps({
                                "search_title": title,
                                "search_body": body,
                                "niche": niche_name,
                                "marketable_products": niche["marketable_products"],
                                "excluded_products": niche["excluded_products"],
                                "all_emails": info["emails"],
                                "all_phones": info["phones"],
                            }),
                            thash,
                        ))

                        row = cur.fetchone()
                        if row:
                            profiles_in_run += 1
                            total_profiles += 1
                            niche_counts[niche_name] += 1

                            # Queue for scrub
                            raw_id = row["id"]
                            import redis as redis_lib
                            r = redis_lib.from_url("redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744")
                            job_data = json.dumps({
                                "tenantId": TENANT_ID,
                                "rawProfileId": raw_id,
                                "discoveryRunId": run_id,
                            })
                            job_id = f"ig-scrub-{raw_id}-{int(time.time()*1000)}"
                            r.rpush("bull:instagram_scrub_queue:wait", job_id)
                            r.hset(f"bull:instagram_scrub_queue:{job_id}", mapping={
                                "name": "scrub",
                                "data": job_data,
                                "opts": json.dumps({"jobId": job_id, "attempts": 3, "backoff": {"type": "exponential", "delay": 5000}}),
                                "timestamp": str(int(time.time() * 1000)),
                                "delay": "0",
                                "priority": "0",
                                "processedOn": "0",
                                "progress": "0",
                            })
                            r.close()

                            emoji = "📧" if info["emails"] else "👤"
                            print(f"    {emoji} @{handle} [{niche_name}] {info['display_name'] or 'unnamed'}", flush=True)

                    except psycopg2.errors.UniqueViolation:
                        pass
                    except Exception as e:
                        print(f"    DB error for @{handle}: {e}", flush=True)

                cur.execute(
                    "UPDATE instagram_discovery_runs SET status = 'completed', completed_at = NOW(), profiles_found = %s WHERE id = %s",
                    (profiles_in_run, run_id)
                )
                if profiles_in_run > 0:
                    print(f"    → {profiles_in_run} new profiles", flush=True)

            except Exception as e:
                print(f"    Search error: {e}", flush=True)
                cur.execute(
                    "UPDATE instagram_discovery_runs SET status = 'failed', completed_at = NOW(), error_message = %s WHERE id = %s",
                    (str(e)[:500], run_id)
                )

            # Polite delay
            delay = 2 + (hash(q["query"]) % 20) / 10
            time.sleep(delay)

    # Summary
    print(flush=True)
    print("=" * 65, flush=True)
    print("  MULTI-NICHE DISCOVERY COMPLETE", flush=True)
    print("=" * 65, flush=True)
    print(f"  Total new profiles: {total_profiles}", flush=True)
    for niche, count in niche_counts.items():
        print(f"    {niche}: {count}", flush=True)
    print("=" * 65, flush=True)

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
