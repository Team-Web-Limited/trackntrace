import frappe
from tnt_seal_management.tnt_seal_management.api.seal_api_client import get_api_settings, generate_access_token
import requests
import json

def test_api():
    settings, password = get_api_settings()
    token = generate_access_token(force=True)
    
    base_url = settings.api_base_url.rstrip("/")
    url = f"{base_url}/api/v2/vehicle/current-tracking"
    
    payload = {
        "filterType": "USER_WISE",
        "token": token
    }
    
    print(f"Calling API: {url}")
    resp = requests.post(url, json=payload)
    print(f"Status Code: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print("Response data keys:", data.keys())
        
        # Check for sub-locks
        found_sublocks = False
        if "data" in data:
            for item in data["data"]:
                if item.get("slaveLocks"):
                    print("\nFound a seal with slaveLocks:")
                    print(json.dumps(item, indent=2))
                    found_sublocks = True
                    break
        if not found_sublocks:
            print("\nNo seal found with slaveLocks.")
            if "data" in data and len(data["data"]) > 0:
                print("First record:")
                print(json.dumps(data["data"][0], indent=2))
    else:
        print(f"Error: {resp.text}")

