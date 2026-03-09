#!/usr/bin/env python3
"""
Generate and post content to @leadpulselab Instagram.
Creates professional post images with Pillow and posts via instagrapi.
"""

import os
import sys
import time
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from instagrapi import Client

# ─── Config ───────────────────────────────────────────────────────────────────

IG_USERNAME = "leadpulselab"
IG_PASSWORD = "#Money1984"
OUTPUT_DIR = "/Users/thebooth/ai-lead-hunter/scripts/ig-posts"
LOGO_PATH = "/Users/thebooth/ai-lead-hunter/apps/dashboard-web/public/logo.png"

# Brand colors
DARK_BG = (15, 23, 42)          # Dark navy
ACCENT_TEAL = (0, 186, 175)     # Teal/cyan from logo
ACCENT_GREEN = (16, 185, 129)   # Green
WHITE = (255, 255, 255)
LIGHT_GRAY = (148, 163, 184)
CARD_BG = (30, 41, 59)          # Slightly lighter navy

# ─── Hashtags ────────────────────────────────────────────────────────────────

CORE_HASHTAGS = [
    "#LeadGeneration", "#AILeads", "#SalesAutomation",
    "#LeadPulseLab", "#SmartLeads", "#GrowthHacking",
    "#BusinessGrowth", "#SaaS", "#MarTech",
    "#LeadGen", "#SalesLeads", "#DataDriven",
]

NICHE_HASHTAGS = [
    "#CreditRepairBusiness", "#CreditRepairMarketing",
    "#CreditRepairLeads", "#FinancialServices",
    "#SmallBusinessGrowth", "#EntrepreneurLife",
    "#BusinessAutomation", "#AIMarketing",
    "#DigitalMarketing", "#CustomerAcquisition",
]

def get_hashtags(count=20):
    """Get a mix of hashtags for a post."""
    tags = list(CORE_HASHTAGS) + random.sample(NICHE_HASHTAGS, min(count - len(CORE_HASHTAGS), len(NICHE_HASHTAGS)))
    random.shuffle(tags)
    return " ".join(tags[:count])

# ─── Image Generation ────────────────────────────────────────────────────────

def get_font(size, bold=False):
    """Get a system font."""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_rounded_rect(draw, xy, radius, fill):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    draw.rectangle([x1 + radius, y1, x2 - radius, y2], fill=fill)
    draw.rectangle([x1, y1 + radius, x2, y2 - radius], fill=fill)
    draw.pieslice([x1, y1, x1 + 2*radius, y1 + 2*radius], 180, 270, fill=fill)
    draw.pieslice([x2 - 2*radius, y1, x2, y1 + 2*radius], 270, 360, fill=fill)
    draw.pieslice([x1, y2 - 2*radius, x1 + 2*radius, y2], 90, 180, fill=fill)
    draw.pieslice([x2 - 2*radius, y2 - 2*radius, x2, y2], 0, 90, fill=fill)


def add_logo(img, logo_path, position=(40, 40), size=(80, 80)):
    """Overlay the logo on the image."""
    try:
        logo = Image.open(logo_path).convert("RGBA")
        logo = logo.resize(size, Image.LANCZOS)
        img.paste(logo, position, logo)
    except Exception:
        pass


def create_stat_post(filename, headline, stat_value, stat_label, subtitle):
    """Create a stats/results post."""
    img = Image.new("RGB", (1080, 1080), DARK_BG)
    draw = ImageDraw.Draw(img)

    # Logo
    add_logo(img, LOGO_PATH, (40, 40), (70, 70))

    # Brand name
    font_brand = get_font(28)
    draw.text((120, 55), "LeadPulseLab", fill=ACCENT_TEAL, font=font_brand)

    # Headline
    font_head = get_font(48, bold=True)
    y = 180
    # Word wrap headline
    words = headline.split()
    lines = []
    line = ""
    for w in words:
        test = f"{line} {w}".strip()
        bbox = draw.textbbox((0, 0), test, font=font_head)
        if bbox[2] > 950:
            lines.append(line)
            line = w
        else:
            line = test
    if line:
        lines.append(line)

    for line in lines:
        draw.text((60, y), line, fill=WHITE, font=font_head)
        y += 65

    # Big stat number
    font_stat = get_font(160, bold=True)
    y += 40
    draw.text((60, y), stat_value, fill=ACCENT_TEAL, font=font_stat)
    y += 180

    # Stat label
    font_label = get_font(36)
    draw.text((60, y), stat_label, fill=LIGHT_GRAY, font=font_label)
    y += 60

    # Subtitle
    font_sub = get_font(28)
    draw.text((60, y), subtitle, fill=LIGHT_GRAY, font=font_sub)

    # Bottom bar
    draw.rectangle([0, 1040, 1080, 1080], fill=ACCENT_TEAL)
    font_cta = get_font(24, bold=True)
    draw.text((380, 1048), "leadpulselab.com", fill=DARK_BG, font=font_cta)

    img.save(filename, quality=95)
    return filename


def create_tip_post(filename, tip_number, title, tips_list):
    """Create a tips/value post."""
    img = Image.new("RGB", (1080, 1080), DARK_BG)
    draw = ImageDraw.Draw(img)

    add_logo(img, LOGO_PATH, (40, 40), (70, 70))
    font_brand = get_font(28)
    draw.text((120, 55), "LeadPulseLab", fill=ACCENT_TEAL, font=font_brand)

    # Tip badge
    font_badge = get_font(22, bold=True)
    draw_rounded_rect(draw, (60, 150, 260, 190), 15, ACCENT_TEAL)
    draw.text((80, 157), f"TIP #{tip_number}", fill=DARK_BG, font=font_badge)

    # Title
    font_title = get_font(44, bold=True)
    y = 220
    words = title.split()
    lines = []
    line = ""
    for w in words:
        test = f"{line} {w}".strip()
        bbox = draw.textbbox((0, 0), test, font=font_title)
        if bbox[2] > 950:
            lines.append(line)
            line = w
        else:
            line = test
    if line:
        lines.append(line)
    for line in lines:
        draw.text((60, y), line, fill=WHITE, font=font_title)
        y += 60

    # Tips list
    y += 30
    font_tip = get_font(30)
    for i, tip in enumerate(tips_list):
        # Bullet circle
        draw.ellipse([65, y + 8, 85, y + 28], fill=ACCENT_TEAL)
        draw.text((100, y), tip, fill=WHITE, font=font_tip)
        y += 55

    # Bottom bar
    draw.rectangle([0, 1040, 1080, 1080], fill=ACCENT_TEAL)
    font_cta = get_font(24, bold=True)
    draw.text((380, 1048), "leadpulselab.com", fill=DARK_BG, font=font_cta)

    img.save(filename, quality=95)
    return filename


def create_intro_post(filename):
    """Create a 'Who We Are' intro post."""
    img = Image.new("RGB", (1080, 1080), DARK_BG)
    draw = ImageDraw.Draw(img)

    # Big logo in center
    add_logo(img, LOGO_PATH, (390, 80), (300, 300))

    # Brand name
    font_name = get_font(64, bold=True)
    bbox = draw.textbbox((0, 0), "LeadPulseLab", font=font_name)
    x = (1080 - (bbox[2] - bbox[0])) // 2
    draw.text((x, 400), "LeadPulseLab", fill=WHITE, font=font_name)

    # Tagline
    font_tag = get_font(32)
    tagline = "AI-Powered Lead Intelligence"
    bbox = draw.textbbox((0, 0), tagline, font=font_tag)
    x = (1080 - (bbox[2] - bbox[0])) // 2
    draw.text((x, 480), tagline, fill=ACCENT_TEAL, font=font_tag)

    # Features
    font_feat = get_font(28)
    features = [
        "🎯  Find leads automatically",
        "📊  AI qualification & scoring",
        "📧  Verified contact discovery",
        "🚀  Convert on autopilot",
    ]
    y = 580
    for feat in features:
        bbox = draw.textbbox((0, 0), feat, font=font_feat)
        x = (1080 - (bbox[2] - bbox[0])) // 2
        draw.text((x, y), feat, fill=WHITE, font=font_feat)
        y += 55

    # CTA
    y += 30
    font_cta = get_font(26)
    cta = "Follow for lead gen tips & AI insights"
    bbox = draw.textbbox((0, 0), cta, font=font_cta)
    x = (1080 - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), cta, fill=LIGHT_GRAY, font=font_cta)

    # Bottom bar
    draw.rectangle([0, 1040, 1080, 1080], fill=ACCENT_TEAL)
    font_bottom = get_font(24, bold=True)
    draw.text((380, 1048), "leadpulselab.com", fill=DARK_BG, font=font_bottom)

    img.save(filename, quality=95)
    return filename


# ─── Post Content ────────────────────────────────────────────────────────────

POSTS = [
    {
        "type": "intro",
        "caption": """Welcome to LeadPulseLab 🎯

We built an AI that finds, qualifies, and delivers leads — so you can focus on closing deals, not hunting for prospects.

Here's what we do:
✅ Scan thousands of sources automatically
✅ AI scores and qualifies every lead
✅ Discover verified emails & phone numbers
✅ Deliver hot leads to your dashboard daily

Whether you're in credit repair, financial services, or any growth business — we find your next customer.

Follow us for lead generation tips, AI insights, and growth strategies.

🔗 Link in bio

""",
    },
    {
        "type": "stat",
        "args": {
            "headline": "What AI Lead Intelligence Looks Like",
            "stat_value": "500+",
            "stat_label": "Leads Found in 24 Hours",
            "subtitle": "Qualified. Scored. Contact verified.",
        },
        "caption": """500+ qualified leads in 24 hours. That's what AI-powered lead intelligence delivers. 📈

Most businesses spend weeks manually searching for prospects. Our AI does it in hours:

🔍 Scans social media, forums & public data
🧠 AI classifies intent & buying signals
📧 Discovers and verifies contact info
⭐ Scores every lead from cold to hot

Stop hunting. Start closing.

🔗 leadpulselab.com

""",
    },
    {
        "type": "tip",
        "args": {
            "tip_number": 1,
            "title": "5 Signs Your Lead Gen Is Broken",
            "tips_list": [
                "You're buying stale lead lists",
                "No scoring = wasting time on cold leads",
                "Manual research eats 20+ hrs/week",
                "No verified contact info",
                "Same leads as your competitors",
            ],
        },
        "caption": """Is your lead generation actually working? 🤔

Here are 5 signs it's broken:

1️⃣ You're buying the same recycled lead lists everyone else has
2️⃣ No lead scoring means you waste time on people who'll never buy
3️⃣ You spend 20+ hours/week manually searching for prospects
4️⃣ Half your emails bounce because contacts aren't verified
5️⃣ Your competitors are reaching the same people first

The fix? AI-powered lead intelligence that finds FRESH leads with VERIFIED contact data.

Save this post for later 🔖

""",
    },
    {
        "type": "stat",
        "args": {
            "headline": "The Credit Repair Industry Needs Better Leads",
            "stat_value": "87%",
            "stat_label": "of leads go uncontacted",
            "subtitle": "Because businesses can't find verified contact info.",
        },
        "caption": """87% of potential leads never get contacted. Let that sink in. 😳

The problem isn't demand — people are actively searching for credit repair help every single day.

The problem is FINDING them and having VERIFIED ways to reach them.

That's exactly what LeadPulseLab solves:
🎯 AI finds people actively looking for credit repair
📧 Discovers verified email addresses
📱 Finds real phone numbers
⭐ Scores lead quality so you call the hot ones first

Your next client is already looking for you. We help you find them first.

🔗 leadpulselab.com

""",
    },
    {
        "type": "tip",
        "args": {
            "tip_number": 2,
            "title": "How AI Changes Lead Generation",
            "tips_list": [
                "Scans 1000s of sources in minutes",
                "Detects buying intent from language",
                "Scores leads automatically (0-100)",
                "Verifies contact data in real-time",
                "Delivers only qualified prospects",
            ],
        },
        "caption": """AI isn't coming for lead generation — it's already here. 🤖

Here's how artificial intelligence is transforming how businesses find customers:

🔍 Scans thousands of data sources in minutes (not weeks)
🧠 Detects buying intent from how people talk online
📊 Automatically scores every lead from 0-100
✅ Verifies email addresses and phone numbers in real-time
🎯 Delivers only qualified, ready-to-contact prospects

The businesses using AI for lead gen are 10x faster than those still doing it manually.

Which side do you want to be on?

Follow @leadpulselab for more AI + growth content 🚀

""",
    },
]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 60, flush=True)
    print("  @leadpulselab — Content Creation & Publishing", flush=True)
    print("=" * 60, flush=True)

    # Generate images
    print("\n[1/2] Generating post images...", flush=True)
    image_paths = []

    for i, post in enumerate(POSTS):
        filename = os.path.join(OUTPUT_DIR, f"post_{i+1}.jpg")

        if post["type"] == "intro":
            create_intro_post(filename)
        elif post["type"] == "stat":
            create_stat_post(filename, **post["args"])
        elif post["type"] == "tip":
            create_tip_post(filename, **post["args"])

        image_paths.append(filename)
        print(f"  ✓ Post {i+1}: {post['type']} — {filename}", flush=True)

    print(f"\n  {len(image_paths)} images generated in {OUTPUT_DIR}/", flush=True)

    # Login to Instagram
    print("\n[2/2] Publishing to @leadpulselab...", flush=True)
    cl = Client()
    cl.delay_range = [3, 7]  # Random delay between API calls

    try:
        # Try loading saved session first
        session_path = "/Users/thebooth/ai-lead-hunter/.ig-sessions/instagrapi-session.json"
        if os.path.exists(session_path):
            cl.load_settings(session_path)
            cl.login(IG_USERNAME, IG_PASSWORD)
        else:
            cl.login(IG_USERNAME, IG_PASSWORD)
            cl.dump_settings(session_path)
        print("  ✓ Logged in as @leadpulselab", flush=True)
    except Exception as e:
        print(f"  ✗ Login failed: {e}", flush=True)
        print(f"\n  Images saved to {OUTPUT_DIR}/ — you can post them manually.", flush=True)
        return

    # Post each image
    for i, (post, img_path) in enumerate(zip(POSTS, image_paths)):
        caption = post["caption"] + "\n" + get_hashtags()

        print(f"\n  Publishing post {i+1}/{len(POSTS)}...", flush=True)
        try:
            media = cl.photo_upload(
                path=img_path,
                caption=caption,
            )
            print(f"  ✓ Post {i+1} published! Media ID: {media.pk}", flush=True)
        except Exception as e:
            print(f"  ✗ Post {i+1} failed: {e}", flush=True)

        # Wait between posts (30-60 seconds)
        if i < len(POSTS) - 1:
            delay = 30 + random.randint(0, 30)
            print(f"  Waiting {delay}s before next post...", flush=True)
            time.sleep(delay)

    print("\n" + "=" * 60, flush=True)
    print("  All posts published! ✓", flush=True)
    print("  @leadpulselab is ready for engagement.", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
