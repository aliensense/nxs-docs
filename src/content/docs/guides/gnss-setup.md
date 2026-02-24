---
title: GNSS Setup
description: Configure GNSS and GNSS RTK Click modules on Axon and switch between them with minimal YAML changes.
---

## What You'll Do

Bring up GNSS on Axon mikroBUS and switch from baseline GNSS to RTK mode through a one-line config change.

## What You Need

- Axon with GNSS 7 Click or GNSS RTK Click (ZED-F9P)
- Clear sky view or GNSS simulator for validation
- Editable `rb_config.yaml`
- ROS 2 tools to inspect NavSat and status topics

## Step-by-Step

1. **Install GNSS module**
   - Power down, install the Click board on the configured slot, then power up.

2. **Set GNSS type in YAML**
   - Baseline mode: `gnss.type: gnss7_click`
   - RTK mode: `gnss.type: gnss_rtk_click`

3. **Apply config without reflashing**
   - Apply updated config and wait for GNSS driver restart.

4. **Check topics**
   - Verify `NavSatFix` topic is publishing.
   - For RTK module, verify RTK/fix-quality status topic updates.

## Verify It Works

- Position updates arrive at expected rate.
- Status reports indicate valid fix state.
- In RTK mode, correction/fix state transitions are visible.

## Troubleshooting

### No GNSS data

- Confirm module seating and antenna connection.
- Check sky view or signal simulation quality.
- Confirm YAML slot and driver selection.

### RTK status never improves

- Check correction source configuration.
- Verify antenna quality and baseline environment.
- Validate that RTK-specific parameters are set for your deployment.

:::note
Keep baseline and RTK profiles in version control so operators can switch quickly during demos.
:::
