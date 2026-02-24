---
title: System Architecture
description: RedBrain topology, bus overview, and end-to-end data flow from cameras and sensors to ROS 2.
---

## Topology At a Glance

```text
+------------------+        +-------------------+
|   GMSL Cameras   |------->| Thalamus A / B    |
| (2 to 6 streams) |        | (STM32 + deser)   |
+------------------+        +---------+---------+
                                      |
                                      | CSI + control + CAN + sync (mezzanine)
                                      v
                           +----------+----------+
                           | Cerebrum Carrier    |
                           | Jetson Orin + STM32 |
                           +----------+----------+
                                      |
                                      | ROS 2 topics / Synapse control
                                      v
                           +----------+----------+
                           | Robot Stack         |
                           | VSLAM / Control     |
                           +---------------------+
```

![Cerebrum system connection diagram](../../../assets/diagrams/carrier.png)

## Data Flow

1. Cameras stream over GMSL into Thalamus deserializers.
2. Thalamus forwards CSI data to Jetson through the Cerebrum backplane.
3. Jetson-side drivers publish ROS 2 image and camera info topics.
4. Axon-attached sensors (IMU/GNSS) publish through RedBrain drivers.
5. VSLAM and control nodes consume synchronized streams for localization and motion.

## Bus Overview

| Bus / Link | Used for | Typical endpoints |
|---|---|---|
| GMSL | Camera video + tunneled control | Camera serializers <-> Thalamus |
| CSI-2 | High-speed image transport | Thalamus <-> Jetson (via Cerebrum) |
| CAN-FD | Robot communication | Thalamus/Cerebrum <-> vehicle bus |
| I2C (internal) | Module ID, control, expansion | Carrier MCU <-> Thalamus/Axon |
| Sync/PPS | Deterministic timing | Master MCU <-> extension MCUs <-> cameras |

## Timing Model

- One MCU acts as system timing master.
- Other MCUs synchronize to the master and correct drift.
- GNSS PPS is used when available to anchor system time.
- Camera trigger and sensor timestamps are aligned to synchronized timebase.

:::note
Run periodic sync diagnostics in long-duration tests. Good timing at minute 1 does not guarantee good timing at minute 30.
:::

## Where Synapse Fits

Synapse is the RedBrain control protocol between Jetson services and board MCUs. It is used to:

- Apply configuration changes
- Read board/link health
- Coordinate startup, reset, and update flows
- Expose state used by operator-facing tools
