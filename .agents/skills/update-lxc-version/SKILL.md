---
name: update-lxc-version
description: >-
  Use this skill when the user asks to update, upgrade, or deploy the latest (or a specified) release version of lab-ipxe-os to the local Proxmox LXC container (192.168.250.11), or invokes /update-lxc-version.
---

# Update LXC Version

This skill automates deploying and updating `lab-ipxe-os` on the local Proxmox LXC container (`ipxe-server` at `192.168.250.11`).

## Workflow

### 1. Determine Target Version & Mode

Check the user's intent or arguments:
- **Latest GitHub Release (Default)**: Fetches the newest release tag from `001123/lab-ipxe-os`.
- **Specific Version**: E.g., `v0.0.9`, `--version v0.0.9`.
- **Local Build (`--build`)**: Compiles local TypeScript source with `bun run build:linux-x64` and pushes the artifact.
- **Clean Mode (`--clean`)**: Resets container state, wiping SQLite database and reinitializing clean layout.
- **Assets**: By default, asset syncing is skipped (`--skip-assets`) to ensure updates take only a few seconds. Use `--with-assets` or pass `--sync-assets` if ISO/kernel assets were modified.

### 2. Execute Deployment

Run the helper script from the workspace root:

```bash
# Update to latest GitHub release (fast, skips asset re-sync)
bash .agents/skills/update-lxc-version/scripts/update.sh

# Or specify a particular version
bash .agents/skills/update-lxc-version/scripts/update.sh --version v0.0.9

# Or deploy from local source build
bash .agents/skills/update-lxc-version/scripts/update.sh --build

# Or perform a fresh reinstall
bash .agents/skills/update-lxc-version/scripts/update.sh --clean
```

Alternatively, invoke `proxmox/deploy-lxc.sh` directly:
```bash
bash proxmox/deploy-lxc.sh --version latest --skip-assets
```

### 3. Verify Deployment

Always perform post-deployment verification to guarantee the server is healthy:

1. **Check Installed Version via SSH:**
   ```bash
   ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 root@192.168.250.11 "/opt/lab-ipxe-os/lab-ipxe-os --version"
   ```
2. **Verify Systemd Service Status:**
   ```bash
   ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 root@192.168.250.11 "systemctl is-active lab-ipxe-os.service"
   ```
3. **Verify HTTP Endpoints:**
   - Dashboard: `curl -sI http://192.168.250.11/` (Expect HTTP 200)
   - iPXE Boot Script: `curl -sI http://192.168.250.11/boot.ipxe` (Expect HTTP 200)
   - Nodes API: `curl -s http://192.168.250.11/api/nodes` (Expect HTTP 200 JSON)
   - Public Client Script: `curl -sI http://192.168.250.11/public/js/dashboard.js` (Expect HTTP 200)

### 4. Report Results

Report the final version, service status, and dashboard URL to the user in a clear, concise summary.
