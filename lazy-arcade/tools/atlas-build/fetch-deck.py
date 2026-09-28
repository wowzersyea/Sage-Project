import json, os, subprocess
from concurrent.futures import ThreadPoolExecutor
HERE=os.path.dirname(os.path.abspath(__file__))
CACHE=os.path.join(HERE,"cache"); os.makedirs(CACHE,exist_ok=True)
owned=json.load(open(os.path.join(HERE,"..","trait-ingest","data","owned_traits.json")))["owned_tokens"]
def get(item):
    tid,meta=item
    path=os.path.join(CACHE,f"{tid}.img")
    if os.path.exists(path) and os.path.getsize(path)>100_000: return tid,"cached"
    cid=meta["image"].replace("ipfs://","")
    for gw in ("https://ipfs.io/ipfs","https://dweb.link/ipfs"):
        subprocess.run(["curl","-sSL","--max-time","150","-o",path,f"{gw}/{cid}"],capture_output=True)
        if os.path.exists(path) and os.path.getsize(path)>100_000: return tid,"ok"
    return tid,"FAIL"
with ThreadPoolExecutor(max_workers=6) as ex:
    for tid,st in ex.map(get, sorted(owned.items(), key=lambda kv:int(kv[0]))):
        print(tid,st,flush=True)
