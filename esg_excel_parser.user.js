// ==UserScript==
// @name         East Staging Grounds - Excel Uploader
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Upload, parse Excel, and automate form filling
// @author       Pythonic Shariful
// @match        https://eaststaginggrounds.com.sg/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let styleAdded = false;
    let uiContainer = null;
    let parsedData = [];
    let isProcessing = false;
    let stopRequested = false;

    // Helper functions for Angular forms
    function setInputValue(selector, value) {
        if (!selector || !value) return false;
        const inputs = document.querySelectorAll(selector);
        let filled = false;
        inputs.forEach(input => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true;
        });
        return filled;
    }

    function setSelectValueByText(selector, text) {
        if (!selector || !text) return false;
        const selects = document.querySelectorAll(selector);
        let selected = false;
        
        selects.forEach(select => {
            const options = Array.from(select.options);
            const targetOption = options.find(opt => opt.textContent.toLowerCase().includes(text.toLowerCase()));
            
            if (targetOption) {
                select.value = targetOption.value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                selected = true;
            }
        });
        return selected;
    }

    // New helper to poll for dynamic options that take time to load from API
    async function waitForAndSelectMaterial(selector, text, timeout = 3000) {
        if (!selector || !text) return false;
        return new Promise(resolve => {
            const start = Date.now();
            const interval = setInterval(() => {
                const selects = document.querySelectorAll(selector);
                let selected = false;
                
                selects.forEach(select => {
                    const options = Array.from(select.options);
                    const targetOption = options.find(opt => opt.textContent.toLowerCase().includes(text.toLowerCase()));
                    
                    if (targetOption) {
                        select.value = targetOption.value;
                        // Dispatch both input and change for Angular
                        select.dispatchEvent(new Event('input', { bubbles: true }));
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        selected = true;
                    }
                });
                
                if (selected) {
                    clearInterval(interval);
                    resolve(true);
                } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    resolve(false); // timed out
                }
            }, 50); // poll every 50ms
        });
    }



    async function fillFormAndSubmit(data, apiWaitMs) {
        // 1. Fill Source Site
        const siteSelected = setSelectValueByText('select[formcontrolname="sourceSite"]', data.sourceCode);
        if (!siteSelected) return { status: 'Error', message: 'Source Site not found or failed to select' };
        
        // 2. Fill Truck No
        const truckFilled = setInputValue('input[formcontrolname="truckNo"]', data.truckNo);
        if (!truckFilled) return { status: 'Error', message: 'Truck No input not found' };
        
        // 3. Fill Material Type (Polls until options load)
        const materialSelected = await waitForAndSelectMaterial('select[formcontrolname="materialType"]', data.material, 3000);
        if (!materialSelected) return { status: 'Error', message: 'Material not found or failed to select' };
        
        // Clear any existing toasts before clicking Go
        document.querySelectorAll('.ngx-toastr').forEach(t => t.remove());

        // Wait a tiny bit before clicking Go
        await new Promise(r => setTimeout(r, 50));
        
        // 4. Click Go Button
        const buttons = Array.from(document.querySelectorAll('button[type="button"]'));
        const goButton = buttons.find(b => {
            const text = b.textContent.trim();
            const hasIcon = b.querySelector('.fa-refresh');
            return text.includes('Go') || hasIcon;
        });
        
        if (goButton) {
            goButton.click();
        } else {
            return { status: 'Error', message: 'Go button not found' };
        }

        // 5. Wait for user-defined ms to allow the API to respond and error toast to potentially appear
        await new Promise(r => setTimeout(r, apiWaitMs));
        
        // 6. Check if the error toast appeared
        const errorToast = document.querySelector('.ngx-toastr.toast-error');
        if (errorToast) {
            console.log("Detected error popup, skipping this truck instantly.");
            const msg = errorToast.textContent.trim() || "Error";
            errorToast.remove(); // instantly dismiss
            return { status: 'Error', message: msg };
        } 
        
        // 7. If no error toast, click the Generate button
        const generateButtons = Array.from(document.querySelectorAll('button[type="button"].pv-nxt-btn'));
        const generateBtn = generateButtons.find(b => {
            const text = b.textContent.trim();
            return text.includes('Generate') || b.querySelector('.fa-save');
        });

        if (generateBtn) {
            generateBtn.click();
            
            // Wait up to 3 seconds to see if the website navigates away to manage-token
            const startCheck = Date.now();
            let navigated = false;
            let postGenError = null;
            
            while (Date.now() - startCheck < Math.max(3000, apiWaitMs)) {
                const errToast = document.querySelector('.ngx-toastr.toast-error');
                if (errToast) {
                    postGenError = errToast.textContent.trim() || "Error during generation";
                    errToast.remove();
                    break;
                }
                
                if (window.location.href.includes('manage-token')) {
                    navigated = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 50));
            }
            
            if (postGenError) {
                return { status: 'Error', message: postGenError };
            }
            
            if (navigated) {
                // Navigate back to generate-token
                window.location.hash = '#/generate-token';
                
                // Wait until the form has re-rendered
                const formWaitStart = Date.now();
                while (Date.now() - formWaitStart < 5000) {
                    if (document.querySelector('select[formcontrolname="sourceSite"]')) {
                        // Give it a tiny bit of extra time to finish rendering all bindings
                        await new Promise(r => setTimeout(r, 100));
                        break;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
            } else {
                // Wait briefly for generate action to register before the next row
                // Also double check for errors one last time
                await new Promise(r => setTimeout(r, Math.max(200, Math.floor(apiWaitMs * 0.5))));
                const errToast = document.querySelector('.ngx-toastr.toast-error');
                if (errToast) {
                    const msg = errToast.textContent.trim() || "Error during generation";
                    errToast.remove();
                    return { status: 'Error', message: msg };
                }
            }
            
            return { status: 'Success', message: 'Token Generated' };
        } else {
            return { status: 'Error', message: 'Generate button not found' };
        }
    }

    function injectUI() {
        if (document.getElementById('esg-excel-uploader')) return;

        if (!styleAdded) {
            GM_addStyle(`
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
                
                #esg-excel-uploader {
                    position: fixed;
                    bottom: 25px;
                    right: 25px;
                    background: rgba(17, 24, 39, 0.75);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    padding: 24px;
                    box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
                    z-index: 9999999;
                    color: #f8fafc;
                    font-family: 'Outfit', 'Inter', sans-serif;
                    width: 360px;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }
                #esg-excel-uploader h3 {
                    margin: 0 0 16px 0;
                    font-size: 18px;
                    font-weight: 700;
                    background: linear-gradient(135deg, #38bdf8, #818cf8);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    letter-spacing: 0.5px;
                    padding-bottom: 12px;
                    position: relative;
                }
                #esg-excel-uploader h3::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 1px;
                    background: linear-gradient(90deg, rgba(56, 189, 248, 0.5), transparent);
                }
                .esg-file-input-wrapper {
                    position: relative;
                    overflow: hidden;
                    display: inline-block;
                    width: 100%;
                }
                .esg-btn {
                    background: linear-gradient(135deg, #0ea5e9, #2563eb);
                    border: none;
                    color: white;
                    padding: 12px 18px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                    font-family: 'Outfit', sans-serif;
                    width: 100%;
                    text-align: center;
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 15px rgba(14, 165, 233, 0.25);
                    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
                }
                .esg-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(14, 165, 233, 0.4);
                }
                .esg-btn:active {
                    transform: translateY(1px);
                }
                .esg-btn:disabled {
                    background: #475569;
                    box-shadow: none;
                    opacity: 0.7;
                    cursor: not-allowed;
                    transform: none;
                }
                .esg-btn-success {
                    background: linear-gradient(135deg, #10b981, #059669);
                    box-shadow: 0 4px 15px rgba(16, 185, 129, 0.25);
                }
                .esg-btn-success:hover {
                    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
                }
                #esg-stop-btn {
                    background: linear-gradient(135deg, #ef4444, #b91c1c);
                    box-shadow: 0 4px 15px rgba(239, 68, 68, 0.25);
                }
                #esg-stop-btn:hover:not(:disabled) {
                    box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4);
                }
                .esg-file-input-wrapper input[type=file] {
                    font-size: 100px;
                    position: absolute;
                    left: 0;
                    top: 0;
                    opacity: 0;
                    cursor: pointer;
                    height: 100%;
                }
                #esg-results {
                    margin-top: 15px;
                    overflow-y: auto;
                    flex-grow: 1;
                    font-size: 13px;
                    padding-right: 5px;
                }
                /* Custom Sleek Scrollbar */
                #esg-results::-webkit-scrollbar {
                    width: 6px;
                }
                #esg-results::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.02); 
                    border-radius: 8px;
                }
                #esg-results::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.15); 
                    border-radius: 8px;
                }
                #esg-results::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.25); 
                }
                .esg-data-row {
                    background: rgba(255, 255, 255, 0.03);
                    margin-bottom: 10px;
                    padding: 12px;
                    border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-left: 3px solid #38bdf8;
                    transition: all 0.3s ease;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                .esg-data-row:hover {
                    background: rgba(255, 255, 255, 0.06);
                    transform: translateX(2px);
                }
                .esg-data-row div {
                    margin-bottom: 5px;
                }
                .esg-data-row div:last-child {
                    margin-bottom: 0;
                }
                .esg-label {
                    color: #94a3b8;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.8px;
                    font-weight: 600;
                }
                .esg-value {
                    font-weight: 500;
                    color: #f1f5f9;
                }
                #esg-toggle {
                    position: absolute;
                    top: 18px;
                    right: 20px;
                    cursor: pointer;
                    color: #94a3b8;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }
                #esg-toggle:hover {
                    color: white;
                    background: rgba(255, 255, 255, 0.1);
                    transform: scale(1.1);
                }
                .esg-minimized {
                    height: 64px !important;
                    padding: 18px 24px !important;
                    overflow: hidden;
                    width: 240px !important;
                }
            `);
            styleAdded = true;
        }

        if (!uiContainer) {
            uiContainer = document.createElement('div');
            uiContainer.id = 'esg-excel-uploader';
            
            const minimizeIcon = `<svg style="pointer-events: none;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            const maximizeIcon = `<svg style="pointer-events: none;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

            uiContainer.innerHTML = `
                <button id="esg-toggle">${minimizeIcon}</button>
                <h3>ESG Excel Parser</h3>
                <div class="esg-file-input-wrapper">
                    <button class="esg-btn">Upload Excel File</button>
                    <input type="file" id="esg-file-input" accept=".xlsx, .xls, .csv" />
                </div>
                <div id="esg-controls" style="display:none; flex-direction:column; gap:10px; margin-top:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.05); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <label style="font-size: 12px; font-weight: 500; color: #94a3b8; letter-spacing: 0.5px; text-transform: uppercase;">API Wait (ms):</label>
                        <input type="number" id="esg-speed-input" value="1000" min="0" step="100" style="width: 70px; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; font-family: inherit; font-size: 13px; text-align: center; outline: none;" />
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.05); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <label style="font-size: 12px; font-weight: 500; color: #94a3b8; letter-spacing: 0.5px; text-transform: uppercase;">Schedule Start:</label>
                        <input type="time" step="1" id="esg-schedule-input" style="width: 105px; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; font-family: inherit; font-size: 13px; text-align: center; outline: none; color-scheme: dark;" />
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button class="esg-btn esg-btn-success" id="esg-start-btn" style="flex:1; margin-top:0;">Start</button>
                        <button class="esg-btn" id="esg-stop-btn" style="flex:1; background:#ef4444; margin-top:0;" disabled>Stop</button>
                    </div>
                </div>
                <div id="esg-results"></div>
            `;
            
            const fileInput = uiContainer.querySelector('#esg-file-input');
            const resultsDiv = uiContainer.querySelector('#esg-results');
            const toggleBtn = uiContainer.querySelector('#esg-toggle');
            const startBtn = uiContainer.querySelector('#esg-start-btn');
            const stopBtn = uiContainer.querySelector('#esg-stop-btn');
            const controlsDiv = uiContainer.querySelector('#esg-controls');

            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                uiContainer.classList.toggle('esg-minimized');
                toggleBtn.innerHTML = uiContainer.classList.contains('esg-minimized') ? maximizeIcon : minimizeIcon;
            });

            stopBtn.addEventListener('click', () => {
                if (isProcessing) {
                    stopRequested = true;
                    stopBtn.textContent = 'Stopping...';
                    stopBtn.disabled = true;
                }
            });

            startBtn.addEventListener('click', async () => {
                if (isProcessing) return;
                isProcessing = true;
                stopRequested = false;
                startBtn.textContent = 'Processing...';
                startBtn.style.opacity = '0.7';
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = 'Stop';
                
                const scheduleInput = uiContainer.querySelector('#esg-schedule-input');
                const scheduleVal = scheduleInput.value;

                if (scheduleVal) {
                    const [targetH, targetM, targetS = 0] = scheduleVal.split(':').map(Number);
                    
                    let targetDate = new Date();
                    targetDate.setHours(targetH, targetM, targetS, 0);
                    
                    // If target time is in the past by more than 2 seconds, assume tomorrow
                    if (Date.now() - targetDate.getTime() > 2000) {
                        targetDate.setDate(targetDate.getDate() + 1);
                    }
                    
                    await new Promise(resolve => {
                        const checkInterval = setInterval(() => {
                            if (stopRequested) {
                                clearInterval(checkInterval);
                                resolve();
                                return;
                            }
                            
                            const diff = targetDate.getTime() - Date.now();
                            if (diff <= 0) {
                                clearInterval(checkInterval);
                                resolve();
                            } else {
                                const s = Math.ceil(diff / 1000);
                                const h = Math.floor(s / 3600);
                                const m = Math.floor((s % 3600) / 60);
                                const secs = s % 60;
                                
                                let timeStr = '';
                                if (h > 0) timeStr += h + 'h ';
                                if (m > 0 || h > 0) timeStr += m + 'm ';
                                timeStr += secs + 's';
                                
                                startBtn.textContent = 'Starts in ' + timeStr;
                            }
                        }, 50);
                    });
                    
                    // If stopped during schedule wait, exit cleanly
                    if (stopRequested) {
                        isProcessing = false;
                        startBtn.textContent = 'Start';
                        startBtn.style.opacity = '1';
                        startBtn.disabled = false;
                        stopBtn.disabled = true;
                        stopBtn.textContent = 'Stop';
                        return;
                    }
                }
                
                startBtn.textContent = 'Processing...';
                
                const rowElements = Array.from(uiContainer.querySelectorAll('.esg-data-row'));

                for (let i = 0; i < parsedData.length; i++) {
                    if (stopRequested) {
                        const msg = document.createElement('div');
                        msg.style.color = '#ef4444';
                        msg.style.padding = '10px';
                        msg.style.textAlign = 'center';
                        msg.style.fontWeight = 'bold';
                        msg.textContent = 'Automation Stopped.';
                        uiContainer.querySelector('#esg-results').prepend(msg);
                        break;
                    }
                    
                    const data = parsedData[i];
                    
                    // Highlight current row
                    rowElements.forEach(el => el.style.borderLeftColor = '#38bdf8'); // Reset to default blue
                    if (rowElements[i]) {
                        rowElements[i].style.borderLeftColor = '#22c55e'; // Highlight active green
                        rowElements[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                    
                    const speedInput = uiContainer.querySelector('#esg-speed-input');
                    const apiWaitMs = parseInt(speedInput.value) || 0;
                    
                    const result = await fillFormAndSubmit(data, apiWaitMs);
                    
                    data.status = result.status;
                    data.message = result.message;

                    // Update UI row with status
                    const statusSpan = document.createElement('div');
                    statusSpan.style.marginTop = '8px';
                    statusSpan.style.padding = '4px 8px';
                    statusSpan.style.borderRadius = '4px';
                    statusSpan.style.fontSize = '11px';
                    statusSpan.style.fontWeight = 'bold';
                    statusSpan.style.display = 'inline-block';

                    if (result.status === 'Success') {
                        statusSpan.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
                        statusSpan.style.color = '#4ade80';
                        statusSpan.textContent = '✓ ' + result.message;
                    } else {
                        statusSpan.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                        statusSpan.style.color = '#f87171';
                        statusSpan.textContent = '✗ ' + result.message;
                    }
                    
                    if (rowElements[i]) {
                        rowElements[i].appendChild(statusSpan);
                    }
                    
                    // Wait a tiny bit before next iteration
                    await new Promise(r => setTimeout(r, 50));
                }
                
                isProcessing = false;
                startBtn.textContent = 'Start';
                startBtn.style.opacity = '1';
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopBtn.textContent = 'Stop';
                
                // Reset all highlights
                rowElements.forEach(el => el.style.borderLeftColor = '#38bdf8');
                
                // Add Download Report button if it doesn't exist yet
                if (!document.getElementById('esg-download-btn')) {
                    const downloadBtn = document.createElement('button');
                    downloadBtn.id = 'esg-download-btn';
                    downloadBtn.className = 'esg-btn esg-btn-success';
                    downloadBtn.textContent = 'Download CSV Report';
                    downloadBtn.style.marginTop = '10px';
                    downloadBtn.onclick = () => {
                         let csvContent = "data:text/csv;charset=utf-8,";
                         csvContent += "Source Code,Truck No,Material,Status,Message\n";
                         parsedData.forEach(row => {
                             const sourceCode = (row.sourceCode || '').replace(/"/g, '""');
                             const truckNo = (row.truckNo || '').replace(/"/g, '""');
                             const material = (row.material || '').replace(/"/g, '""');
                             const status = (row.status || '').replace(/"/g, '""');
                             const message = (row.message || '').replace(/"/g, '""');
                             csvContent += `"${sourceCode}","${truckNo}","${material}","${status}","${message}"\n`;
                         });
                         const encodedUri = encodeURI(csvContent);
                         const link = document.createElement("a");
                         link.setAttribute("href", encodedUri);
                         link.setAttribute("download", "esg_automation_report.csv");
                         document.body.appendChild(link);
                         link.click();
                         link.remove();
                    };
                    const btnWrapper = uiContainer.querySelector('.esg-file-input-wrapper').parentElement;
                    btnWrapper.insertBefore(downloadBtn, uiContainer.querySelector('#esg-results'));
                }

                alert("Automation Complete!");
            });

            fileInput.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (!file) return;
                
                resultsDiv.innerHTML = '<div style="text-align:center; padding:10px; color:#94a3b8;">Processing...</div>';
                parsedData = [];
                controlsDiv.style.display = 'none';

                const reader = new FileReader();
                reader.onload = function(e) {
                    const data = e.target.result;
                    const workbook = XLSX.read(data, {type: 'binary'});
                    
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, {header: 1});
                    
                    let headerRowIndex = -1;
                    let sourceCodeIdx = -1;
                    let truckNoIdx = -1;
                    let materialIdx = -1;

                    for (let i = 0; i < json.length; i++) {
                        const row = json[i];
                        if (!row) continue;
                        
                        let foundSource = -1, foundTruck = -1, foundMaterial = -1;
                        
                        for (let j = 0; j < row.length; j++) {
                            const cellValue = String(row[j] || '').trim().toLowerCase();
                            if (cellValue.includes('source code')) foundSource = j;
                            if (cellValue.includes('truck no')) foundTruck = j;
                            if (cellValue.includes('material')) foundMaterial = j;
                        }
                        
                        if ((foundSource !== -1 ? 1 : 0) + (foundTruck !== -1 ? 1 : 0) + (foundMaterial !== -1 ? 1 : 0) >= 2) {
                            headerRowIndex = i;
                            sourceCodeIdx = foundSource;
                            truckNoIdx = foundTruck;
                            materialIdx = foundMaterial;
                            break;
                        }
                    }

                    resultsDiv.innerHTML = '';

                    if (headerRowIndex === -1) {
                        resultsDiv.innerHTML = '<div style="color:#ef4444; padding:10px;">Could not find required columns in the sheet.</div>';
                        return;
                    }

                    // Parse the rows below the header row
                    for (let i = headerRowIndex + 1; i < json.length; i++) {
                        const row = json[i];
                        if (!row || row.length === 0) continue;
                        
                        const sourceCode = sourceCodeIdx !== -1 ? String(row[sourceCodeIdx] || '').trim() : '';
                        const truckNo = truckNoIdx !== -1 ? String(row[truckNoIdx] || '').trim() : '';
                        const material = materialIdx !== -1 ? String(row[materialIdx] || '').trim() : '';

                        if (!sourceCode && !truckNo && !material) continue;

                        parsedData.push({ sourceCode, truckNo, material });
                    }

                    if (parsedData.length === 0) {
                         resultsDiv.innerHTML = '<div style="color:#f59e0b; padding:10px;">Headers found, but no data rows detected.</div>';
                         return;
                    }

                    // Render results
                    parsedData.forEach(data => {
                        const item = document.createElement('div');
                        item.className = 'esg-data-row';
                        item.innerHTML = `
                            <div><span class="esg-label">Source Code:</span> <span class="esg-value">${data.sourceCode || 'N/A'}</span></div>
                            <div><span class="esg-label">Truck No:</span> <span class="esg-value">${data.truckNo || 'N/A'}</span></div>
                            <div><span class="esg-label">Material:</span> <span class="esg-value">${data.material || 'N/A'}</span></div>
                        `;
                        resultsDiv.appendChild(item);
                    });
                    
                    // Show controls
                    controlsDiv.style.display = 'flex';
                };
                
                reader.readAsBinaryString(file);
            });
        }

        if (document.body) {
            document.body.appendChild(uiContainer);
        }
    }

    // Initial Injection
    injectUI();

    // Re-inject if SPA navigation clears the DOM
    const observer = new MutationObserver(() => {
        injectUI();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(injectUI, 2000);

})();
