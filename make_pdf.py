"""Convert README.md to a professionally styled PDF using Playwright headless Chrome."""
import markdown
import os
from playwright.sync_api import sync_playwright

# Read the markdown
with open("README.md", "r", encoding="utf-8") as f:
    md_text = f.read()

# Convert to HTML
body_html = markdown.markdown(md_text, extensions=["tables", "fenced_code"])

# Wrap in a full styled HTML document
full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fira+Code:wght@400&display=swap');

  * {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.7;
    color: #1a1a2e;
    background: #fff;
    padding: 48px 56px;
    max-width: 900px;
    margin: auto;
  }}

  h1 {{
    font-size: 28px;
    font-weight: 700;
    color: #0f3460;
    border-bottom: 3px solid #e94560;
    padding-bottom: 10px;
    margin-bottom: 6px;
  }}

  h2 {{
    font-size: 18px;
    font-weight: 700;
    color: #16213e;
    margin-top: 36px;
    margin-bottom: 10px;
    border-left: 4px solid #e94560;
    padding-left: 10px;
  }}

  h3 {{
    font-size: 14px;
    font-weight: 600;
    color: #0f3460;
    margin-top: 20px;
    margin-bottom: 6px;
  }}

  p {{
    margin-bottom: 10px;
  }}

  ul, ol {{
    margin: 8px 0 8px 24px;
  }}

  li {{
    margin-bottom: 4px;
  }}

  strong {{
    color: #0f3460;
  }}

  code {{
    font-family: 'Fira Code', 'Courier New', monospace;
    background: #f0f4ff;
    color: #e94560;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }}

  pre {{
    background: #16213e;
    color: #a8dadc;
    padding: 16px 20px;
    border-radius: 8px;
    margin: 14px 0;
    overflow-x: auto;
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    line-height: 1.6;
  }}

  pre code {{
    background: none;
    color: inherit;
    padding: 0;
  }}

  table {{
    border-collapse: collapse;
    width: 100%;
    margin: 14px 0;
    font-size: 12.5px;
  }}

  th {{
    background: #0f3460;
    color: #fff;
    font-weight: 600;
    padding: 10px 14px;
    text-align: left;
  }}

  td {{
    padding: 9px 14px;
    border-bottom: 1px solid #e8eaf6;
  }}

  tr:nth-child(even) td {{
    background: #f5f7ff;
  }}

  hr {{
    border: none;
    border-top: 2px solid #e8eaf6;
    margin: 28px 0;
  }}

  blockquote {{
    border-left: 4px solid #e94560;
    background: #fff5f7;
    padding: 10px 16px;
    margin: 14px 0;
    border-radius: 0 6px 6px 0;
    color: #555;
  }}

  a {{
    color: #e94560;
    text-decoration: none;
  }}
</style>
</head>
<body>
{body_html}
</body>
</html>"""

# Save a temp HTML file
html_path = os.path.abspath("README_temp.html")
pdf_path = os.path.abspath("README.pdf")

with open(html_path, "w", encoding="utf-8") as f:
    f.write(full_html)

# Use Playwright to render to PDF
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(f"file:///{html_path}")
    page.wait_for_timeout(1500)  # Let fonts load
    page.pdf(
        path=pdf_path,
        format="A4",
        margin={"top": "20mm", "bottom": "20mm", "left": "15mm", "right": "15mm"},
        print_background=True,
    )
    browser.close()

os.remove(html_path)
print(f"PDF saved to: {pdf_path}")
