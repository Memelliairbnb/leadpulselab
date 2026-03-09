#!/usr/bin/env python3
"""
Instagram Follower Collector — finds CONSUMERS who engage with credit repair content.

Instead of scraping follower lists (requires auth), we use DDGS to find people who:
- Comment on credit repair posts
- Share testimonials about credit repair
- Talk about their own credit journey
- Mention credit repair accounts

These are CONSUMERS (potential leads), not businesses.
"""

import re
import json
import time
import hashlib
import random
from datetime import datetime

try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

import psycopg2
import psycopg2.extras
import redis as redis_lib

# --- Config -------------------------------------------------------------------

DB_URL = "postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway"
REDIS_URL = "redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744"
TENANT_ID = 1

# --- Business keywords (used to EXCLUDE businesses) ---------------------------

BUSINESS_KEYWORDS = [
    "llc", "inc", "corp", "services", "specialist", "expert", "company",
    "consulting", "nationwide", "certified", "licensed", "bonded",
    "dm for", "dm me", "book now", "book a call", "free consultation",
    "credit repair business", "credit repair company", "credit repair agency",
    "ceo", "founder", "owner", "entrepreneur", "we fix", "we help",
    "our clients", "our team", "established", "years in business",
    "credit repair pro", "dispute specialist", "credit coach",
    "accepting clients", "limited spots", "enroll now", "sign up",
    "link in bio", "linktree", "tap link",
]

# --- Consumer signal keywords (used to INCLUDE consumers) ---------------------

CONSUMER_SIGNALS = [
    "my credit", "my score", "my fico", "i need", "i want", "helped me",
    "fixed my", "thank you", "thanks to", "went up", "going up", "improved",
    "journey", "finally", "approved", "got approved", "was denied",
    "bad credit", "low credit", "credit struggle", "credit stress",
    "paying off", "debt free", "working on my", "rebuilding",
    "700 club", "credit goals", "score update", "before and after",
    "cant get approved", "need help", "looking for", "recommend",
    "review", "testimonial", "shoutout", "real results",
]

# --- Search queries targeting CONSUMERS ---------------------------------------

CITIES = [
    "Houston", "Atlanta", "Dallas", "Miami", "Chicago",
    "Los Angeles", "Phoenix", "Philadelphia", "Charlotte", "Detroit",
    "San Antonio", "Jacksonville", "Memphis", "Baltimore", "Nashville",
    "Denver", "Las Vegas", "Tampa", "Orlando", "Sacramento",
]

def build_queries():
    """Generate search queries targeting credit repair CONSUMERS on Instagram.

    Key insight: DDGS works better WITHOUT site: restrictions.
    Search for Instagram + consumer intent phrases — DDGS returns pages
    that reference Instagram profiles we can extract.
    """
    queries = []

    # Broad Instagram consumer queries (these actually return results)
    core = [
        'instagram "fixed my credit"',
        'instagram "credit repair helped me"',
        'instagram "credit journey"',
        'instagram "rebuilding my credit"',
        'instagram "credit score went up"',
        'instagram "bad credit" need help',
        'instagram "credit repair review"',
        'instagram "credit repair testimony"',
        'instagram "credit repair results" before after',
        'instagram "got approved" credit',
        'instagram "debt free" credit journey',
        'instagram "700 club" credit score',
        'instagram "credit repair changed my life"',
        'instagram "credit score update"',
        'instagram "paying off debt" credit',
        'instagram "credit dispute" worked',
        'instagram "my credit went from"',
        'instagram "credit repair is real"',
        'instagram "credit repair" recommend',
        'instagram "need credit repair"',
        'instagram #creditjourney',
        'instagram #debtfreejourney',
        'instagram #creditscoregoals',
        'instagram #rebuildingcredit',
        'instagram #badcredit help',
        'instagram #fixmycredit testimony',
        'instagram #creditrepairworks',
        'instagram #creditscoretransformation',
    ]
    for q in core:
        queries.append({"query": q, "type": "consumer_core", "label": f"Core: {q[:60]}"})

    # City + consumer intent (broader format that works with DDGS)
    selected_cities = random.sample(CITIES, min(10, len(CITIES)))
    for city in selected_cities:
        queries.append({
            "query": f'instagram credit repair {city} review OR testimony OR helped',
            "type": "city_consumer",
            "label": f"City consumer: {city}",
        })

    # Engagement / forum crossover (people asking about credit repair on IG)
    engagement = [
        'instagram "looking for credit repair"',
        'instagram "anyone know" credit repair',
        'instagram "struggling with credit"',
        'instagram "need help with credit"',
        'instagram "credit repair near me"',
        'instagram "who fixed your credit"',
        'instagram "credit repair" "real results"',
        'instagram "can anyone recommend" credit',
    ]
    for q in engagement:
        queries.append({"query": q, "type": "engagement", "label": f"Engagement: {q[:60]}"})

    return queries


# --- Regex patterns -----------------------------------------------------------

IG_URL_RE = re.compile(r"instagram\.com/([a-zA-Z0-9_.]+)/?(?:\?|$|#|\"|\s)")
IG_HANDLE_RE = re.compile(r"@([a-zA-Z0-9_.]{2,30})")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")

SKIP_HANDLES = {
    "p", "reel", "reels", "stories", "explore", "accounts", "about",
    "legal", "developer", "directory", "tags", "locations", "tv", "ar",
    "instagram", "meta", "help", "privacy", "terms",
}


# --- Helpers ------------------------------------------------------------------

def extract_handle(url):
    """Extract Instagram handle from URL."""
    match = IG_URL_RE.search(url)
    if match:
        handle = match.group(1).lower().rstrip(".")
        if handle not in SKIP_HANDLES and len(handle) > 1:
            return handle
    return None


def extract_handles_from_text(text):
    """Extract @handles from snippet text."""
    handles = set()
    for match in IG_HANDLE_RE.finditer(text):
        h = match.group(1).lower().rstrip(".")
        if h not in SKIP_HANDLES and len(h) > 1:
            handles.add(h)
    return handles


def classify_consumer_vs_business(title, body):
    """
    Score whether this is a CONSUMER (lead) or a BUSINESS (not a lead).
    Returns (is_consumer, consumer_score, reason).
    consumer_score: 0-100, higher = more likely consumer.
    """
    text = f"{title} {body}".lower()

    business_hits = sum(1 for kw in BUSINESS_KEYWORDS if kw in text)
    consumer_hits = sum(1 for sig in CONSUMER_SIGNALS if sig in text)

    # Strong business signals
    if business_hits >= 3:
        return False, max(0, 20 - business_hits * 5), f"business ({business_hits} biz keywords)"

    # Strong consumer signals
    if consumer_hits >= 2 and business_hits == 0:
        return True, min(95, 60 + consumer_hits * 10), f"consumer ({consumer_hits} consumer signals)"

    # Mixed signals — lean consumer if more consumer hits
    if consumer_hits > business_hits:
        score = 50 + (consumer_hits - business_hits) * 10
        return True, min(85, score), f"likely consumer ({consumer_hits}c vs {business_hits}b)"

    # Ambiguous — still possibly a consumer if no strong business signal
    if business_hits <= 1 and consumer_hits >= 1:
        return True, 45, f"possible consumer ({consumer_hits}c, {business_hits}b)"

    # Default: not enough signal, but if it's from a consumer query, give benefit of doubt
    if business_hits == 0:
        return True, 35, "no business signals, weak consumer"

    return False, max(0, 25 - business_hits * 5), f"likely business ({business_hits} biz keywords)"


def extract_profile_info(title, body):
    """Extract display name, bio, emails, phones from search snippet."""
    text = f"{title} {body}"

    emails = list(set(EMAIL_RE.findall(text)))
    phones = list(set(PHONE_RE.findall(text)))

    # Display name from title
    display_name = None
    name_match = re.match(r"^(.+?)\s*[\(|@]", title)
    if name_match:
        display_name = name_match.group(1).strip()
        if display_name.endswith("|"):
            display_name = display_name[:-1].strip()
        # Clean up common suffixes
        for suffix in [" - Instagram", " on Instagram", " Instagram"]:
            if display_name.endswith(suffix):
                display_name = display_name[:-len(suffix)].strip()

    return {
        "display_name": display_name,
        "bio_text": body[:500] if body else None,
        "emails": emails,
        "phones": phones,
    }


def text_hash(text):
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()[:64]


# --- Database setup -----------------------------------------------------------

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS instagram_target_accounts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    handle VARCHAR(255) NOT NULL,
    display_name VARCHAR(500),
    category VARCHAR(255),
    follower_count INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, handle)
);

CREATE TABLE IF NOT EXISTS instagram_collected_followers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    target_account_id INTEGER REFERENCES instagram_target_accounts(id),
    handle VARCHAR(255) NOT NULL,
    display_name VARCHAR(500),
    bio_text TEXT,
    profile_url VARCHAR(1000),
    public_email VARCHAR(500),
    public_phone VARCHAR(100),
    is_consumer BOOLEAN DEFAULT true,
    consumer_score INTEGER DEFAULT 0,
    classification_reason TEXT,
    discovery_query TEXT,
    discovery_type VARCHAR(100),
    collection_run_id INTEGER REFERENCES instagram_collection_runs(id),
    processing_status VARCHAR(50) DEFAULT 'pending',
    text_hash VARCHAR(64),
    raw_metadata_json JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, handle)
);

CREATE TABLE IF NOT EXISTS instagram_collection_runs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    search_query TEXT,
    search_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    profiles_found INTEGER DEFAULT 0,
    consumers_found INTEGER DEFAULT 0,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT
);
"""

# Need to create collection_runs first since followers references it
CREATE_TABLES_ORDERED = [
    """
    CREATE TABLE IF NOT EXISTS instagram_target_accounts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        handle VARCHAR(255) NOT NULL,
        display_name VARCHAR(500),
        category VARCHAR(255),
        follower_count INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, handle)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS instagram_collection_runs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        search_query TEXT,
        search_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        profiles_found INTEGER DEFAULT 0,
        consumers_found INTEGER DEFAULT 0,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        error_message TEXT
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS instagram_collected_followers (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        target_account_id INTEGER REFERENCES instagram_target_accounts(id),
        handle VARCHAR(255) NOT NULL,
        display_name VARCHAR(500),
        bio_text TEXT,
        profile_url VARCHAR(1000),
        public_email VARCHAR(500),
        public_phone VARCHAR(100),
        is_consumer BOOLEAN DEFAULT true,
        consumer_score INTEGER DEFAULT 0,
        classification_reason TEXT,
        discovery_query TEXT,
        discovery_type VARCHAR(100),
        collection_run_id INTEGER REFERENCES instagram_collection_runs(id),
        processing_status VARCHAR(50) DEFAULT 'pending',
        text_hash VARCHAR(64),
        raw_metadata_json JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, handle)
    );
    """,
]


# --- Main ---------------------------------------------------------------------

def main():
    print("=" * 65, flush=True)
    print("  Instagram Follower Collector — Credit Repair CONSUMERS", flush=True)
    print("  Strategy: Find people who ENGAGE with credit repair content", flush=True)
    print("=" * 65, flush=True)
    print(flush=True)

    # Connect to database
    print("[DB] Connecting to PostgreSQL...", flush=True)
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Create tables
    print("[DB] Ensuring tables exist...", flush=True)
    for sql in CREATE_TABLES_ORDERED:
        cur.execute(sql)
    print("[DB] Tables ready.", flush=True)

    # Connect to Redis
    print("[Redis] Connecting...", flush=True)
    r = redis_lib.from_url(REDIS_URL)
    r.ping()
    print("[Redis] Connected.", flush=True)
    print(flush=True)

    # Build queries
    queries = build_queries()
    print(f"[Search] Generated {len(queries)} search queries targeting consumers", flush=True)
    print(flush=True)

    # Initialize DDGS
    ddgs = DDGS()

    # Tracking
    seen_handles = set()
    total_found = 0
    total_consumers = 0
    total_businesses_skipped = 0
    total_dupes = 0
    total_queued = 0

    for i, q in enumerate(queries):
        print(f"[{i+1}/{len(queries)}] {q['label']}", flush=True)

        # Create collection run (match actual DB schema: followers_collected, not consumers_found)
        cur.execute(
            "INSERT INTO instagram_collection_runs (tenant_id, search_query, search_type, status, started_at, followers_collected) "
            "VALUES (%s, %s, %s, 'running', NOW(), 0) RETURNING id",
            (TENANT_ID, q["query"], q["type"])
        )
        run_id = cur.fetchone()["id"]

        profiles_in_run = 0
        consumers_in_run = 0

        try:
            results = ddgs.text(q["query"], max_results=20)

            for result in results:
                url = result.get("href", "")
                title = result.get("title", "")
                body = result.get("body", "")

                # Extract handle from URL
                handle = extract_handle(url)

                # Also look for @handles in the text
                extra_handles = extract_handles_from_text(f"{title} {body}")

                # Combine: URL handle first, then text handles
                all_handles = []
                if handle:
                    all_handles.append(handle)
                all_handles.extend(sorted(extra_handles - {handle} if handle else extra_handles))

                for h in all_handles:
                    if h in seen_handles:
                        total_dupes += 1
                        continue
                    seen_handles.add(h)

                    total_found += 1

                    # Classify consumer vs business
                    is_consumer, consumer_score, reason = classify_consumer_vs_business(title, body)

                    if not is_consumer:
                        total_businesses_skipped += 1
                        print(f"    SKIP (business) @{h} — {reason}", flush=True)
                        continue

                    # Extract profile info
                    info = extract_profile_info(title, body)

                    # Insert into instagram_collected_followers
                    thash = text_hash(h)
                    try:
                        cur.execute("""
                            INSERT INTO instagram_collected_followers (
                                tenant_id, target_account_id, handle, display_name,
                                bio_text, profile_url, public_email, public_phone,
                                is_consumer, consumer_score, classification_reason,
                                discovery_query, discovery_type, collection_run_id,
                                processing_status, text_hash, raw_metadata_json
                            ) VALUES (
                                %s, NULL, %s, %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s, %s,
                                'pending', %s, %s
                            )
                            ON CONFLICT (tenant_id, handle) DO NOTHING
                            RETURNING id
                        """, (
                            TENANT_ID,
                            h,
                            info["display_name"],
                            info["bio_text"],
                            f"https://www.instagram.com/{h}/",
                            info["emails"][0] if info["emails"] else None,
                            info["phones"][0] if info["phones"] else None,
                            True,
                            consumer_score,
                            reason,
                            q["query"][:500],
                            q["type"],
                            run_id,
                            thash,
                            json.dumps({
                                "search_title": title,
                                "search_body": body,
                                "search_url": url,
                                "all_emails": info["emails"],
                                "all_phones": info["phones"],
                                "consumer_score": consumer_score,
                                "classification": reason,
                            }),
                        ))

                        row = cur.fetchone()
                        if row:
                            follower_id = row["id"]
                            profiles_in_run += 1
                            consumers_in_run += 1
                            total_consumers += 1

                            # Queue for scrub if score is good (>= 40)
                            if consumer_score >= 40:
                                job_data = json.dumps({
                                    "tenantId": TENANT_ID,
                                    "followerId": follower_id,
                                    "collectionRunId": run_id,
                                    "handle": h,
                                    "source": "instagram_follower_collection",
                                })
                                job_id = f"ig-follower-scrub-{follower_id}-{int(time.time()*1000)}"

                                r.rpush("bull:instagram_scrub_queue:wait", job_id)
                                r.hset(f"bull:instagram_scrub_queue:{job_id}", mapping={
                                    "name": "scrub",
                                    "data": job_data,
                                    "opts": json.dumps({
                                        "jobId": job_id,
                                        "attempts": 3,
                                        "backoff": {"type": "exponential", "delay": 5000},
                                    }),
                                    "timestamp": str(int(time.time() * 1000)),
                                    "delay": "0",
                                    "priority": "0",
                                    "processedOn": "0",
                                    "progress": "0",
                                })
                                total_queued += 1

                            email_tag = " [EMAIL]" if info["emails"] else ""
                            phone_tag = " [PHONE]" if info["phones"] else ""
                            print(f"    + @{h} (score:{consumer_score}) {info['display_name'] or 'unnamed'} — {reason}{email_tag}{phone_tag}", flush=True)

                        else:
                            total_dupes += 1

                    except psycopg2.errors.UniqueViolation:
                        conn.rollback()
                        conn.autocommit = True
                        total_dupes += 1
                    except Exception as e:
                        print(f"    DB error for @{h}: {e}", flush=True)

            # Update collection run (use followers_collected to match actual schema)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'completed', completed_at = NOW(), "
                "followers_collected = %s WHERE id = %s",
                (consumers_in_run, run_id)
            )
            print(f"  => {consumers_in_run} consumers found ({profiles_in_run} profiles total)", flush=True)

        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = %s WHERE id = %s",
                (str(e)[:500], run_id)
            )

        # Print running totals every 10 queries
        if (i + 1) % 10 == 0:
            print(flush=True)
            print(f"  --- Running totals after {i+1} queries ---", flush=True)
            print(f"  Consumers collected: {total_consumers}", flush=True)
            print(f"  Businesses skipped:  {total_businesses_skipped}", flush=True)
            print(f"  Duplicates:          {total_dupes}", flush=True)
            print(f"  Queued for scrub:    {total_queued}", flush=True)
            print(flush=True)

        # Polite delay between searches (2-3 seconds)
        delay = 2 + random.random()
        time.sleep(delay)

    # Final summary
    print(flush=True)
    print("=" * 65, flush=True)
    print("  COLLECTION COMPLETE", flush=True)
    print("=" * 65, flush=True)
    print(f"  Total queries executed:       {len(queries)}", flush=True)
    print(f"  Total profiles found:         {total_found}", flush=True)
    print(f"  Consumers collected (leads):  {total_consumers}", flush=True)
    print(f"  Businesses skipped:           {total_businesses_skipped}", flush=True)
    print(f"  Duplicates skipped:           {total_dupes}", flush=True)
    print(f"  Queued for scrub:             {total_queued}", flush=True)
    print("=" * 65, flush=True)

    # Show score distribution
    cur.execute("""
        SELECT
            CASE
                WHEN consumer_score >= 80 THEN 'high (80+)'
                WHEN consumer_score >= 50 THEN 'medium (50-79)'
                WHEN consumer_score >= 30 THEN 'low (30-49)'
                ELSE 'very low (<30)'
            END as tier,
            COUNT(*) as count
        FROM instagram_collected_followers
        WHERE tenant_id = %s AND is_consumer = true
        GROUP BY tier
        ORDER BY tier
    """, (TENANT_ID,))
    rows = cur.fetchall()
    if rows:
        print(flush=True)
        print("  Consumer score distribution:", flush=True)
        for row in rows:
            print(f"    {row['tier']}: {row['count']}", flush=True)

    cur.close()
    conn.close()
    r.close()

    print(flush=True)
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
