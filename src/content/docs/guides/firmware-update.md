---
title: Firmware Update
description: Update Thalamus and Axon firmware from Jetson using rb-fw-updater with verification and recovery guidance.
---

## What You'll Do

Use `rb-fw-updater` from the Jetson host to update Thalamus and Axon MCU firmware in a recoverable flow.

## What You Need

- Firmware bundle for your target release
- Stable power source (do not run from unstable bench supply)
- Access to Jetson shell on the target robot
- Maintenance window that allows temporary sensor downtime

## Step-by-Step

1. **Pre-checks**
   - Confirm current firmware versions.
   - Confirm expected target versions and release notes.
   - Ensure no active motion pipeline is running.

2. **Update Thalamus**
   - Run `rb-fw-updater` for Thalamus target.
   - Wait for completion and auto-reconnect confirmation.

3. **Update Axon (via Thalamus path)**
   - Run `rb-fw-updater` for Axon target.
   - Confirm update completion for each discovered Axon device.

4. **Reboot/restart services if required**
   - Apply post-update service restart procedure.

5. **Run health checks**
   - Confirm firmware versions.
   - Confirm cameras/sensors republish normally.

## Verify It Works

- New versions reported by device-info commands.
- No update-in-progress or bootloader-stuck status.
- Camera and sensor topics return at expected rates.

## Troubleshooting

### Update interrupted by power loss

- Re-run updater in recovery mode for affected target.
- Keep only one target in recovery at a time.

### Device not discovered by updater

- Check physical connectivity and board detection first.
- Validate that host permissions and services are healthy.

### Updated device does not return to normal runtime

- Retry with clean firmware bundle.
- Use documented recovery path for the specific board.

:::caution
Do not interrupt power during flash erase/write phases. If possible, use a UPS-backed bench setup for development updates.
:::

## Detailed Guide Coming Soon

This page will be expanded with:

- Expected updater command formats per board type
- Version compatibility matrix between Jetson service and MCU firmware
- Recovery mode wiring and operator checklist
