---
title: Platform Overview
description: Understand RedBrain board types, system topology, and how modules connect before bring-up.
---

RedBrain is a modular stack for robotics compute, camera ingest, sensor expansion, and deterministic timing.

## What's In the Box

A typical RedBrain kit includes:

- 1x **Cerebrum** carrier board
- 1x **Thalamus A** (2-camera extension)
- 1x **Thalamus B** (4-camera extension)
- 1 or more **Axon** sensor adapters
- Camera serializer boards and GMSL camera modules
- Power, CAN/SYNC, and debug harnesses

:::note
Hardware kits vary by integration program. Confirm your BOM against your shipment manifest before assembly.
:::

## Board Types

| Board | Primary role | Typical interfaces | Common use |
|---|---|---|---|
| Cerebrum | Jetson carrier and system backplane | USB-C, Ethernet, M.2, mezzanine links, CAN-FD, sync | Hosts compute and orchestrates extension modules |
| Thalamus A | Main camera + bus extension | 2x GMSL camera links, CAN-FD connectors, sync outputs | Front camera pair + main field CAN |
| Thalamus B | Additional camera expansion | 4x GMSL camera links, CAN-FD, sync/control lines | Extra surround or multi-view cameras |
| Axon | Sensor adapter near camera stack | PixelMate pass-through, mikroBUS, local MCU | IMU/GNSS and edge sensor expansion |

## How They Connect

1. Jetson Orin Nano/NX mounts on **Cerebrum**.
2. **Thalamus A/B** connect over mezzanine links for CSI, CAN, power, and control.
3. GMSL cameras connect to Thalamus boards over coax.
4. **Axon** boards interface between camera and serializer stack, then expose mikroBUS sensor options.
5. ROS 2 nodes on Jetson publish camera, IMU, GNSS, and status topics for downstream autonomy.

## Communication Planes

- **High-speed data plane:** CSI/GMSL camera transport to Jetson.
- **Control plane:** Synapse messages and board control over internal buses.
- **Vehicle bus plane:** CAN-FD for robot and actuator integration.
- **Timing plane:** PPS/sync lines for consistent timestamping across MCUs and cameras.

:::note
For a visual topology and bus-level breakdown, continue to [System Architecture](/getting-started/architecture/).
:::
