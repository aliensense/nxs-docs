---
title: Axon Sensor Adapter
description: Camera-adjacent sensor adapter that adds mikroBUS expansion and sync-aware edge sensor control.
---

## What It Does

Axon is a compact sensor adapter placed in the camera stack. It bridges camera-adjacent signals and adds mikroBUS expansion for IMU/GNSS or other supported Click boards.

## Key Specs

| Item | Value |
|---|---|
| Form factor | 26.5 mm x 26.5 mm |
| Expansion | mikroBUS Shuttle 2x8 header |
| Controller | STM32G4 class MCU |
| Typical sensors | IMU and GNSS Click boards |
| Power model | Derived from camera stack rails |

## Typical Uses

- Add IMU close to camera baseline for improved fusion behavior.
- Swap GNSS modules without redesigning the full platform.
- Forward selected interrupt/sync events back through camera-side links.

## Supported Sensor Families (MVP scope)

- 6DOF IMU 23 Click (IIM-20670)
- 6DOF IMU Click (LSM6DS33)
- GNSS 7 Click
- GNSS RTK Click (ZED-F9P)

:::note
Detailed integration procedures are in [IMU Integration](/guides/imu-integration/) and [GNSS Setup](/guides/gnss-setup/).
:::

## Detailed Guide Coming Soon

This page will be expanded with:

- Mechanical stacking examples with serializer/camera combinations
- Axon-specific fault indicators and expected startup states
- Recommended cable and strain-relief patterns for field robots
