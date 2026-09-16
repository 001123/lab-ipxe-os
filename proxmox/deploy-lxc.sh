#!/usr/bin/env bash
# ==============================================================================
# Deploy lab-ipxe-os to Proxmox LXC Container
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LXC_IP="192.168.250.11"
LXC_PORT="80"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)

cd "$ROOT_DIR"

CLEAN_MODE=false
LXC_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --clean|--fresh|--simulate-release)
            CLEAN_MODE=true
            ;;
        *)
            LXC_ARGS+=("$arg")
            ;;
    esac
done

echo "======================================================================"
echo "  [1/5] Building standalone Linux x64 binary..."
echo "======================================================================"
bun run build:linux-x64

if [ ! -f "dist/lab-ipxe-os-linux-x64" ]; then
    echo "Error: dist/lab-ipxe-os-linux-x64 was not created."
    exit 1
fi
echo "[OK] Standalone Linux x64 binary created successfully."

echo ""
echo "======================================================================"
echo "  [2/5] Creating / Ensuring LXC container on Proxmox..."
echo "======================================================================"
if [ ${#LXC_ARGS[@]} -gt 0 ]; then
    bun run proxmox/create-lxc.ts "${LXC_ARGS[@]}"
else
    bun run proxmox/create-lxc.ts
fi

echo ""
echo "======================================================================"
echo "  [3/5] Waiting for LXC network & SSH service on $LXC_IP..."
echo "======================================================================"
MAX_RETRIES=30
RETRY_COUNT=0
until ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "echo 'SSH Ready'" 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Error: Timed out waiting for SSH on root@$LXC_IP."
        exit 1
    fi
    echo -n "."
    sleep 2
done
echo " [OK] Connected to LXC container via SSH."

echo ""
echo "======================================================================"
echo "  [4/5] Deploying binary and assets to /opt/lab-ipxe-os..."
echo "======================================================================"
if [ "$CLEAN_MODE" = "true" ]; then
    echo "--> [MODE: Clean Release Simulation] Wiping state & applying GitHub Release layout (0 nodes)..."
    ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "
        systemctl stop lab-ipxe-os.service 2>/dev/null || true
        rm -rf /opt/lab-ipxe-os/data /opt/lab-ipxe-os/config /opt/lab-ipxe-os/public
        mkdir -p /opt/lab-ipxe-os/{config,data,assets,logs}
        if ! command -v bsdtar >/dev/null 2>&1; then
            echo '--> Installing libarchive-tools, p7zip-full, curl on LXC...'
            apt-get update -qq && apt-get install -y -qq libarchive-tools p7zip-full curl file >/dev/null
        fi
    "

    echo "--> Copying standalone binary..."
    scp "${SSH_OPTS[@]}" dist/lab-ipxe-os-linux-x64 "root@$LXC_IP:/opt/lab-ipxe-os/lab-ipxe-os"
    ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "chmod +x /opt/lab-ipxe-os/lab-ipxe-os"

    echo "--> Copying release package configuration (README, config/examples, hosts.yaml.example)..."
    scp "${SSH_OPTS[@]}" README.md "root@$LXC_IP:/opt/lab-ipxe-os/"
    if [ -d "config/examples" ]; then
        scp "${SSH_OPTS[@]}" -r config/examples "root@$LXC_IP:/opt/lab-ipxe-os/config/"
    fi
    if [ -f "config/examples/hosts.ubuntu.yaml" ]; then
        scp "${SSH_OPTS[@]}" config/examples/hosts.ubuntu.yaml "root@$LXC_IP:/opt/lab-ipxe-os/config/hosts.yaml.example"
    fi
else
    echo "--> [MODE: Lab / Dev] Deploying with local workspace configuration & public assets..."
    ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "
        systemctl stop lab-ipxe-os.service 2>/dev/null || true
        mkdir -p /opt/lab-ipxe-os/{config,data,assets,logs}
        if ! command -v bsdtar >/dev/null 2>&1; then
            echo '--> Installing libarchive-tools, p7zip-full, curl on LXC...'
            apt-get update -qq && apt-get install -y -qq libarchive-tools p7zip-full curl file >/dev/null
        fi
    "

    echo "--> Copying binary..."
    scp "${SSH_OPTS[@]}" dist/lab-ipxe-os-linux-x64 "root@$LXC_IP:/opt/lab-ipxe-os/lab-ipxe-os"
    ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "chmod +x /opt/lab-ipxe-os/lab-ipxe-os"

    echo "--> Copying public web assets..."
    scp "${SSH_OPTS[@]}" -r public "root@$LXC_IP:/opt/lab-ipxe-os/"

    echo "--> Copying config..."
    if [ -f "config/hosts.yaml" ]; then
        scp "${SSH_OPTS[@]}" config/hosts.yaml "root@$LXC_IP:/opt/lab-ipxe-os/config/hosts.yaml"
    else
        scp "${SSH_OPTS[@]}" config/hosts.example.yaml "root@$LXC_IP:/opt/lab-ipxe-os/config/hosts.yaml"
    fi
fi

echo "--> Setting up systemd service (lab-ipxe-os.service)..."
ssh "${SSH_OPTS[@]}" "root@$LXC_IP" "cat << 'EOF' > /etc/systemd/system/lab-ipxe-os.service
[Unit]
Description=Lab iPXE and Cloud-Init Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/lab-ipxe-os
ExecStart=/opt/lab-ipxe-os/lab-ipxe-os --port ${LXC_PORT} --base-url http://${LXC_IP}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now lab-ipxe-os.service
sleep 2
systemctl status lab-ipxe-os.service --no-pager
"

echo ""
echo "======================================================================"
echo "  [5/5] Verifying deployment & HTTP endpoints..."
echo "======================================================================"
echo "1. Dashboard (http://$LXC_IP/):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" "http://$LXC_IP/"

echo "2. iPXE Boot Script (http://$LXC_IP/boot.ipxe):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" "http://$LXC_IP/boot.ipxe"

echo "3. iPXE Boot Script Alias (http://$LXC_IP/ipxe/boot.ipxe):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" "http://$LXC_IP/ipxe/boot.ipxe"

echo "4. Hosts API (http://$LXC_IP/api/hosts):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" "http://$LXC_IP/api/hosts"

TOTAL_NODES=$(curl -s "http://$LXC_IP/api/nodes" | (grep -o '"mac"' || true) | wc -l | tr -d ' ')
echo "5. Registered Nodes in SQLite inventory: ${TOTAL_NODES} node(s)"

echo ""
echo "======================================================================"
echo "  🎉 Deployment Complete!"
echo "  Dashboard URL:       http://$LXC_IP/"
echo "  iPXE Boot Script:    http://$LXC_IP/boot.ipxe"
echo "  iPXE Alias:          http://$LXC_IP/ipxe/boot.ipxe"
echo "======================================================================"
