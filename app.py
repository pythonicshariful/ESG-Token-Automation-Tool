import os
import threading
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import pandas as pd
import json
from concurrent.futures import ThreadPoolExecutor

from automation import run_automation

import sys

if getattr(sys, 'frozen', False):
    template_dir = os.path.join(sys._MEIPASS, 'templates')
    app = Flask(__name__, template_folder=template_dir)
else:
    app = Flask(__name__)
    
app.secret_key = "super_secret_key"
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Global state to keep track of current automation task
automation_state = {
    "is_running": False,
    "should_stop": False,
    "logs": [],
    "results": []
}

def log_message(msg):
    automation_state["logs"].append(msg)
    print(msg)

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Parse Excel to show preview
        try:
            # Read without headers first to find where the actual headers are
            df_raw = pd.read_excel(filepath, header=None)
            header_idx = -1
            
            for idx, row in df_raw.iterrows():
                row_strs = [str(cell).lower() for cell in row.values]
                has_source = any('source code' in c for c in row_strs)
                has_truck = any('truck no' in c for c in row_strs)
                has_mat = any('material' in c for c in row_strs)
                
                if sum([has_source, has_truck, has_mat]) >= 2:
                    header_idx = idx
                    break
                    
            if header_idx == -1:
                return jsonify({"error": "Could not find required columns in sheet (Source Code, Truck No, Material)"}), 400
                
            # Read again using the correct header row
            df = pd.read_excel(filepath, header=header_idx)
            
            source_col = next((c for c in df.columns if 'source code' in str(c).lower()), None)
            truck_col = next((c for c in df.columns if 'truck no' in str(c).lower()), None)
            mat_col = next((c for c in df.columns if 'material' in str(c).lower()), None)
            
            if not all([source_col, truck_col, mat_col]):
                return jsonify({"error": "Could not find required columns in sheet after header detection"}), 400
                
            data = df[[source_col, truck_col, mat_col]].dropna(how='all')
            data = data.rename(columns={source_col: 'sourceCode', truck_col: 'truckNo', mat_col: 'material'})
            records = data.to_dict('records')
            
            return jsonify({"message": "File processed successfully", "data": records, "filepath": filepath})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    # Attempt to find Windows Chrome profiles
    user_data_dir = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'User Data')
    profiles = []
    
    if os.path.exists(user_data_dir):
        local_state_path = os.path.join(user_data_dir, 'Local State')
        if os.path.exists(local_state_path):
            try:
                with open(local_state_path, 'r', encoding='utf-8') as f:
                    local_state = json.load(f)
                    info_cache = local_state.get('profile', {}).get('info_cache', {})
                    for dir_name, profile_info in info_cache.items():
                        profiles.append({
                            'dir_name': dir_name,
                            'name': profile_info.get('name', dir_name),
                            'email': profile_info.get('user_name', '')
                        })
            except Exception as e:
                print(f"Error reading local state: {e}")
                
        # If we couldn't parse Local State, fallback to directory listing
        if not profiles:
            if os.path.isdir(os.path.join(user_data_dir, 'Default')):
                 profiles.append({'dir_name': 'Default', 'name': 'Default', 'email': ''})
            for d in os.listdir(user_data_dir):
                 if d.startswith('Profile ') and os.path.isdir(os.path.join(user_data_dir, d)):
                      profiles.append({'dir_name': d, 'name': d, 'email': ''})
                      
    return jsonify({"profiles": profiles, "default_dir": user_data_dir})

@app.route('/api/start', methods=['POST'])
def start_automation():
    if automation_state["is_running"]:
        return jsonify({"error": "Automation is already running"}), 400
        
    req_data = request.json
    records = req_data.get('records', [])
    accounts = req_data.get('accounts', [])
    wait_ms = int(req_data.get('wait_ms', 1000))
    scheduled_time = req_data.get('scheduled_time', '')
    
    if not records or len(records) == 0:
         return jsonify({"error": "No records provided"}), 400
         
    if not accounts or len(accounts) == 0:
         return jsonify({"error": "At least one account is required"}), 400
         
    # Reset state
    automation_state["is_running"] = True
    automation_state["should_stop"] = False
    automation_state["logs"] = []
    automation_state["results"] = []
    
    # Run in background
    thread = threading.Thread(target=run_automation_wrapper, args=(records, accounts, wait_ms, scheduled_time))
    thread.start()
    
    return jsonify({"message": "Started automation"})

@app.route('/api/stop', methods=['POST'])
def stop_automation():
    if not automation_state["is_running"]:
        return jsonify({"error": "Automation is not running"}), 400
    automation_state["should_stop"] = True
    return jsonify({"message": "Stop requested"})

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "is_running": automation_state["is_running"],
        "should_stop": automation_state["should_stop"],
        "logs": automation_state["logs"],
        "results": automation_state["results"]
    })

def chunk_list(lst, n):
    k, m = divmod(len(lst), n)
    return [lst[i*k+min(i, m):(i+1)*k+min(i+1, m)] for i in range(n)]

def run_automation_wrapper(records, accounts, wait_ms, scheduled_time):
    try:
        # Load balance: chunk records evenly across accounts
        chunks = chunk_list(records, len(accounts))
        
        with ThreadPoolExecutor(max_workers=len(accounts)) as executor:
            for i, acc in enumerate(accounts):
                executor.submit(run_automation, chunks[i], acc.get('username'), acc.get('password'), wait_ms, automation_state, log_message, scheduled_time)
    except Exception as e:
        log_message(f"Fatal error: {str(e)}")
    finally:
        automation_state["is_running"] = False

if __name__ == '__main__':
    app.run(debug=True, port=5000)
