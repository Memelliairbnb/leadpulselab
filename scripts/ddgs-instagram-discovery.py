#!/usr/bin/env python3
"""
DDGS-powered Instagram Discovery — finds credit repair profiles at scale.
Uses duckduckgo-search (ddgs) for free, reliable search results.
Inserts directly into the database and queues for scrub/enrichment.
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
import redis as redis_lib

# ─── Config ───────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway"
REDIS_URL = "redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744"
TENANT_ID = 1

# ─── Search queries ──────────────────────────────────────────────────────────

CITIES = [
    "Houston", "Atlanta", "Dallas", "Miami", "Chicago",
    "Los Angeles", "Phoenix", "Philadelphia", "Charlotte", "Detroit",
    "San Antonio", "Jacksonville", "Indianapolis", "Columbus", "Memphis",
    "Baltimore", "Milwaukee", "Nashville", "Denver", "Las Vegas",
    "New York", "Brooklyn", "Tampa", "Orlando", "Sacramento",
    "St. Louis", "Kansas City", "Cleveland", "Raleigh", "Richmond",
]

KEYWORDS = [
    "credit repair",
    "credit restoration",
    "credit specialist",
    "fix your credit",
    "credit consultant",
    "credit repair expert",
    "credit repair company",
    "credit repair service",
    "credit coaching",
    "credit education",
    "credit sweep",
    "tradeline",
    "debt relief specialist",
]

HASHTAGS = [
    "#creditrepair",
    "#creditrestoration",
    "#fixmycredit",
    "#creditscore",
    "#creditspecialist",
    "#creditcoach",
    "#financialliteracy",
    "#creditrepairservices",
    "#badcredit",
    "#credithelp",
]

# ─── Regex patterns ──────────────────────────────────────────────────────────

IG_URL_RE = re.compile(r"instagram\.com/([a-zA-Z0-9_.]+)/?(?:\?|$|#)")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")
LOCATION_RE = re.compile(r"(?:based in|located in|serving|📍|from)\s+([A-Z][A-Za-z\s]+(?:,\s*[A-Z]{2})?)", re.IGNORECASE)

SKIP_HANDLES = {"p", "reel", "reels", "stories", "explore", "accounts", "about", "legal", "developer", "directory", "tags", "locations", "tv", "ar"}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def extract_handle(url):
    """Extract Instagram handle from URL."""
    match = IG_URL_RE.search(url)
    if match:
        handle = match.group(1).lower()
        if handle not in SKIP_HANDLES and len(handle) > 1:
            return handle
    return None


def extract_from_snippet(title, body):
    """Extract bio info, emails, phones, location from search snippet."""
    text = f"{title} {body}"

    emails = list(set(EMAIL_RE.findall(text)))
    phones = list(set(PHONE_RE.findall(text)))
    locations = [m.strip() for m in LOCATION_RE.findall(text)]

    # Extract display name from title (format: "Name (@handle) ...")
    display_name = None
    name_match = re.match(r"^(.+?)\s*[\(|@]", title)
    if name_match:
        display_name = name_match.group(1).strip()
        if display_name.endswith("|"):
            display_name = display_name[:-1].strip()

    # Detect category
    category = None
    category_keywords = [
        "credit repair", "credit restoration", "credit specialist",
        "financial advisor", "tax preparer", "loan officer",
        "mortgage", "realtor", "real estate", "insurance",
        "business funding", "debt relief",
    ]
    lower_text = text.lower()
    for kw in category_keywords:
        if kw in lower_text:
            category = kw.title()
            break

    # Check if business
    business_indicators = [
        "llc", "inc", "services", "specialist", "expert",
        "company", "consulting", "nationwide", "certified",
        "licensed", "bonded", "dm ", "book ",
    ]
    is_business = any(ind in lower_text for ind in business_indicators)

    return {
        "display_name": display_name,
        "bio_text": body[:500] if body else None,
        "emails": emails,
        "phones": phones,
        "locations": locations,
        "category": category,
        "is_business": is_business,
    }


def text_hash(text):
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()[:64]


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("DDGS Instagram Discovery — Credit Repair Vertical")
    print("=" * 60)

    # Build search queries
    queries = []

    # City-specific searches
    for city in CITIES:
        queries.append({
            "query": f"instagram credit repair {city}",
            "type": "city",
            "label": f"City: {city}",
        })

    # Keyword searches
    for kw in KEYWORDS:
        queries.append({
            "query": f"instagram {kw}",
            "type": "keyword",
            "label": f"Keyword: {kw}",
        })

    # Hashtag searches
    for ht in HASHTAGS:
        queries.append({
            "query": f"instagram {ht}",
            "type": "hashtag",
            "label": f"Hashtag: {ht}",
        })

    print(f"Total queries: {len(queries)}\n")

    # Connect
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    r = redis_lib.from_url(REDIS_URL)

    ddgs = DDGS()

    seen_handles = set()
    total_profiles = 0
    total_queued = 0

    for i, q in enumerate(queries):
        print(f"[{i+1}/{len(queries)}] {q['label']} — {q['query']}")

        # Create discovery run
        cur.execute(
            "INSERT INTO instagram_discovery_runs (tenant_id, search_query, search_type, status, started_at) VALUES (%s, %s, %s, 'running', NOW()) RETURNING id",
            (TENANT_ID, q["query"], q["type"])
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

                # Insert raw profile
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
                        info["display_name"], info["bio_text"], info["category"],
                        None,  # website_url — will be scraped later
                        info["emails"][0] if info["emails"] else None,
                        info["phones"][0] if info["phones"] else None,
                        "; ".join(info["locations"]) if info["locations"] else None,
                        info["is_business"],
                        f"{q['type']}: {q['query']}",
                        json.dumps({
                            "search_title": title,
                            "search_body": body,
                            "all_emails": info["emails"],
                            "all_phones": info["phones"],
                            "all_locations": info["locations"],
                        }),
                        thash,
                    ))

                    row = cur.fetchone()
                    if row:
                        raw_id = row["id"]
                        profiles_in_run += 1
                        total_profiles += 1

                        # Queue for scrub worker
                        job_data = json.dumps({
                            "tenantId": TENANT_ID,
                            "rawProfileId": raw_id,
                            "discoveryRunId": run_id,
                        })
                        job_id = f"ig-scrub-{raw_id}-{int(time.time()*1000)}"

                        # BullMQ job format
                        r.xadd(
                            "bull:instagram_scrub_queue:events",
                            {"event": "added", "jobId": job_id},
                        )

                        # Actually use BullMQ-compatible push
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

                        total_queued += 1

                        emoji = "📧" if info["emails"] else "👤"
                        print(f"  {emoji} {handle} — {info['display_name'] or 'unnamed'} | {info['category'] or 'no category'} | emails={len(info['emails'])} phones={len(info['phones'])}")

                except psycopg2.errors.UniqueViolation:
                    pass  # Already exists
                except Exception as e:
                    print(f"  ⚠ DB error for {handle}: {e}")

            # Update discovery run
            cur.execute(
                "UPDATE instagram_discovery_runs SET status = 'completed', completed_at = NOW(), profiles_found = %s WHERE id = %s",
                (profiles_in_run, run_id)
            )
            print(f"  → {profiles_in_run} new profiles found\n")

        except Exception as e:
            print(f"  ⚠ Search error: {e}")
            cur.execute(
                "UPDATE instagram_discovery_runs SET status = 'failed', completed_at = NOW(), error_message = %s WHERE id = %s",
                (str(e)[:500], run_id)
            )

        # Polite delay between searches (2-4 seconds)
        delay = 2 + (hash(q["query"]) % 20) / 10
        time.sleep(delay)

    print("=" * 60)
    print(f"DISCOVERY COMPLETE")
    print(f"  Total unique profiles found: {total_profiles}")
    print(f"  Total queued for scrub:      {total_queued}")
    print(f"  Total queries executed:       {len(queries)}")
    print("=" * 60)

    cur.close()
    conn.close()
    r.close()


if __name__ == "__main__":
    main()
