#!/usr/bin/env python3
"""
Instagram Browser Login — opens a real browser for the user to log in.
Captures session cookies after login and sends them to the API.
User can use saved passwords, autofill, etc.

Usage:
  python3 ig-browser-login.py                     # Opens browser, user logs in
  python3 ig-browser-login.py --api-url http://... # Post session to API
"""

import sys
import json
import time
import argparse
import asyncio
from pathlib import Path

# Persistent browser profile so saved passwords persist across sessions
PROFILE_DIR = Path(__file__).parent.parent / ".ig-sessions" / "playwright-profile"
PROFILE_DIR.mkdir(parents=True, exist_ok=True)


async def run_login(api_url=None, tenant_id=1):
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        # Use persistent context so user's saved passwords/cookies persist
        context = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            viewport={"width": 430, "height": 932},  # Mobile-ish viewport
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--enable-automation"],
        )

        page = context.pages[0] if context.pages else await context.new_page()

        # Navigate to Instagram
        print("[Browser] Opening Instagram login...", flush=True)
        await page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded")

        # Wait for user to log in — detect by checking for profile elements
        print("[Browser] Waiting for you to log in...", flush=True)
        print("[Browser] Use your saved passwords or enter credentials.", flush=True)
        print("[Browser] The browser will close automatically once you're logged in.", flush=True)
        print("", flush=True)

        logged_in = False
        max_wait = 300  # 5 minutes
        start = time.time()

        while not logged_in and (time.time() - start) < max_wait:
            await asyncio.sleep(2)

            # Check multiple indicators of being logged in
            url = page.url
            if "/accounts/login" not in url and "/challenge" not in url:
                # Might be logged in — check for session cookies
                cookies = await context.cookies("https://www.instagram.com")
                session_cookies = {c["name"]: c["value"] for c in cookies}

                if "sessionid" in session_cookies and session_cookies["sessionid"]:
                    logged_in = True
                    print("[Browser] Login detected!", flush=True)
                    break

            # Also check if we're on the feed or profile page
            if "instagram.com" in url and "/accounts/" not in url and "/challenge/" not in url:
                cookies = await context.cookies("https://www.instagram.com")
                session_cookies = {c["name"]: c["value"] for c in cookies}
                if "sessionid" in session_cookies:
                    logged_in = True
                    print("[Browser] Login detected!", flush=True)
                    break

        if not logged_in:
            print("[Browser] Login timed out. Please try again.", flush=True)
            await context.close()
            return None

        # Get all cookies
        cookies = await context.cookies("https://www.instagram.com")
        session_data = {c["name"]: c["value"] for c in cookies}

        # Fetch profile info from the page
        print("[Browser] Fetching your profile info...", flush=True)
        profile = await fetch_profile(page, session_data)

        if profile:
            print(f"[Browser] Connected as @{profile['username']}", flush=True)
            print(f"[Browser]   Name: {profile.get('full_name', 'N/A')}", flush=True)
            print(f"[Browser]   Followers: {profile.get('follower_count', 'N/A')}", flush=True)
            print(f"[Browser]   Business: {profile.get('is_business', False)}", flush=True)

        result = {
            "session_cookies": session_data,
            "session_id": session_data.get("sessionid"),
            "csrf_token": session_data.get("csrftoken"),
            "ds_user_id": session_data.get("ds_user_id"),
            "profile": profile,
        }

        # Save locally
        session_file = PROFILE_DIR.parent / "browser-session.json"
        with open(session_file, "w") as f:
            json.dump(result, f, indent=2)
        print(f"[Browser] Session saved to {session_file}", flush=True)

        # Post to API if url provided
        if api_url and profile:
            await post_to_api(api_url, tenant_id, result)

        await context.close()
        return result


async def fetch_profile(page, cookies):
    """Fetch the logged-in user's profile data from Instagram."""
    try:
        # Go to profile page
        await page.goto("https://www.instagram.com/accounts/edit/", wait_until="domcontentloaded")
        await asyncio.sleep(2)

        # Try the Instagram API endpoint for user info
        ds_user_id = cookies.get("ds_user_id", "")

        if ds_user_id:
            # Use the web API to get profile info
            response = await page.evaluate("""
                async () => {
                    try {
                        const res = await fetch('/api/v1/users/' + document.cookie.match(/ds_user_id=(\d+)/)?.[1] + '/info/', {
                            headers: {
                                'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '',
                                'X-IG-App-ID': '936619743392459',
                            }
                        });
                        if (res.ok) return await res.json();
                        return null;
                    } catch(e) {
                        return null;
                    }
                }
            """)

            if response and response.get("user"):
                user = response["user"]
                return {
                    "user_id": str(user.get("pk", ds_user_id)),
                    "username": user.get("username", ""),
                    "full_name": user.get("full_name", ""),
                    "biography": user.get("biography", ""),
                    "profile_pic_url": user.get("profile_pic_url", ""),
                    "follower_count": user.get("follower_count", 0),
                    "following_count": user.get("following_count", 0),
                    "media_count": user.get("media_count", 0),
                    "is_business": user.get("is_business", False),
                    "is_private": user.get("is_private", False),
                    "category": user.get("category", None),
                }

        # Fallback: try to get username from the page
        username = await page.evaluate("""
            () => {
                // Try to find username from various page elements
                const meta = document.querySelector('meta[property="og:title"]');
                if (meta) return meta.content;
                return null;
            }
        """)

        return {
            "user_id": ds_user_id,
            "username": username or "unknown",
            "full_name": "",
            "biography": "",
            "profile_pic_url": "",
            "follower_count": 0,
            "following_count": 0,
            "media_count": 0,
            "is_business": False,
            "is_private": False,
            "category": None,
        }

    except Exception as e:
        print(f"[Browser] Profile fetch error: {e}", flush=True)
        return {
            "user_id": cookies.get("ds_user_id", ""),
            "username": "unknown",
            "full_name": "",
            "biography": "",
            "profile_pic_url": "",
            "follower_count": 0,
            "following_count": 0,
            "media_count": 0,
            "is_business": False,
            "is_private": False,
            "category": None,
        }


async def post_to_api(api_url, tenant_id, result):
    """Post the captured session to the LeadPulseLab API."""
    import httpx

    profile = result["profile"]
    payload = {
        "ig_user_id": profile["user_id"],
        "ig_username": profile["username"],
        "session_cookies": json.dumps(result["session_cookies"]),
        "full_name": profile.get("full_name", ""),
        "biography": profile.get("biography", ""),
        "profile_pic_url": profile.get("profile_pic_url", ""),
        "follower_count": profile.get("follower_count", 0),
        "following_count": profile.get("following_count", 0),
        "media_count": profile.get("media_count", 0),
        "is_business": profile.get("is_business", False),
        "category": profile.get("category", ""),
    }

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{api_url}/api/instagram/browser-connect",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Tenant-Id": str(tenant_id),
                },
                timeout=10,
            )
            if res.status_code < 300:
                print(f"[API] Account registered successfully!", flush=True)
            else:
                print(f"[API] Registration failed: {res.text}", flush=True)
    except Exception as e:
        print(f"[API] Could not reach API: {e}", flush=True)
        print(f"[API] Session is saved locally — you can connect later.", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Instagram Browser Login")
    parser.add_argument("--api-url", default=None, help="API URL to post session to")
    parser.add_argument("--tenant-id", type=int, default=1, help="Tenant ID")
    args = parser.parse_args()

    print("=" * 55, flush=True)
    print("  Instagram Browser Login", flush=True)
    print("  A browser window will open — log in to Instagram.", flush=True)
    print("  Your saved passwords will work.", flush=True)
    print("=" * 55, flush=True)

    result = asyncio.run(run_login(api_url=args.api_url, tenant_id=args.tenant_id))

    if result:
        print("\nDone! Session captured.", flush=True)
    else:
        print("\nLogin failed or timed out.", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
