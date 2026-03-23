#!/usr/bin/env bash
set -euo pipefail

echo "[migrate] applying governance structure checks"
test -f .github/CODEOWNERS
test -d docs/governance
test -d docs/architecture
echo "[migrate] done"
