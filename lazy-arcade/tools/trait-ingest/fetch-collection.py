"""Full-collection trait counts via the project's own metadata API.

IPFS gateways cap out around a token a second and the directory tar truncates;
this endpoint serves the same JSON over plain HTTP, which makes true statistical
rarity (spec Sec. 5.2) actually computable instead of perpetually deferred."""
import json,os,subprocess,sys
from concurrent.futures import ThreadPoolExecutor
N=int(sys.argv[1]) if len(sys.argv)>1 else 10000
OUT="data/collection_traits.json"
have=json.load(open(OUT)) if os.path.exists(OUT) else {}
todo=[i for i in range(1,N+1) if str(i) not in have]
print(f"have {len(have)}, fetching {len(todo)}",flush=True)
def get(t):
    for _ in range(3):
        p=subprocess.run(["curl","-sS","--max-time","30",
            f"https://metadata.lazylionsnft.com/api/lazylions/{t}"],capture_output=True,text=True)
        try:
            d=json.loads(p.stdout)
            return t,{a["trait_type"]:a["value"] for a in d.get("attributes",[])}
        except Exception: pass
    return t,None
done=0
with ThreadPoolExecutor(max_workers=16) as ex:
    for t,tr in ex.map(get,todo):
        if tr: have[str(t)]=tr
        done+=1
        if done%500==0:
            print(f"  {done}/{len(todo)}",flush=True); json.dump(have,open(OUT,"w"))
json.dump(have,open(OUT,"w"))
print("total tokens with traits:",len(have))
