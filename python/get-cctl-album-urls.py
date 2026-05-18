from playwright.sync_api import sync_playwright
import time

ALBUMS_PAGE = "https://www.facebook.com/CartertonToyLibrary/photos_albums"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    
    print("Open Facebook and log in if needed")
    page.goto(ALBUMS_PAGE, wait_until="networkidle")
    input("Press ENTER after fully loading the albums page...")

    # Scroll to load all album tiles
    prev_height = 0
    for _ in range(20):
        page.mouse.wheel(0, 10000)
        time.sleep(2)
        curr_height = page.evaluate("document.body.scrollHeight")
        if curr_height == prev_height:
            break
        prev_height = curr_height

    # Grab all album links
    album_elements = page.locator('a').evaluate_all("""
        (els) => els
          .map(e => e.href)
          .filter(href => href.includes('/photos/a.'))
    """)

    print(f"Found {len(album_elements)} albums")
    for album in album_elements:
        print(album)

    browser.close()