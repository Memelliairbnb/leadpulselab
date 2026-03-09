#!/usr/bin/env python3
"""
Publish 5 branded posts to @leadpulselab with captions + hashtags.
Uses instagrapi for direct posting.
"""

import time
import random
import os
from pathlib import Path
from PIL import Image
from instagrapi import Client

IG_USERNAME = "leadpulselab"
IG_PASSWORD = "#Money1984"
POST_DIR = "/Users/thebooth/ai-lead-hunter/scripts/ig-posts"
SESSION_PATH = "/Users/thebooth/ai-lead-hunter/.ig-sessions/instagrapi-session.json"

# ─── Posts (image + caption + hashtags) ──────────────────────────────────────

POSTS = [
    {
        "image": "post1_500leads.jpeg",
        "caption": """500+ qualified leads found in just 24 hours.

That's what AI-powered lead intelligence delivers.

Most businesses spend weeks manually searching for prospects. Our AI does it in hours:

🔍 Scans social media, forums & public data
🧠 AI classifies intent & buying signals
📧 Discovers and verifies contact info
⭐ Scores every lead — Qualified. Verified. Hot.

Stop hunting. Start closing.

🔗 leadpulselab.com

#LeadGeneration #AILeads #LeadPulseLab #SalesAutomation #SmartLeads #GrowthHacking #BusinessGrowth #SaaS #MarTech #LeadGen #DataDriven #CreditRepairBusiness #CreditRepairMarketing #CreditRepairLeads #FinancialServices #SmallBusinessGrowth #AIMarketing #DigitalMarketing #CustomerAcquisition #B2BMarketing""",
    },
    {
        "image": "post2_ignite.jpeg",
        "caption": """Ready to ignite your lead generation? 🔥

Boost conversions with data-driven insights. Get ahead of the curve.

Here's what LeadPulseLab does for your business:

✅ AI finds people actively looking for your services
✅ Scores and qualifies every lead automatically
✅ Delivers verified contact info — emails & phone numbers
✅ Updates your pipeline daily with fresh prospects

No more cold calling from stale lists. No more guessing.
Just qualified leads, ready to convert.

Discover more at leadpulselab.com 🔗

#LeadGeneration #IgniteYourBusiness #LeadPulseLab #AIMarketing #GrowthHacking #SalesLeads #ConversionOptimization #MarketingAutomation #BusinessGrowth #DataDrivenMarketing #SmartLeads #LeadGen #SaaS #EntrepreneurLife #DigitalMarketing #CreditRepairBusiness #FinancialServices #CustomerAcquisition #SalesAutomation #StartupGrowth""",
    },
    {
        "image": "post3_supercharge.png",
        "caption": """Supercharge your leads with LeadPulseLab ⚡

✅ Data-Driven Strategies
✅ Analytics & Insights
✅ Conversion Optimization
✅ Growth Solutions

We don't just find leads — we find the RIGHT leads.

Our AI analyzes thousands of data points to identify prospects who are actively looking for your services. Then we verify their contact info so you can reach them immediately.

The result? Higher conversion rates. Lower cost per acquisition. Faster growth.

Visit us at leadpulselab.com 🔗

#LeadGeneration #SuperchargeYourBusiness #LeadPulseLab #DataDriven #Analytics #ConversionOptimization #GrowthSolutions #AILeads #SalesAutomation #BusinessGrowth #SmartLeads #MarTech #DigitalMarketing #CreditRepairLeads #FinancialServices #EntrepreneurLife #SmallBusinessGrowth #SaaS #AIMarketing #LeadGen""",
    },
    {
        "image": "post4_accelerate.png",
        "caption": """Accelerate your growth with data-driven strategies for measurable results. 📈

⚙️ Precision Marketing — reach the right people at the right time
📊 Optimized Funnels — convert more leads into customers
🎯 Scalable Solutions — grow without adding headcount

Every business deserves a steady stream of qualified leads. We built the AI to make it happen.

Book your consultation today and see how LeadPulseLab can transform your pipeline.

🔗 leadpulselab.com

#AccelerateYourGrowth #LeadPulseLab #PrecisionMarketing #SalesAutomation #LeadGeneration #AIMarketing #BusinessGrowth #DataDriven #GrowthHacking #OptimizedFunnels #ScalableSolutions #MarTech #CreditRepairBusiness #FinancialServices #SmallBusinessGrowth #EntrepreneurLife #SaaS #DigitalMarketing #CustomerAcquisition #B2BLeads""",
    },
    {
        "image": "post5_quality.jpeg",
        "caption": """Accelerate your growth. Generate quality leads. 🚀

☑️ Data-Driven Lead Generation
☑️ Targeted Outreach Campaigns
☑️ Conversion Optimization
☑️ Proven Results

We built LeadPulseLab because every business deserves access to AI-powered lead intelligence — not just the big companies with massive budgets.

Whether you're in credit repair, financial services, real estate, or any growth business — we find your next customer using AI.

Get your free consultation today.

🔗 leadpulselab.com

#LeadGeneration #QualityLeads #LeadPulseLab #AILeads #TargetedOutreach #ConversionOptimization #ProvenResults #BusinessGrowth #GrowthHacking #SalesAutomation #DataDriven #SmartLeads #CreditRepairMarketing #CreditRepairLeads #FinancialServices #SmallBusinessGrowth #DigitalMarketing #AIMarketing #EntrepreneurLife #SaaS""",
    },
]


def ensure_jpeg(image_path):
    """Convert PNG to JPEG if needed (Instagram requires JPEG)."""
    if image_path.lower().endswith(".png"):
        jpeg_path = image_path.rsplit(".", 1)[0] + ".jpg"
        img = Image.open(image_path).convert("RGB")
        img.save(jpeg_path, "JPEG", quality=95)
        return jpeg_path
    return image_path


def main():
    print("=" * 60, flush=True)
    print("  @leadpulselab — Publishing 5 Posts", flush=True)
    print("=" * 60, flush=True)

    # Login
    print("\n[Login] Connecting to Instagram...", flush=True)
    cl = Client()
    cl.delay_range = [3, 7]

    try:
        if os.path.exists(SESSION_PATH):
            cl.load_settings(SESSION_PATH)
            cl.login(IG_USERNAME, IG_PASSWORD)
        else:
            cl.login(IG_USERNAME, IG_PASSWORD)
        cl.dump_settings(SESSION_PATH)
        print("[Login] ✓ Logged in as @leadpulselab", flush=True)
    except Exception as e:
        print(f"[Login] ✗ Failed: {e}", flush=True)
        return

    # Publish posts
    published = 0
    for i, post in enumerate(POSTS):
        image_path = os.path.join(POST_DIR, post["image"])

        if not os.path.exists(image_path):
            print(f"\n[Post {i+1}] ✗ Image not found: {image_path}", flush=True)
            continue

        # Convert PNG to JPEG if needed
        final_path = ensure_jpeg(image_path)

        print(f"\n[Post {i+1}/{len(POSTS)}] Publishing: {post['image']}", flush=True)
        print(f"  Caption preview: {post['caption'][:80]}...", flush=True)

        try:
            # Post as Reel (images are 9:16 portrait/reel size)
            # instagrapi needs a video for reels, so we convert the image to a short video
            from moviepy.editor import ImageClip
            video_path = final_path.rsplit(".", 1)[0] + "_reel.mp4"
            if not os.path.exists(video_path):
                clip = ImageClip(final_path, duration=5)
                clip.fps = 24
                clip.write_videofile(
                    video_path,
                    codec="libx264",
                    audio=False,
                    fps=24,
                    preset="ultrafast",
                    logger=None,
                )
                clip.close()
                print(f"  ✓ Converted to video: {video_path}", flush=True)

            media = cl.clip_upload(
                path=video_path,
                caption=post["caption"],
            )
            published += 1
            print(f"  ✓ Published as Reel! Media PK: {media.pk}", flush=True)
        except Exception as e:
            print(f"  ✗ Failed: {e}", flush=True)

        # Wait between posts (45-75 seconds — don't rush)
        if i < len(POSTS) - 1:
            delay = 45 + random.randint(0, 30)
            print(f"  Waiting {delay}s before next post...", flush=True)
            time.sleep(delay)

    print(f"\n{'=' * 60}", flush=True)
    print(f"  ✓ {published}/{len(POSTS)} posts published to @leadpulselab", flush=True)
    print(f"  Profile is now ready for engagement + follower scraping", flush=True)
    print(f"{'=' * 60}", flush=True)


if __name__ == "__main__":
    main()
