#!/usr/bin/env bash
# ==============================================================================
# Helper script to deploy/update lab-ipxe-os release to Proxmox LXC
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../../.." && pwd))"
cd "$ROOT_DIR"

SKIP_ASSETS=true
CLEAN_MODE=false
BUILD_MODE=false
TARGET_VERSION="latest"
EXTRA_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --with-assets|--sync-assets)
            SKIP_ASSETS=false
            ;;
        --no-assets|--skip-assets)
            SKIP_ASSETS=true
            ;;
        --clean|--fresh)
            CLEAN_MODE=true
            ;;
        --build|--local)
            BUILD_MODE=true
            ;;
        -v|--version)
            # Handled with next argument in loop
            ;;
        -v=*|--version=*)
            TARGET_VERSION="${arg#*=}"
            ;;
        *)
            if [[ "$arg" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]; then
                TARGET_VERSION="$arg"
            else
                EXTRA_ARGS+=("$arg")
            fi
            ;;
    esac
done

# If previous argument was -v or --version
while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-v" || "$1" == "--version" ]]; then
        TARGET_VERSION="$2"
        shift 2
    else
        shift
    fi
done

DEPLOY_CMD=(bash proxmox/deploy-lxc.sh)

if [ "$TARGET_VERSION" != "latest" ]; then
    DEPLOY_CMD+=(--version "$TARGET_VERSION")
fi

if [ "$SKIP_ASSETS" = "true" ]; then
    DEPLOY_CMD+=(--skip-assets)
fi

if [ "$CLEAN_MODE" = "true" ]; then
    DEPLOY_CMD+=(--clean)
fi

if [ "$BUILD_MODE" = "true" ]; then
    DEPLOY_CMD+=(--build)
fi

if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
    DEPLOY_CMD+=("${EXTRA_ARGS[@]}")
fi

echo "==> Executing: ${DEPLOY_CMD[*]}"
"${DEPLOY_CMD[@]}"
