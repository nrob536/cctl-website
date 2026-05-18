from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from urllib.parse import urlparse, parse_qs
from tqdm import tqdm
import requests
import os
import time
import re

ALBUM_URLS_FILE_CANDIDATES = [
    "cctl-album-urls.txt",
    "cctl-albums-urls.txt",
]

DOWNLOAD_DIR = "toy_library_images"
HEADLESS = False
NAV_TIMEOUT_MS = 120000
NAV_RETRIES = 3

os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def safe_filename(name):
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return name[:120]


def get_urls_file_path():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    for filename in ALBUM_URLS_FILE_CANDIDATES:
        candidate = os.path.join(script_dir, filename)
        if os.path.exists(candidate):
            return candidate

    raise FileNotFoundError(
        "Could not find album URLs file. Expected one of: "
        + ", ".join(ALBUM_URLS_FILE_CANDIDATES)
    )


def load_album_urls():
    file_path = get_urls_file_path()

    urls = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            url = line.strip()
            if not url or url.startswith("#"):
                continue
            urls.append(url)

    if not urls:
        raise ValueError(f"No album URLs found in {file_path}")

    return urls


def album_folder_name(url, index):
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    set_value = qs.get("set", [""])[0]

    album_id = ""
    if set_value.startswith("a."):
        album_id = set_value[2:]

    if album_id:
        return safe_filename(f"album_{album_id}")

    return safe_filename(f"album_{index:03d}")


def collect_image_urls(page):
    previous_height = 0

    for _ in range(30):
        page.mouse.wheel(0, 12000)
        time.sleep(2)

        current_height = page.evaluate("document.body.scrollHeight")
        if current_height == previous_height:
            break
        previous_height = current_height

    image_urls = set()
    imgs = page.locator("img").evaluate_all("""
        els => els.map(e => ({
            src: e.src,
            alt: e.alt || ""
        }))
    """)

    for img in imgs:
        src = img["src"]
        if not src:
            continue
        if "scontent" not in src:
            continue
        image_urls.add(src)

    return list(image_urls)


def goto_with_retry(page, url, label):
    for attempt in range(1, NAV_RETRIES + 1):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            return True
        except PlaywrightTimeoutError:
            print(
                f"Timeout opening {label} (attempt {attempt}/{NAV_RETRIES})."
            )

            if attempt < NAV_RETRIES:
                # Brief backoff helps when Facebook throttles or delays responses.
                time.sleep(3 * attempt)
            else:
                print(f"Skipping {label} after repeated timeouts.")

    return False


def download_image(url, filename):
    try:
        r = requests.get(url, timeout=30)

        if r.status_code == 200:
            with open(filename, "wb") as f:
                f.write(r.content)

            return True

    except Exception as e:
        print("Download failed:", e)

    return False


album_urls = load_album_urls()
print(f"Loaded {len(album_urls)} album URLs")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=HEADLESS)
    context = browser.new_context()
    page = context.new_page()

    print("Opening first Facebook album page...")
    if not goto_with_retry(page, album_urls[0], "initial album page"):
        browser.close()
        raise RuntimeError("Could not open initial album page.")

    print("""
If Facebook asks you to log in:
1. Log in manually
2. Return here
3. Press ENTER
""")
    input()

    for album_index, album_url in enumerate(album_urls, start=1):
        folder_name = album_folder_name(album_url, album_index)
        album_dir = os.path.join(DOWNLOAD_DIR, folder_name)
        os.makedirs(album_dir, exist_ok=True)

        print(f"\n[{album_index}/{len(album_urls)}] Opening album: {album_url}")
        if not goto_with_retry(page, album_url, f"album {album_index}"):
            continue

        print("Scrolling album page...")
        image_urls = collect_image_urls(page)
        print(f"Found {len(image_urls)} images in {folder_name}")

        for i, url in enumerate(tqdm(image_urls, desc=folder_name)):
            ext = ".jpg"
            path = urlparse(url).path.lower()
            if ".png" in path:
                ext = ".png"

            filename = os.path.join(album_dir, f"toy_{i:04d}{ext}")
            download_image(url, filename)

    browser.close()

print("Done.")