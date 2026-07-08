#!/usr/bin/env python3
"""Split large driver/profile JSON shards into manageable chunks for CDN."""
import json, os, sys, math

CHUNK_SIZE_DRIVERS = 10000   # drivers per chunk (~3MB each)
CHUNK_SIZE_PROFILES = 2000   # profiles per chunk (~3MB each)

def split_drivers(input_path, out_dir, date):
    with open(input_path, 'r') as f:
        data = json.load(f)
    drivers = data.get('drivers', data) if isinstance(data, dict) else data
    if not isinstance(drivers, list):
        print(f"Unexpected drivers format for {date}: {type(drivers)}")
        return []
    
    n_chunks = math.ceil(len(drivers) / CHUNK_SIZE_DRIVERS)
    chunk_files = []
    for i in range(n_chunks):
        chunk = drivers[i * CHUNK_SIZE_DRIVERS : (i + 1) * CHUNK_SIZE_DRIVERS]
        fname = f"drivers-{date}-{i:03d}.json"
        fpath = os.path.join(out_dir, fname)
        with open(fpath, 'w') as f:
            json.dump({"mode": "chunk", "chunkIndex": i, "drivers": chunk}, f, ensure_ascii=False, separators=(',', ':'))
        chunk_files.append(fname)
        print(f"  {fname}: {len(chunk)} drivers, {os.path.getsize(fpath)/1024/1024:.1f} MB")
    return chunk_files

def split_profiles(input_path, out_dir, date):
    with open(input_path, 'r') as f:
        data = json.load(f)
    if not isinstance(data, dict):
        print(f"Unexpected profiles format for {date}: {type(data)}")
        return [], {}
    
    keys = sorted(data.keys())
    n_chunks = math.ceil(len(keys) / CHUNK_SIZE_PROFILES)
    chunk_files = []
    chunk_index = {}  # driverId -> chunk filename
    
    for i in range(n_chunks):
        chunk_keys = keys[i * CHUNK_SIZE_PROFILES : (i + 1) * CHUNK_SIZE_PROFILES]
        chunk_data = {k: data[k] for k in chunk_keys}
        fname = f"profiles-{date}-{i:03d}.json"
        fpath = os.path.join(out_dir, fname)
        with open(fpath, 'w') as f:
            json.dump(chunk_data, f, ensure_ascii=False, separators=(',', ':'))
        chunk_files.append(fname)
        for k in chunk_keys:
            chunk_index[k] = fname
        print(f"  {fname}: {len(chunk_keys)} profiles, {os.path.getsize(fpath)/1024/1024:.1f} MB")
    
    # Write chunk index
    index_fname = f"profiles-{date}-index.json"
    index_fpath = os.path.join(out_dir, index_fname)
    with open(index_fpath, 'w') as f:
        json.dump(chunk_index, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  {index_fname}: {len(chunk_index)} mappings, {os.path.getsize(index_fpath)/1024/1024:.1f} MB")
    
    return chunk_files, chunk_index

def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'dist/data'
    
    # Read drivers.json to find dates and files
    drivers_json_path = os.path.join(data_dir, 'drivers.json')
    with open(drivers_json_path, 'r') as f:
        drivers_index = json.load(f)
    
    if drivers_index.get('mode') != 'stable-static-split':
        print("Not in split mode, nothing to do.")
        return
    
    new_date_files = {}
    dates = drivers_index.get('dates', [])
    
    for date in dates:
        driver_file = os.path.join(data_dir, drivers_index['dateFiles'][date].replace('data/', '', 1))
        profile_file = os.path.join(data_dir, f"profiles-{date}.json")
        
        driver_size = os.path.getsize(driver_file) if os.path.exists(driver_file) else 0
        profile_size = os.path.getsize(profile_file) if os.path.exists(profile_file) else 0
        
        print(f"\nProcessing {date}:")
        print(f"  drivers: {driver_size/1024/1024:.1f} MB")
        print(f"  profiles: {profile_size/1024/1024:.1f} MB")
        
        # Split drivers if > 10MB
        if driver_size > 10 * 1024 * 1024:
            print(f"  Splitting drivers...")
            chunk_files = split_drivers(driver_file, data_dir, date)
            new_date_files[date] = {
                "mode": "chunked",
                "chunkFiles": [f"data/{cf}" for cf in chunk_files],
                "chunkSize": CHUNK_SIZE_DRIVERS,
                "totalDrivers": None  # will be filled
            }
            # Remove original large file
            os.remove(driver_file)
            print(f"  Removed original {drivers_index['dateFiles'][date]}")
        else:
            print(f"  Keeping drivers as-is (under 10MB)")
            new_date_files[date] = drivers_index['dateFiles'][date]
        
        # Split profiles if > 10MB
        if profile_size > 10 * 1024 * 1024 and os.path.exists(profile_file):
            print(f"  Splitting profiles...")
            chunk_files, chunk_idx = split_profiles(profile_file, data_dir, date)
            # Remove original large file
            os.remove(profile_file)
            print(f"  Removed original profiles-{date}.json")
        else:
            print(f"  Keeping profiles as-is (under 10MB)")
    
    # Update drivers.json index
    new_index = {
        "mode": "stable-static-split",
        "dates": dates,
        "totalDrivers": drivers_index.get('totalDrivers', 0),
        "dateFiles": {}
    }
    for date in dates:
        if isinstance(new_date_files[date], str):
            new_index['dateFiles'][date] = new_date_files[date]
        else:
            new_index['dateFiles'][date] = new_date_files[date]
    
    with open(drivers_json_path, 'w') as f:
        json.dump(new_index, f, ensure_ascii=False, separators=(',', ':'))
    print(f"\nUpdated drivers.json index")
    print(json.dumps(new_index, indent=2, ensure_ascii=False))
    
    # Report total size
    total = 0
    for root, dirs, files in os.walk(data_dir):
        for fn in files:
            total += os.path.getsize(os.path.join(root, fn))
    print(f"\nTotal data dir size: {total/1024/1024:.1f} MB")

if __name__ == '__main__':
    main()
