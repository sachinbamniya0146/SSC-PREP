#!/usr/bin/env python3
"""Meilisearch integration verification - 7 checks"""
import json, re, sys, urllib.request, urllib.error

env = open('/Users/sachin/ssc-prep-hub/backend/.env').read()
email = re.search(r'^ADMIN_DEFAULT_EMAIL=(.+)$', env, re.M).group(1).strip().strip('"')
pwd = re.search(r'^ADMIN_DEFAULT_PASSWORD=(.+)$', env, re.M).group(1).strip().strip('"')

def api(path, method="GET", token=None, body=None):
    BASE = "http://localhost:4000/api/v1"
    req = urllib.request.Request(BASE + path, method=method)
    if token: req.add_header("Authorization", "Bearer " + token)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode(errors="ignore"))

print("=== MEILISEARCH VERIFICATION ===\n")

st, login = api("/auth/login", "POST", body={"email": email, "password": pwd})
tok = login.get("accessToken", "")
checks = []

# 1. Meilisearch health
st, res = api("/health")
checks.append(("Meilisearch backend health", st == 200 and res.get("status") == "ok"))

# 2. Public search works (no auth)
st, res = api("/search?q=mathematics&limit=3")
checks.append(("Public search endpoint", st == 200 and "hits" in res))

# 3. Search returns results
st, res = api("/search?q=mathematics&limit=3")
checks.append(("Search returns hits", st == 200 and res.get("estimatedTotalHits", 0) > 0))

# 4. Admin reindex works
st, res = api("/search/reindex", "POST", token=tok)
checks.append(("Admin reindex", st == 201 and res.get("success") == True))

# 5. Indexed count matches DB (13569 questions)
st, res = api("/search/reindex", "POST", token=tok)
total = res.get("totalIndexed", 0)
checks.append(("Reindex count matches DB", total == 13569))

# 6. Search stats endpoint
st, res = api("/search/stats", token=tok)
checks.append(("Search stats endpoint", st == 200 and "numberOfDocuments" in res))

# 7. Stats show documents > 0
checks.append(("Index has documents", st == 200 and res.get("numberOfDocuments", 0) > 10000))

print()
passed = sum(1 for _, ok in checks if ok)
for i, (name, ok) in enumerate(checks, 1):
    print(f"  {i}. {'PASS' if ok else 'FAIL'} - {name}")
print(f"\n=== {passed}/{len(checks)} PASSED ===")
sys.exit(0 if passed == len(checks) else 1)