#!/usr/bin/env bash
set -euo pipefail

CHECKPOINT="${1:-M3}"
echo "[rollback] checkpoint=${CHECKPOINT}"
echo "[rollback] restore branch protection and CI templates from prior commit if needed"
