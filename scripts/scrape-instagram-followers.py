#!/usr/bin/env python3
"""
Instagram Follower Scraper — scrapes follower lists from discovered credit repair accounts.

Uses Instaloader (free, open source) with a logged-in session to access follower lists.
Followers of credit repair businesses = potential consumers who need credit repair = LEADS.

Usage:
    python3 scripts/scrape-instagram-followers.py <ig_username> <ig_password>

Strategy:
    1. Load our discovered credit repair accounts from DB (sorted by follower count)
    2. For each account, scrape their followers
    3. Classify each follower as consumer vs business
    4. Insert consumers into instagram_collected_followers
    5. Go slow and polite (2-5s delays) to avoid rate limits
"""

import sys
import re
import json
import time
import hashlib
import random
from datetime import datetime

import instaloader
import psycopg2
import psycopg2.extras

# ─── Config ───────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway"
TENANT_ID = 1

# Rate limits — be very conservative
DELAY_BETWEEN_PROFILES = 3      # seconds between loading each follower profile
DELAY_BETWEEN_ACCOUNTS = 30     # seconds between target accounts
MAX_FOLLOWERS_PER_ACCOUNT = 500 # don't try to scrape all 304K, get a sample
MAX_ACCOUNTS_PER_RUN = 10       # limit accounts per session to avoid bans
BATCH_PAUSE_EVERY = 50          # pause longer every N followers
BATCH_PAUSE_SECONDS = 30        # longer pause duration

# ─── Business detection (to filter OUT businesses, keep consumers) ────────────

BUSINESS_KEYWORDS = [
    "llc", "inc", "corp", "services", "specialist", "expert", "company",
    "consulting", "certified", "licensed", "credit repair", "credit restoration",
    "credit fix", "we fix", "we help", "our clients", "book now", "dm for",
    "free consultation", "link in bio", "linktree", "ceo", "founder",
    "entrepreneur", "accepting clients", "enroll now", "tradeline",
    "business funding", "loan officer", "mortgage", "realtor",
]

CONSUMER_SIGNALS = [
    "mom", "dad", "wife", "husband", "student", "nurse", "teacher",
    "just living", "personal", "music", "photography", "fitness",
    "fashion", "food", "travel", "family", "blessed", "god",
    "love", "life", "dog", "cat", "sports", "gamer",
]


def is_likely_consumer(bio, full_name, is_business_account):
    """Classify whether a profile is a consumer (potential lead) or business."""
    if is_business_account:
        return False, "instagram_business_flag"

    text = f"{bio or ''} {full_name or ''}".lower()

    biz_hits = sum(1 for kw in BUSINESS_KEYWORDS if kw in text)
    consumer_hits = sum(1 for kw in CONSUMER_SIGNALS if kw in text)

    if biz_hits >= 2:
        return False, f"business ({biz_hits} keywords)"

    if consumer_hits > 0 or biz_hits == 0:
        return True, f"consumer (biz={biz_hits}, consumer={consumer_hits})"

    return False, f"unclear (biz={biz_hits})"


def text_hash(text):
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()[:64]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scrape-instagram-followers.py <ig_username> <ig_password>")
        sys.exit(1)

    ig_user = sys.argv[1]
    ig_pass = sys.argv[2]

    print("=" * 65, flush=True)
    print("  Instagram Follower Scraper — Credit Repair Consumer Discovery", flush=True)
    print("=" * 65, flush=True)

    # ─── Step 1: Login to Instagram ──────────────────────────────────────────
    print(f"\n[IG] Logging in as @{ig_user}...", flush=True)
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
    )

    try:
        L.login(ig_user, ig_pass)
        print("[IG] Login successful!", flush=True)
    except instaloader.exceptions.BadCredentialsException:
        print("[IG] ERROR: Bad credentials. Check username/password.", flush=True)
        sys.exit(1)
    except instaloader.exceptions.TwoFactorAuthRequiredException:
        print("[IG] ERROR: 2FA is enabled. Disable it or use an account without 2FA.", flush=True)
        sys.exit(1)
    except Exception as e:
        print(f"[IG] ERROR: Login failed: {e}", flush=True)
        sys.exit(1)

    # ─── Step 2: Connect to database ─────────────────────────────────────────
    print("[DB] Connecting...", flush=True)
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    print("[DB] Connected.", flush=True)

    # ─── Step 3: Load target accounts (our discovered credit repair profiles) ─
    # Get profiles sorted by likely follower count (parsed from bio)
    cur.execute("""
        SELECT DISTINCT ON (instagram_handle)
            instagram_handle, display_name, bio_text, category
        FROM raw_instagram_profiles
        WHERE tenant_id = %s AND processing_status = 'completed'
        ORDER BY instagram_handle, id
    """, (TENANT_ID,))
    all_profiles = cur.fetchall()

    # Parse follower counts from bio text and sort descending
    def parse_follower_count(bio):
        if not bio:
            return 0
        match = re.search(r"([\d,]+(?:\.\d+)?)\s*([KkMm])?\s*[Ff]ollowers", bio)
        if not match:
            return 0
        num_str = match.group(1).replace(",", "")
        num = float(num_str)
        suffix = match.group(2)
        if suffix and suffix.upper() == "K":
            num *= 1000
        elif suffix and suffix.upper() == "M":
            num *= 1000000
        return int(num)

    profiles_with_counts = [
        (p, parse_follower_count(p["bio_text"]))
        for p in all_profiles
    ]
    profiles_with_counts.sort(key=lambda x: x[1], reverse=True)

    # Filter to accounts with meaningful follower counts (at least 100)
    target_accounts = [
        (p, count) for p, count in profiles_with_counts
        if count >= 100
    ][:MAX_ACCOUNTS_PER_RUN]

    print(f"\n[Target] {len(target_accounts)} accounts to scrape (top by follower count):", flush=True)
    for p, count in target_accounts:
        print(f"  @{p['instagram_handle']} — {count:,} followers", flush=True)
    print(flush=True)

    # ─── Step 4: Scrape followers ────────────────────────────────────────────
    total_scraped = 0
    total_consumers = 0
    total_businesses_skipped = 0
    total_private_skipped = 0
    total_dupes = 0

    for acct_idx, (target, follower_count) in enumerate(target_accounts):
        handle = target["instagram_handle"]
        print(f"\n[{acct_idx+1}/{len(target_accounts)}] Scraping followers of @{handle} ({follower_count:,} followers)...", flush=True)

        # Create a collection run record
        cur.execute(
            "INSERT INTO instagram_collection_runs (tenant_id, target_account_id, search_query, search_type, status, started_at, followers_collected) "
            "VALUES (%s, NULL, %s, %s, 'running', NOW(), 0) RETURNING id",
            (TENANT_ID, f"followers_of:@{handle}", "follower_scrape")
        )
        run_id = cur.fetchone()["id"]

        # Also upsert target account
        cur.execute("""
            INSERT INTO instagram_target_accounts (tenant_id, handle, display_name, category, follower_count, is_active)
            VALUES (%s, %s, %s, %s, %s, true)
            ON CONFLICT (tenant_id, handle) DO UPDATE SET follower_count = EXCLUDED.follower_count, updated_at = NOW()
            RETURNING id
        """, (TENANT_ID, handle, target["display_name"], target["category"], follower_count))
        target_account_id = cur.fetchone()["id"]

        consumers_in_run = 0
        scraped_in_run = 0

        try:
            profile = instaloader.Profile.from_username(L.context, handle)

            if profile.is_private:
                print(f"  SKIP: @{handle} is private", flush=True)
                cur.execute(
                    "UPDATE instagram_collection_runs SET status = 'skipped', completed_at = NOW(), "
                    "error_message = 'Private account' WHERE id = %s", (run_id,)
                )
                continue

            # Update with real follower count
            real_count = profile.followers
            cur.execute(
                "UPDATE instagram_target_accounts SET follower_count = %s, updated_at = NOW() WHERE id = %s",
                (real_count, target_account_id)
            )
            print(f"  Actual followers: {real_count:,}", flush=True)

            # Iterate followers (Instaloader handles pagination)
            follower_iter = profile.get_followers()
            count = 0

            for follower in follower_iter:
                if count >= MAX_FOLLOWERS_PER_ACCOUNT:
                    print(f"  Reached max {MAX_FOLLOWERS_PER_ACCOUNT} followers, moving to next account", flush=True)
                    break

                count += 1
                scraped_in_run += 1
                total_scraped += 1

                # Get basic info (available without loading full profile)
                f_handle = follower.username.lower()
                f_name = follower.full_name or ""
                f_bio = ""
                f_is_business = False

                # Try to get bio (may require extra request)
                try:
                    f_bio = follower.biography or ""
                    f_is_business = follower.is_business_account
                except Exception:
                    pass  # Rate limited or private — skip bio

                # Skip private accounts (can't see their activity anyway)
                if follower.is_private:
                    total_private_skipped += 1
                    continue

                # Classify consumer vs business
                is_consumer, reason = is_likely_consumer(f_bio, f_name, f_is_business)

                if not is_consumer:
                    total_businesses_skipped += 1
                    if count <= 10:  # Only log first few skips per account
                        print(f"    SKIP @{f_handle} — {reason}", flush=True)
                    continue

                # Extract email/phone from bio
                email_match = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", f_bio)
                phone_match = re.search(r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", f_bio)

                email = email_match.group(0) if email_match else None
                phone = phone_match.group(0) if phone_match else None

                # Consumer score based on available data
                consumer_score = 50  # Base: following a credit repair account
                if f_bio:
                    consumer_score += 10  # Has a bio
                if email:
                    consumer_score += 20  # Has public email
                if phone:
                    consumer_score += 15  # Has public phone

                # Insert into collected followers
                thash = text_hash(f_handle)
                try:
                    cur.execute("""
                        INSERT INTO instagram_collected_followers (
                            tenant_id, target_account_id, handle, display_name,
                            bio_text, profile_url, public_email, public_phone,
                            is_consumer, consumer_score, classification_reason,
                            discovery_query, discovery_type, collection_run_id,
                            processing_status, text_hash, raw_metadata_json
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s,
                            'pending', %s, %s
                        )
                        ON CONFLICT (tenant_id, handle) DO NOTHING
                        RETURNING id
                    """, (
                        TENANT_ID,
                        target_account_id,
                        f_handle,
                        f_name or None,
                        f_bio[:500] if f_bio else None,
                        f"https://www.instagram.com/{f_handle}/",
                        email,
                        phone,
                        True,
                        consumer_score,
                        f"follower of @{handle}: {reason}",
                        f"followers_of:@{handle}",
                        "follower_scrape",
                        run_id,
                        thash,
                        json.dumps({
                            "source_account": handle,
                            "follower_count": follower.followers if hasattr(follower, 'followers') else None,
                            "following_count": follower.followees if hasattr(follower, 'followees') else None,
                            "is_private": follower.is_private,
                            "has_bio": bool(f_bio),
                        }),
                    ))

                    row = cur.fetchone()
                    if row:
                        consumers_in_run += 1
                        total_consumers += 1
                        tag = ""
                        if email:
                            tag += " [EMAIL]"
                        if phone:
                            tag += " [PHONE]"
                        if count <= 20 or email or phone:  # Log first 20 + any with contact info
                            print(f"    + @{f_handle} (score:{consumer_score}) {f_name[:30]}{tag}", flush=True)
                    else:
                        total_dupes += 1

                except psycopg2.errors.UniqueViolation:
                    conn.rollback()
                    conn.autocommit = True
                    total_dupes += 1
                except Exception as e:
                    print(f"    DB error @{f_handle}: {e}", flush=True)

                # Rate limiting
                if count % BATCH_PAUSE_EVERY == 0:
                    print(f"    ... {count} followers processed, pausing {BATCH_PAUSE_SECONDS}s ...", flush=True)
                    time.sleep(BATCH_PAUSE_SECONDS)
                else:
                    time.sleep(DELAY_BETWEEN_PROFILES + random.random() * 2)

            # Update collection run
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'completed', completed_at = NOW(), "
                "followers_collected = %s WHERE id = %s",
                (consumers_in_run, run_id)
            )
            print(f"  => {consumers_in_run} consumers from {scraped_in_run} followers scraped", flush=True)

        except instaloader.exceptions.ProfileNotExistsException:
            print(f"  SKIP: @{handle} does not exist", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = 'Profile not found' WHERE id = %s", (run_id,)
            )
        except instaloader.exceptions.LoginRequiredException:
            print(f"  ERROR: Login session expired. Stopping.", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = 'Login expired' WHERE id = %s", (run_id,)
            )
            break
        except instaloader.exceptions.QueryReturnedBadRequestException as e:
            print(f"  RATE LIMITED on @{handle}: {e}", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = %s WHERE id = %s", (str(e)[:500], run_id)
            )
            print("  Waiting 60s before next account...", flush=True)
            time.sleep(60)
        except Exception as e:
            print(f"  ERROR on @{handle}: {e}", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = %s WHERE id = %s", (str(e)[:500], run_id)
            )

        # Delay between accounts
        if acct_idx < len(target_accounts) - 1:
            delay = DELAY_BETWEEN_ACCOUNTS + random.randint(0, 15)
            print(f"  Waiting {delay}s before next account...", flush=True)
            time.sleep(delay)

    # ─── Summary ─────────────────────────────────────────────────────────────
    print(flush=True)
    print("=" * 65, flush=True)
    print("  FOLLOWER SCRAPE COMPLETE", flush=True)
    print("=" * 65, flush=True)
    print(f"  Accounts scraped:       {len(target_accounts)}", flush=True)
    print(f"  Total followers seen:   {total_scraped}", flush=True)
    print(f"  Consumers collected:    {total_consumers}", flush=True)
    print(f"  Businesses skipped:     {total_businesses_skipped}", flush=True)
    print(f"  Private skipped:        {total_private_skipped}", flush=True)
    print(f"  Duplicates:             {total_dupes}", flush=True)
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
        print("\n  Consumer score distribution:", flush=True)
        for row in rows:
            print(f"    {row['tier']}: {row['count']}", flush=True)

    cur.close()
    conn.close()
    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()
