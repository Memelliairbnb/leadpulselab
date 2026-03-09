#!/usr/bin/env python3
"""
Instagram authentication helper using instagrapi.
Commands: login, verify-2fa, get-profile
Input: JSON via stdin
Output: JSON to stdout
"""

import sys
import json
import traceback

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ig-auth-helper.py <command>"}))
        sys.exit(1)

    command = sys.argv[1]

    try:
        input_data = json.loads(sys.stdin.read())
    except Exception:
        print(json.dumps({"error": "Invalid JSON input"}))
        sys.exit(1)

    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            TwoFactorRequired,
            ChallengeRequired,
            LoginRequired,
            BadPassword,
            PleaseWaitFewMinutes,
        )
    except ImportError:
        print(json.dumps({"error": "instagrapi not installed. Run: pip install instagrapi"}))
        sys.exit(1)

    try:
        if command == "login":
            username = input_data.get("username", "")
            password = input_data.get("password", "")

            if not username or not password:
                print(json.dumps({"error": "username and password are required"}))
                sys.exit(1)

            cl = Client()
            cl.delay_range = [1, 3]

            try:
                cl.login(username, password)
                # Login succeeded
                user_info = cl.account_info()
                session_json = cl.get_settings()

                result = {
                    "status": "connected",
                    "account": {
                        "ig_user_id": str(user_info.pk),
                        "ig_username": user_info.username,
                        "full_name": user_info.full_name,
                        "biography": user_info.biography,
                        "follower_count": user_info.follower_count,
                        "following_count": user_info.following_count,
                        "media_count": user_info.media_count,
                        "is_business": user_info.is_business,
                        "profile_pic_url": str(user_info.profile_pic_url) if user_info.profile_pic_url else None,
                        "category": user_info.category if hasattr(user_info, 'category') else None,
                    },
                    "session_json": json.dumps(session_json),
                }
                print(json.dumps(result))

            except TwoFactorRequired as e:
                # Extract 2FA identifier from the exception info
                two_factor_info = cl.last_json if hasattr(cl, 'last_json') else {}
                identifier = ""
                if isinstance(two_factor_info, dict):
                    tf_info = two_factor_info.get("two_factor_info", {})
                    identifier = tf_info.get("two_factor_identifier", "")

                # Save partial settings so we can resume after 2FA
                partial_session = cl.get_settings()

                result = {
                    "status": "two_factor_required",
                    "two_factor_identifier": identifier,
                    "session_json": json.dumps(partial_session),
                }
                print(json.dumps(result))

            except ChallengeRequired:
                result = {
                    "status": "checkpoint_required",
                    "message": "Instagram requires a security challenge. Please verify on the Instagram app first, then try again.",
                }
                print(json.dumps(result))

            except BadPassword:
                print(json.dumps({"error": "Invalid password"}))
                sys.exit(1)

            except PleaseWaitFewMinutes:
                print(json.dumps({"error": "Instagram rate limit. Please wait a few minutes and try again."}))
                sys.exit(1)

        elif command == "verify-2fa":
            username = input_data.get("username", "")
            code = input_data.get("code", "")
            session_json_str = input_data.get("session_json", "")

            if not username or not code:
                print(json.dumps({"error": "username and code are required"}))
                sys.exit(1)

            cl = Client()
            cl.delay_range = [1, 3]

            # Restore partial session if available
            if session_json_str:
                try:
                    settings = json.loads(session_json_str)
                    cl.set_settings(settings)
                except Exception:
                    pass

            try:
                # The two_factor_login method in instagrapi
                cl.two_factor_login(code)
                user_info = cl.account_info()
                session_json = cl.get_settings()

                result = {
                    "status": "connected",
                    "account": {
                        "ig_user_id": str(user_info.pk),
                        "ig_username": user_info.username,
                        "full_name": user_info.full_name,
                        "biography": user_info.biography,
                        "follower_count": user_info.follower_count,
                        "following_count": user_info.following_count,
                        "media_count": user_info.media_count,
                        "is_business": user_info.is_business,
                        "profile_pic_url": str(user_info.profile_pic_url) if user_info.profile_pic_url else None,
                        "category": user_info.category if hasattr(user_info, 'category') else None,
                    },
                    "session_json": json.dumps(session_json),
                }
                print(json.dumps(result))

            except Exception as e:
                print(json.dumps({"error": f"2FA verification failed: {str(e)}"}))
                sys.exit(1)

        elif command == "get-profile":
            session_json_str = input_data.get("session_json", "")

            if not session_json_str:
                print(json.dumps({"error": "session_json is required"}))
                sys.exit(1)

            cl = Client()
            cl.delay_range = [1, 3]
            settings = json.loads(session_json_str)
            cl.set_settings(settings)

            try:
                cl.login_by_sessionid(settings.get("authorization_data", {}).get("sessionid", ""))
            except Exception:
                pass

            user_info = cl.account_info()

            # Get recent media for niche detection
            medias = cl.user_medias(user_info.pk, amount=12)
            recent_captions = []
            for m in medias:
                if m.caption_text:
                    recent_captions.append(m.caption_text[:500])

            result = {
                "account": {
                    "ig_user_id": str(user_info.pk),
                    "ig_username": user_info.username,
                    "full_name": user_info.full_name,
                    "biography": user_info.biography,
                    "follower_count": user_info.follower_count,
                    "following_count": user_info.following_count,
                    "media_count": user_info.media_count,
                    "is_business": user_info.is_business,
                    "profile_pic_url": str(user_info.profile_pic_url) if user_info.profile_pic_url else None,
                    "category": user_info.category if hasattr(user_info, 'category') else None,
                },
                "recent_captions": recent_captions,
            }
            print(json.dumps(result))

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)


if __name__ == "__main__":
    main()
