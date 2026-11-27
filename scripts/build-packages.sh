#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root, even when called from another directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# Turbo builds dependencies first and skips packages without a build task.
# Additional Turbo options can be passed through, such as --force or --dry-run.
exec pnpm exec turbo run build --filter='./packages/*' "$@"
