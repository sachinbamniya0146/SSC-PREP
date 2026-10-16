# UPDATE — SearXNG tune (chhoti VPS ke liye)
Problem: VPS load 5.6 + swap; SearXNG ke 15+ engines 6s timeout me sab timeout ho rahe the (0 results).
Fix: sirf 6 engines (duckduckgo, bing, google, brave, startpage, mojeek), timeout 12s/18s, 1 worker, backend ka searxng client timeout 25s.
Files: searxng/settings.yml, docker-compose.yml, docker-compose.prod.yml, backend/src/pyq-dates/pyq-date-search.service.ts
Migration: none.
Tested: tsc 0 errors, 106 tests pass, YAML parse OK. Not tested: real SearXNG on VPS.
