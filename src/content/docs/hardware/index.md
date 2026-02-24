---
title: Hardware Overview
description: Identify RedBrain boards, understand where each board fits, and jump to board-specific documentation.
---

RedBrain hardware is designed as a modular stack so you can scale from a small stereo rig to a larger multi-camera + multi-sensor robot.

## Board Map

| Board | Label in docs | Core purpose |
|---|---|---|
| Orin carrier | Cerebrum | Hosts Jetson compute, system power, and backplane interfaces |
| Extension A | Thalamus A | Primary camera and CAN/SYNC breakout |
| Extension B | Thalamus B | Additional camera expansion and control |
| Sensor adapter | Axon | Camera-adjacent sensor expansion via mikroBUS |

## Choose a Board Page

- [Cerebrum Carrier Board](/hardware/cerebrum/)
- [Thalamus A](/hardware/thalamus-a/)
- [Thalamus B](/hardware/thalamus-b/)
- [Axon Sensor Adapter](/hardware/axon/)

## Before You Start

1. Record board serials and hardware revisions for your integration log.
2. Confirm connector orientation before mating mezzanine and coax links.
3. Route cables with strain relief before thermal and vibration tests.

:::note
Pinout-heavy references are centralized in [Connectors Reference](/reference/connectors/) to avoid duplication and mismatch.
:::
