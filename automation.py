import time
import datetime
import os
import sys
import pandas as pd
from playwright.sync_api import sync_playwright

# When running as a PyInstaller bundle, point Playwright to the bundled browsers
if getattr(sys, 'frozen', False):
    _exe_dir = os.path.dirname(sys.executable)
    _browsers_path = os.path.join(_exe_dir, 'ms-playwright')
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = _browsers_path

    # Auto-detect whichever chromium version is present in the bundle
    import glob
    _chrome_matches = glob.glob(os.path.join(_browsers_path, 'chromium-*', 'chrome-win', 'chrome.exe'))
    if _chrome_matches:
        os.environ['_BUNDLED_CHROME_EXE'] = _chrome_matches[0]


SOURCE_SITE_SELECTOR = 'select[formcontrolname="sourceSite"]:not([hidden])'
MATERIAL_SELECTOR = 'select[formcontrolname="materialType"]:not([hidden])'


def wait_for_select_options(page, selector, field_name, timeout=15000):
    select = page.locator(selector).first
    select.wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "selector => { const el = document.querySelector(selector); return el && el.options.length > 1; }",
        arg=selector,
        timeout=timeout,
    )


def select_option_by_text(page, selector, text, field_name, timeout=15000):
    select = page.locator(selector).first
    select.wait_for(state="visible", timeout=timeout)
    deadline = time.monotonic() + timeout / 1000
    search_text = str(text).strip().lower()

    while time.monotonic() < deadline:
        option_value = select.locator("option").evaluate_all(
            "(options, search) => { const option = options.find(item => item.textContent.trim().toLowerCase().includes(search)); return option ? option.value : null; }",
            search_text,
        )
        if option_value:
            select.select_option(value=option_value)
            return
        page.wait_for_timeout(100)

    raise TimeoutError(f"{field_name} option '{text}' did not load or was not found within {timeout}ms.")


def run_automation(records, username, password, wait_ms, state, log_cb, scheduled_time=None):
    def l(msg):
        log_cb(f"[{username}] {msg}")
        
    if not records or len(records) == 0:
        l("No records assigned to this account.")
        return
        
    l(f"Assigned {len(records)} records. Launching browser...")
    
    with sync_playwright() as p:
        browser_context = None
        try:
            # Use bundled chromium exe path if running as EXE, otherwise let Playwright auto-detect
            _chrome_exe = os.environ.get('_BUNDLED_CHROME_EXE')
            launch_kwargs = {'headless': False}
            if _chrome_exe and os.path.exists(_chrome_exe):
                launch_kwargs['executable_path'] = _chrome_exe
            browser = p.chromium.launch(**launch_kwargs)
            browser_context = browser.new_context()
                
            page = browser_context.new_page()
            
            # Go to site and login
            l("Navigating to target site for login...")
            page.goto("https://eaststaginggrounds.com.sg/#/login")
            
            try:
                # Wait directly for the username field to appear instead of full network idle
                page.wait_for_selector('input[formcontrolname="username"]', timeout=5000)
                
                # Check if it's asking for login (looking for the specific username field)
                if page.locator('input[formcontrolname="username"]').count() > 0:
                     l("Login page detected. Attempting to log in...")
                     
                     email_field = page.locator('input[formcontrolname="username"]').first
                     email_field.fill(username)
                     
                     pass_field = page.locator('input[formcontrolname="password"]').first
                     pass_field.fill(password)
                     
                     # Find login button
                     login_btn = page.locator('button.login-btn').first
                     if login_btn.count() > 0:
                         login_btn.click()
                     else:
                         # Try pressing Enter
                         pass_field.press('Enter')
                         
                     l("Login submitted. Waiting for dashboard...")
                     
                     # Wait up to 3 seconds for it to navigate itself, otherwise force it
                     try:
                         page.wait_for_url("**/generate-token", timeout=3000)
                     except:
                         pass
                     
                     l("Login successful.")
                else:
                     l("No login fields detected. Might already be logged in.")
                     
            except Exception as login_err:
                 l(f"Warning during login phase: {str(login_err)}")
                 
            l("Navigating to token generation page...")
            page.goto("https://eaststaginggrounds.com.sg/#/generate-token")
            
            # Wait for the route and its asynchronously loaded site options before scheduling.
            wait_for_select_options(page, SOURCE_SITE_SELECTOR, "Source Site")
            
            if scheduled_time:
                l(f"Waiting for computer's scheduled time: {scheduled_time}")
                target_time = datetime.datetime.strptime(scheduled_time, "%H:%M:%S").time()
                while True:
                    if state["should_stop"]:
                        l("Automation stopped during timer wait.")
                        return
                        
                    now = datetime.datetime.now()
                    target = datetime.datetime.combine(now.date(), target_time)
                    
                    diff = (target - now).total_seconds()
                    if diff <= 0:
                        break
                    if diff > 0.05:
                        time.sleep(min(0.1, diff - 0.05))
                
                l("Time reached. Blasting!")
            
            for record in records:
                idx = record.get('global_index', 0)
                if state["should_stop"]:
                    l("Automation stopped by user.")
                    break
                    
                src_code = str(record.get('sourceCode', '')).strip()
                truck_no = str(record.get('truckNo', '')).strip()
                material = str(record.get('material', '')).strip()
                
                l(f"Processing row {idx+1}: {truck_no}")
                
                result_status = "Error"
                result_msg = ""
                
                try:
                    # 1. Select Source Site after its asynchronously loaded options are ready.
                    select_option_by_text(page, SOURCE_SITE_SELECTOR, src_code, "Source Site")
                    
                    # 2. Fill Truck No
                    page.evaluate(f'''() => {{
                        const input = document.querySelector('input[formcontrolname="truckNo"]');
                        if (input) {{
                            input.value = '{truck_no}';
                            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        }}
                    }}''')
                    
                    # 3. Wait for the site's dependent material options, then select the match.
                    select_option_by_text(page, MATERIAL_SELECTOR, material, "Material")
                    
                    # Remove any existing error toasts
                    page.evaluate("document.querySelectorAll('.ngx-toastr').forEach(t => t.remove());")
                    
                    # 4. Click Go Button via JS
                    page.evaluate('''() => {
                        let btn = Array.from(document.querySelectorAll('button[type="button"]')).find(el => el.textContent.includes('Go'));
                        if (!btn) {
                            btn = document.querySelector('button[type="button"] .fa-refresh')?.closest('button');
                        }
                        if (btn) btn.click();
                    }''')
                    
                    # 5. Wait API ms
                    time.sleep(wait_ms / 1000.0)
                    
                    # 6. Check for error toast
                    error_toast = page.locator('.ngx-toastr.toast-error')
                    if error_toast.count() > 0:
                        result_msg = error_toast.first.text_content()
                        l(f"Error detected: {result_msg}")
                        page.evaluate("document.querySelectorAll('.ngx-toastr').forEach(t => t.remove());")
                        state["results"].append({"index": idx, "username": username, "status": "Error", "message": result_msg})
                        continue
                        
                    # 7. Click Generate Button via JS
                    page.evaluate('''() => {
                        let btn = Array.from(document.querySelectorAll('button[type="button"].pv-nxt-btn')).find(el => el.textContent.includes('Generate'));
                        if (!btn) {
                            btn = document.querySelector('button[type="button"].pv-nxt-btn .fa-save')?.closest('button');
                        }
                        if (btn) btn.click();
                    }''')
                    
                    # Check post-generate errors or navigation
                    start_wait = time.time()
                    navigated = False
                    while time.time() - start_wait < max(3.0, wait_ms / 1000.0):
                        if error_toast.count() > 0:
                            result_msg = error_toast.first.text_content()
                            break
                        if "manage-token" in page.url:
                            navigated = True
                            break
                        time.sleep(0.1)
                        
                    if result_msg:
                        l(f"Error detected after generation: {result_msg}")
                        page.evaluate("document.querySelectorAll('.ngx-toastr').forEach(t => t.remove());")
                        state["results"].append({"index": idx, "username": username, "status": "Error", "message": result_msg})
                        continue
                        
                    if navigated:
                        page.evaluate("window.location.hash = '#/generate-token';")
                        wait_for_select_options(page, SOURCE_SITE_SELECTOR, "Source Site")
                    else:
                        time.sleep(0.2)
                        if error_toast.count() > 0:
                            result_msg = error_toast.first.text_content()
                            l(f"Error detected: {result_msg}")
                            page.evaluate("document.querySelectorAll('.ngx-toastr').forEach(t => t.remove());")
                            state["results"].append({"index": idx, "username": username, "status": "Error", "message": result_msg})
                            continue
                            
                    result_status = "Success"
                    result_msg = "Token Generated"
                    
                except Exception as ex:
                    result_status = "Error"
                    result_msg = str(ex)
                    l(f"Exception for {truck_no}: {result_msg}")
                    
                state["results"].append({"index": idx, "username": username, "status": result_status, "message": result_msg})
                
        except Exception as e:
            l(f"Browser automation failed: {e}")
        finally:
            if browser_context:
                browser_context.close()
            l("Browser closed. Automation finished.")
