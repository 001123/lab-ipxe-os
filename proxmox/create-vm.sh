#!/usr/bin/env bash
# ==============================================================================
# Proxmox VE Test VM Creation Script (Bash / Curl)
# ==============================================================================
set -euo pipefail

ENV_FILE="$(dirname "$0")/credentials.env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
else
    echo "[!] Warning: $ENV_FILE not found. Using default environment variables."
fi

PVE_HOST="${PVE_HOST:-https://127.0.0.1:8006}"
PVE_NODE="${PVE_NODE:-pve}"
PVE_TOKEN_ID="${PVE_TOKEN_ID:-}"
PVE_TOKEN_SECRET="${PVE_TOKEN_SECRET:-}"
PVE_BRIDGE="${PVE_BRIDGE:-vmbr0}"
PVE_STORAGE="${PVE_STORAGE:-local-lvm}"
PVE_INSECURE="${PVE_INSECURE:-true}"

CURL_FLAGS=("-s")
if [ "$PVE_INSECURE" = "true" ]; then
    CURL_FLAGS+=("-k")
fi

if [ -z "$PVE_TOKEN_ID" ] || [ -z "$PVE_TOKEN_SECRET" ]; then
    echo "Error: PVE_TOKEN_ID and PVE_TOKEN_SECRET must be set."
    echo "Please configure proxmox/credentials.env"
    exit 1
fi

AUTH_HEADER="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

create_vm() {
    local VMID="$1"
    local NAME="$2"
    local MAC="$3"
    local CORES="$4"
    local MEMORY="$5"
    local DISK_SIZE="$6"

    echo "=== Creating VM $VMID ($NAME) on Proxmox node $PVE_NODE ==="
    echo "MAC Address: $MAC (Configured for iPXE boot)"

    # Create VM via Proxmox REST API
    curl "${CURL_FLAGS[@]}" -X POST "${PVE_HOST}/api2/json/nodes/${PVE_NODE}/qemu" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d @- <<EOF
{
    "vmid": $VMID,
    "name": "$NAME",
    "cores": $CORES,
    "memory": $MEMORY,
    "bios": "ovmf",
    "efidisk0": "${PVE_STORAGE}:1,efitype=4m,pre-enrolled-keys=0",
    "scsihw": "virtio-scsi-pci",
    "scsi0": "${PVE_STORAGE}:${DISK_SIZE},discard=on,ssd=1",
    "net0": "virtio=${MAC},bridge=${PVE_BRIDGE}",
    "boot": "order=net0;scsi0",
    "agent": 1,
    "ostype": "l26"
}
EOF

    echo -e "\nVM $VMID created successfully."
}

TARGET="${1:-help}"

case "$TARGET" in
    ubuntu)
        create_vm 9001 "test-ubuntu-docker" "bc:24:11:00:24:04" 2 2048 20
        ;;
    talos)
        create_vm 9003 "test-talos-cp" "bc:24:11:00:14:00" 2 4096 30
        ;;
    suse-micro)
        create_vm 9004 "test-suse-micro" "bc:24:11:00:06:20" 2 2048 20
        ;;
    all)
        create_vm 9001 "test-ubuntu-docker" "bc:24:11:00:24:04" 2 2048 20
        create_vm 9002 "test-ubuntu-k8s" "bc:24:11:00:24:05" 2 4096 30
        create_vm 9003 "test-talos-cp" "bc:24:11:00:14:00" 2 4096 30
        create_vm 9004 "test-suse-micro" "bc:24:11:00:06:20" 2 2048 20
        ;;
    *)
        echo "Usage: $0 {ubuntu|talos|suse-micro|all}"
        exit 1
        ;;
esac
