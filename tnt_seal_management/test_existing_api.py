import frappe
from tnt_seal_management.tnt_seal_management.api.seal_api_client import get_api_settings, generate_access_token, get_live_data
import requests
import json

def test_api():
    settings, password = get_api_settings()
    
    print("Calling existing API...")
    try:
        raw = get_live_data(sync_type="Manual Device Sync")
        print("Response received.")
        
        # Check for sub-locks
        found_sublocks = False
        
        # normalize
        from tnt_seal_management.tnt_seal_management.api.seal_sync import normalize_live_data_response
        records = normalize_live_data_response(raw)
        
        for rec in records:
            # check raw
            raw_rec = rec.get("_raw", {})
            if "slaveLocks" in raw_rec or "sublocks" in str(raw_rec).lower() or "slavelock" in str(raw_rec).lower():
                print("\nFound a seal with sublocks (or something similar):")
                print(json.dumps(raw_rec, indent=2))
                found_sublocks = True
                break
                
        if not found_sublocks:
            print("\nNo seal found with slaveLocks.")
            if records:
                print("First record raw:")
                print(json.dumps(records[0].get("_raw", {}), indent=2))
                
    except Exception as exc:
        print(f"Error: {exc}")

