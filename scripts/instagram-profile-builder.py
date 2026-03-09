#!/usr/bin/env python3
"""
Instagram Profile Builder + Lead Scraper

Builds @leadpulselab as a real, engaged Instagram profile while simultaneously
scraping follower data from every credit repair account we interact with.

Every action = data capture:
  - Follow an account → scrape their followers
  - Like a post → log the interaction
  - Comment on a post → warm up DM access
  - New follower on our account → scrape their profile

Safe engagement rates (Instagram limits):
  - 20-30 follows per hour (max 200/day)
  - 30-50 likes per hour (max 300/day)
  - 10-15 comments per hour (max 100/day)
  - We run WELL under these limits

Usage:
    python3 scripts/instagram-profile-builder.py [--max-accounts 5] [--max-followers 200]
"""

import sys
import re
import json
import time
import hashlib
import random
import argparse
from datetime import datetime

import instaloader
import psycopg2
import psycopg2.extras

# ─── Config ───────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway"
TENANT_ID = 1
IG_USERNAME = "leadpulselab"

# ─── Engagement settings (conservative to avoid bans) ─────────────────────────

LIKES_PER_ACCOUNT = 3           # like 3 recent posts per account we follow
COMMENT_CHANCE = 0.3            # 30% chance to comment on a post we like
DELAY_BETWEEN_ACTIONS = 4       # 4-8 seconds between likes/comments
DELAY_BETWEEN_FOLLOWERS = 3     # 3-6 seconds between scraping each follower
DELAY_BETWEEN_ACCOUNTS = 45     # 45-75 seconds between target accounts
BATCH_PAUSE_EVERY = 50          # pause longer every N followers scraped
BATCH_PAUSE_SECONDS = 60        # 60 second pause
MAX_FOLLOWERS_PER_ACCOUNT = 200 # conservative per account
MAX_ACCOUNTS_PER_RUN = 5        # conservative per run

# ─── Comments pool (natural, varied) ─────────────────────────────────────────

COMMENTS = [
    "Great content! 🔥",
    "This is so helpful 💯",
    "Keep up the amazing work! 👏",
    "Love this! 🙌",
    "Such valuable info 📈",
    "This is gold 💰",
    "Needed to see this today 🙏",
    "Facts! 💪",
    "So true! Great post 👍",
    "This is exactly what people need to hear",
    "Incredible work! Keep it coming 🔥",
    "Wow, impressive results! 👏",
    "Real talk right here 💯",
    "This deserves more attention 📣",
    "Saving this! Super valuable 🔖",
]

# ─── Business detection ──────────────────────────────────────────────────────

BUSINESS_KEYWORDS = [
    "llc", "inc", "corp", "services", "specialist", "expert", "company",
    "consulting", "certified", "licensed", "credit repair", "credit restoration",
    "credit fix", "we fix", "we help", "our clients", "book now", "dm for",
    "free consultation", "link in bio", "linktree", "ceo", "founder",
    "entrepreneur", "accepting clients", "tradeline", "business funding",
    "loan officer", "mortgage", "realtor",
]


def is_likely_consumer(bio, full_name, is_business_account):
    """Returns (is_consumer, reason)"""
    if is_business_account:
        return False, "ig_business_account"
    text = f"{bio or ''} {full_name or ''}".lower()
    biz_hits = sum(1 for kw in BUSINESS_KEYWORDS if kw in text)
    if biz_hits >= 2:
        return False, f"business ({biz_hits} keywords)"
    return True, f"consumer (biz={biz_hits})"


def text_hash(text):
    return hashlib.sha256(text.lower().strip().encode()).hexdigest()[:64]


def compute_consumer_score(bio, email, phone, is_following_credit_repair=True):
    """Score 0-100 based on available data."""
    score = 45 if is_following_credit_repair else 30  # Following credit repair = strong signal
    if bio and len(bio) > 20:
        score += 10
    if email:
        score += 25
    if phone:
        score += 15
    return min(score, 100)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-accounts", type=int, default=MAX_ACCOUNTS_PER_RUN)
    parser.add_argument("--max-followers", type=int, default=MAX_FOLLOWERS_PER_ACCOUNT)
    args = parser.parse_args()

    print("=" * 65, flush=True)
    print("  @leadpulselab — Profile Builder + Lead Scraper", flush=True)
    print("=" * 65, flush=True)

    # ─── Login (use saved session) ───────────────────────────────────────────
    print("\n[IG] Loading session...", flush=True)
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
        L.load_session_from_file(IG_USERNAME)
        # Verify session is still valid
        L.test_login()
        print("[IG] Session loaded — logged in as @leadpulselab", flush=True)
    except Exception:
        print("[IG] Session expired or not found. Logging in fresh...", flush=True)
        try:
            L.login(IG_USERNAME, "#Money1984")
            L.save_session_to_file(IG_USERNAME)
            print("[IG] Fresh login successful, session saved.", flush=True)
        except Exception as e:
            print(f"[IG] Login failed: {e}", flush=True)
            sys.exit(1)

    # ─── Database ────────────────────────────────────────────────────────────
    print("[DB] Connecting...", flush=True)
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    print("[DB] Connected.", flush=True)

    # ─── Load target accounts from our discovery ─────────────────────────────
    cur.execute("""
        SELECT DISTINCT ON (instagram_handle)
            instagram_handle, display_name, bio_text, category
        FROM raw_instagram_profiles
        WHERE tenant_id = %s AND processing_status = 'completed'
        ORDER BY instagram_handle, id
    """, (TENANT_ID,))
    all_profiles = cur.fetchall()

    # Parse follower counts, sort by biggest first
    def parse_followers(bio):
        if not bio:
            return 0
        m = re.search(r"([\d,]+(?:\.\d+)?)\s*([KkMm])?\s*[Ff]ollowers", bio)
        if not m:
            return 0
        n = float(m.group(1).replace(",", ""))
        s = m.group(2)
        if s and s.upper() == "K":
            n *= 1000
        elif s and s.upper() == "M":
            n *= 1000000
        return int(n)

    profiles_sorted = sorted(
        [(p, parse_followers(p["bio_text"])) for p in all_profiles],
        key=lambda x: x[1], reverse=True
    )

    # Check which accounts we've already scraped
    cur.execute("""
        SELECT DISTINCT search_query FROM instagram_collection_runs
        WHERE tenant_id = %s AND status = 'completed' AND search_type = 'profile_builder'
    """, (TENANT_ID,))
    already_done = {r["search_query"] for r in cur.fetchall()}

    # Filter to accounts with 100+ followers that we haven't scraped yet
    targets = [
        (p, c) for p, c in profiles_sorted
        if c >= 100 and f"profile_builder:@{p['instagram_handle']}" not in already_done
    ][:args.max_accounts]

    if not targets:
        print("\n[Done] All accounts already scraped! Run discovery to find more.", flush=True)
        cur.close()
        conn.close()
        return

    print(f"\n[Targets] {len(targets)} accounts to engage + scrape:", flush=True)
    for p, c in targets:
        print(f"  @{p['instagram_handle']} — {c:,} followers", flush=True)

    # ─── Process each target ─────────────────────────────────────────────────

    stats = {
        "accounts_processed": 0,
        "follows": 0,
        "likes": 0,
        "comments": 0,
        "followers_scraped": 0,
        "consumers_collected": 0,
        "businesses_skipped": 0,
        "private_skipped": 0,
        "dupes": 0,
    }

    for acct_idx, (target, est_followers) in enumerate(targets):
        handle = target["instagram_handle"]
        print(f"\n{'─' * 60}", flush=True)
        print(f"[{acct_idx+1}/{len(targets)}] @{handle} ({est_followers:,} est. followers)", flush=True)
        print(f"{'─' * 60}", flush=True)

        # Create collection run
        cur.execute(
            "INSERT INTO instagram_collection_runs (tenant_id, search_query, search_type, status, started_at, followers_collected) "
            "VALUES (%s, %s, %s, 'running', NOW(), 0) RETURNING id",
            (TENANT_ID, f"profile_builder:@{handle}", "profile_builder")
        )
        run_id = cur.fetchone()["id"]

        # Upsert target account
        cur.execute("""
            INSERT INTO instagram_target_accounts (tenant_id, handle, display_name, category, follower_count, is_active)
            VALUES (%s, %s, %s, %s, %s, true)
            ON CONFLICT (tenant_id, handle) DO UPDATE SET follower_count = EXCLUDED.follower_count, updated_at = NOW()
            RETURNING id
        """, (TENANT_ID, handle, target["display_name"], target["category"], est_followers))
        target_account_id = cur.fetchone()["id"]

        consumers_in_run = 0

        try:
            profile = instaloader.Profile.from_username(L.context, handle)

            if profile.is_private:
                print(f"  SKIP: Private account", flush=True)
                cur.execute(
                    "UPDATE instagram_collection_runs SET status = 'skipped', completed_at = NOW(), "
                    "error_message = 'Private account' WHERE id = %s", (run_id,)
                )
                continue

            real_followers = profile.followers
            print(f"  Real followers: {real_followers:,}", flush=True)

            # Update target account with real count
            cur.execute(
                "UPDATE instagram_target_accounts SET follower_count = %s WHERE id = %s",
                (real_followers, target_account_id)
            )

            # ── Step 1: FOLLOW the account ───────────────────────────────────
            print(f"  [FOLLOW] Following @{handle}...", flush=True)
            try:
                L.context.graphql_query(
                    "3afb0e97c6b57e289ab5a6b94dafb066",
                    {"id": profile.userid, "include_reel": True}
                )
                # Use the REST API to follow
                L.context._session.post(
                    f"https://www.instagram.com/web/friendships/{profile.userid}/follow/",
                    headers={"X-CSRFToken": L.context._session.cookies.get("csrftoken", domain=".instagram.com")}
                )
                stats["follows"] += 1
                print(f"  [FOLLOW] ✓ Now following @{handle}", flush=True)
            except Exception as e:
                print(f"  [FOLLOW] Could not follow (may already follow): {e}", flush=True)

            time.sleep(DELAY_BETWEEN_ACTIONS + random.random() * 3)

            # ── Step 2: LIKE recent posts ────────────────────────────────────
            print(f"  [LIKE] Liking {LIKES_PER_ACCOUNT} recent posts...", flush=True)
            post_count = 0
            try:
                for post in profile.get_posts():
                    if post_count >= LIKES_PER_ACCOUNT:
                        break

                    try:
                        L.context._session.post(
                            f"https://www.instagram.com/web/likes/{post.mediaid}/like/",
                            headers={"X-CSRFToken": L.context._session.cookies.get("csrftoken", domain=".instagram.com")}
                        )
                        stats["likes"] += 1
                        post_count += 1
                        print(f"  [LIKE] ✓ Liked post {post.shortcode}", flush=True)

                        # Maybe comment
                        if random.random() < COMMENT_CHANCE:
                            comment = random.choice(COMMENTS)
                            try:
                                L.context._session.post(
                                    f"https://www.instagram.com/web/comments/{post.mediaid}/add/",
                                    data={"comment_text": comment},
                                    headers={"X-CSRFToken": L.context._session.cookies.get("csrftoken", domain=".instagram.com")}
                                )
                                stats["comments"] += 1
                                print(f"  [COMMENT] ✓ \"{comment}\"", flush=True)
                            except Exception as ce:
                                print(f"  [COMMENT] Failed: {ce}", flush=True)

                        time.sleep(DELAY_BETWEEN_ACTIONS + random.random() * 4)

                    except Exception as e:
                        print(f"  [LIKE] Failed: {e}", flush=True)
                        time.sleep(DELAY_BETWEEN_ACTIONS)

            except Exception as e:
                print(f"  [LIKE] Could not load posts: {e}", flush=True)

            # ── Step 3: SCRAPE FOLLOWERS ─────────────────────────────────────
            print(f"  [SCRAPE] Scraping followers (max {args.max_followers})...", flush=True)

            scraped = 0
            try:
                for follower in profile.get_followers():
                    if scraped >= args.max_followers:
                        break

                    scraped += 1
                    stats["followers_scraped"] += 1

                    f_handle = follower.username.lower()
                    f_name = follower.full_name or ""

                    # Try to get bio data
                    f_bio = ""
                    f_is_biz = False
                    try:
                        f_bio = follower.biography or ""
                        f_is_biz = follower.is_business_account
                    except Exception:
                        pass

                    # Skip private
                    if follower.is_private:
                        stats["private_skipped"] += 1
                        continue

                    # Classify
                    is_consumer, reason = is_likely_consumer(f_bio, f_name, f_is_biz)
                    if not is_consumer:
                        stats["businesses_skipped"] += 1
                        continue

                    # Extract contact info
                    email_m = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", f_bio)
                    phone_m = re.search(r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", f_bio)
                    email = email_m.group(0) if email_m else None
                    phone = phone_m.group(0) if phone_m else None

                    score = compute_consumer_score(f_bio, email, phone)

                    # Insert
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
                            TENANT_ID, target_account_id, f_handle,
                            f_name or None,
                            f_bio[:500] if f_bio else None,
                            f"https://www.instagram.com/{f_handle}/",
                            email, phone,
                            True, score,
                            f"follower of @{handle}: {reason}",
                            f"profile_builder:@{handle}",
                            "profile_builder",
                            run_id,
                            text_hash(f_handle),
                            json.dumps({
                                "source_account": handle,
                                "has_bio": bool(f_bio),
                                "has_email": bool(email),
                                "has_phone": bool(phone),
                            }),
                        ))

                        row = cur.fetchone()
                        if row:
                            consumers_in_run += 1
                            stats["consumers_collected"] += 1
                            tag = ""
                            if email:
                                tag += " [EMAIL]"
                            if phone:
                                tag += " [PHONE]"
                            # Log first 15 per account + any with contact info
                            if consumers_in_run <= 15 or email or phone:
                                print(f"    + @{f_handle} (score:{score}) {f_name[:25]}{tag}", flush=True)
                        else:
                            stats["dupes"] += 1

                    except psycopg2.errors.UniqueViolation:
                        conn.rollback()
                        conn.autocommit = True
                        stats["dupes"] += 1
                    except Exception as e:
                        print(f"    DB error @{f_handle}: {e}", flush=True)

                    # Rate limiting
                    if scraped % BATCH_PAUSE_EVERY == 0:
                        print(f"    ... {scraped} followers processed, pausing {BATCH_PAUSE_SECONDS}s ...", flush=True)
                        time.sleep(BATCH_PAUSE_SECONDS)
                    else:
                        time.sleep(DELAY_BETWEEN_FOLLOWERS + random.random() * 3)

            except instaloader.exceptions.QueryReturnedBadRequestException as e:
                print(f"  [SCRAPE] Rate limited: {e}", flush=True)
                print(f"  [SCRAPE] Got {scraped} followers before limit", flush=True)
            except Exception as e:
                print(f"  [SCRAPE] Error: {e}", flush=True)

            # Update run
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'completed', completed_at = NOW(), "
                "followers_collected = %s WHERE id = %s",
                (consumers_in_run, run_id)
            )

            stats["accounts_processed"] += 1
            print(f"\n  ✓ @{handle}: {consumers_in_run} consumers from {scraped} followers", flush=True)

        except instaloader.exceptions.ProfileNotExistsException:
            print(f"  SKIP: Profile doesn't exist", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = 'Not found' WHERE id = %s", (run_id,)
            )
        except instaloader.exceptions.LoginRequiredException:
            print(f"  ERROR: Session expired. Stopping.", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = 'Session expired' WHERE id = %s", (run_id,)
            )
            break
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            cur.execute(
                "UPDATE instagram_collection_runs SET status = 'failed', completed_at = NOW(), "
                "error_message = %s WHERE id = %s", (str(e)[:500], run_id)
            )

        # Delay between accounts
        if acct_idx < len(targets) - 1:
            delay = DELAY_BETWEEN_ACCOUNTS + random.randint(0, 30)
            print(f"\n  Waiting {delay}s before next account...", flush=True)
            time.sleep(delay)

    # ─── Final Summary ───────────────────────────────────────────────────────
    print(flush=True)
    print("=" * 65, flush=True)
    print("  @leadpulselab — Session Complete", flush=True)
    print("=" * 65, flush=True)
    print(f"  Accounts engaged:       {stats['accounts_processed']}", flush=True)
    print(f"  Follows sent:           {stats['follows']}", flush=True)
    print(f"  Posts liked:            {stats['likes']}", flush=True)
    print(f"  Comments posted:        {stats['comments']}", flush=True)
    print(f"  Followers scraped:      {stats['followers_scraped']}", flush=True)
    print(f"  Consumers collected:    {stats['consumers_collected']}", flush=True)
    print(f"  Businesses skipped:     {stats['businesses_skipped']}", flush=True)
    print(f"  Private skipped:        {stats['private_skipped']}", flush=True)
    print(f"  Duplicates:             {stats['dupes']}", flush=True)
    print("=" * 65, flush=True)

    # Score distribution
    cur.execute("""
        SELECT
            CASE
                WHEN consumer_score >= 80 THEN 'hot (80+)'
                WHEN consumer_score >= 50 THEN 'warm (50-79)'
                WHEN consumer_score >= 30 THEN 'cool (30-49)'
                ELSE 'cold (<30)'
            END as tier,
            COUNT(*) as count
        FROM instagram_collected_followers
        WHERE tenant_id = %s AND is_consumer = true
        GROUP BY tier ORDER BY tier
    """, (TENANT_ID,))
    rows = cur.fetchall()
    if rows:
        print("\n  Lead temperature:", flush=True)
        for r in rows:
            print(f"    {r['tier']}: {r['count']}", flush=True)

    total = stats["consumers_collected"]
    print(f"\n  🎯 {total} new consumer leads added to pipeline", flush=True)
    print(f"  Run again to engage more accounts: python3 scripts/instagram-profile-builder.py", flush=True)

    cur.close()
    conn.close()
    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()
