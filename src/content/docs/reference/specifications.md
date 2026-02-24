---
title: Consolidated Specifications
description: Key dimensions, power expectations, environment targets, and functional capabilities per RedBrain board.
---

## Board-Level Specifications

| Board | Dimensions | Typical role | Camera capacity | Power notes | Temp target |
|---|---|---|---|---|---|
| Cerebrum | 90 mm x 90 mm | Jetson carrier and system control | Via Thalamus modules | 12 V nominal system input | -40 C to +85 C |
| Thalamus A | 30 mm x 90 mm | Primary camera + field I/O extension | 2x GMSL | Powered from carrier extension rails | -40 C to +85 C |
| Thalamus B | 30 mm x 90 mm | Camera expansion module | 4x GMSL | Powered from carrier extension rails | -40 C to +85 C |
| Axon | 26.5 mm x 26.5 mm | Sensor adapter for camera stack | N/A (sensor-side adapter) | Powered from camera stack rails | Integration-dependent |

## Platform Capacity (Common MVP Deployment)

| Capability | Typical value |
|---|---|
| Maximum connected cameras | Up to 6 (2 on Thalamus A + 4 on Thalamus B) |
| Supported compute modules | Jetson Orin Nano, Jetson Orin NX |
| Field buses | CAN-FD main and auxiliary |
| Time sync | MCU master clock with optional GNSS PPS alignment |
| Sensor expansion | mikroBUS via Axon |

## Notes

- Actual camera and sensor limits depend on Jetson performance profile and thermal headroom.
- Validate sustained performance in your final enclosure and power system.
