---
title: NXS — Technical Specifications
sidebar:
  order: 1
slug: v1.1.0/reference/nxs-specifications
---

Applies to: NXS v1.1 · product version 1.1.x

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, shipped personalities, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Click Personality Reference](../nxs-click-personalities/) | authoring personalities for unsupported sensors |
| [Cam Personality Reference](../nxs-cam-personalities/) | describing camera chains for `nxs cam` |
| [MCP Tool Reference](../nxs-mcp/) | operating and configuring through an AI agent |
| [FAQ](https://aliensense.github.io/nxs-docs/hardware/faq/) | frequently asked questions |
| [Glossary](../nxs-glossary/) | one word for each thing |
| **Technical Specifications** (this document) | capability summary tables |

## Overview

NXS is a sensor connector unit that gives robotics teams plug-and-play access to the mikroBUS Click sensor ecosystem. It sits inline on a GMSL camera link. Sensor data rides the existing coax alongside the video, readable as an I²C register map with no extra wiring. On a bus, the same board is a standard Cyphal node over CAN-FD or serial, decodable with stock OpenCyphal tooling. Either way, measurements arrive in SI units, scaled on-device from the sensor's datasheet, with optional per-unit calibration and mounting-orientation alignment for inertial sensors. Every field is self-described, so a host reads them with no sensor-specific code and maps them onto standard ROS 2 topics with the bundled bridge.

## System

| Parameter | Spec |
|---|---|
| Compute | STM32G491 (Cortex-M4F @ 160 MHz), 512 KB flash, 112 KB SRAM |
| Status indicator | Green status LED with a moving-pattern state ladder. The states: idle, one heartbeat per running job (measuring or camera up), sensor or camera head not answering, personality or camera-run fault. A host-triggered identify strobe (`nxs identify`). A static LED always means firmware not executing |
| Product versioning | MAJOR.MINOR.PATCH. A MAJOR step is a host-facing contract change, which needs a requalification. A MINOR step means the personality image format moved, so personality images are rebuilt. A PATCH step is drop-in. All contract versions self-reported at runtime |

## Connectivity

| Parameter | Spec |
|---|---|
| Upstream link to compute | CAN-FD, up to 40 m at a reduced data-phase bit rate, and/or GMSL3/2, up to 15 m. CAN-FD carries Cyphal sensor data. GMSL carries video + the tunnelled I²C register map |
| GMSL3/2 link | Single coax cable carries power over coax (POC), multi-Gbps video, and sensor data as tunnelled I²C |
| Host interfaces | I²C register map at address `0x30` over the GMSL tunnel or direct · Cyphal/CAN-FD · Cyphal/serial (460800 baud, 8N1) |
| CAN | Selectable bit timing. The default is CAN-FD, 1 Mbit/s arbitration / 4 Mbit/s data, sample points 0.875 / 0.750. Classic / lower-rate profiles match an existing bus, and the host interface must match the selected profile. On-board split termination, software-switched per unit (off by default) on hardware revisions that carry it. Earlier units terminate externally, see the [Device Reference](../nxs-device-reference/) |
| Sensor-side interface | mikroBUS socket. Sensors attach over I²C (Fast-mode, 330 kHz on the wire), SPI, or UART. Personalities can also sample the AN pad and drive the PWM pad. RST and INT are personality-managed |
| Image sensor mezzanine | DF40 60-pin, MIPI CSI-2 (2 or 4 data lanes) |
| Cam personality | The image sensor's register program, stored on the unit as a sealed VM image and run on the pod bus under the host's bus token. Modes, controls, and laws are served back to the host, so a deployed host carries no sensor source. Shipped for the Sony IMX900, global shutter, and IMX335, rolling shutter |
| Timestamping | Microsecond-resolution per-sample timestamps (local clock). A two-way sync surface on every transport translates them into host time with bounded error |

The I²C register map is complete on its own: samples, parameters, personality store, commissioning, and firmware update. A sensor added to an existing GMSL camera link needs no additional bus or protocol. Cyphal adds networked, multi-node access on the same firmware.

## Sensor pipeline

| Parameter | Spec |
|---|---|
| Personality model | Compiled personality images executed by an on-device VM. Upload, swap, and re-tune at runtime, with no firmware rebuild |
| Acquisition | Direct register reads, one burst per sample, stamped at the data-ready edge. Analog capture and PWM drive on the mikroBUS pads |
| Output | SI units, with datasheet-nominal scaling on-device, plus the part's own compensation math where its datasheet defines it. Self-describing per-field descriptors (name, type, scale, offset, unit, semantic) readable from the device |
| Calibration | Optional per-unit calibration (accelerometer / gyroscope / magnetometer vectors, encoder zero-offset) and mounting-orientation alignment. Host-guided with `nxs calibrate`, persisted on the board, applied in the SI tier. The raw stream stays unmodified |
| Parameters | Runtime-settable, device-validated: enumerated value sets or `[min, max]` ranges. Live parameters apply without interrupting sampling |
| Communication profiles | Up to 3 per personality image — a dual-bus sensor (I²C + SPI) switches bus by parameter write, no re-upload |
| Sample window | ≤ 128 bytes per sample (≤ 110 over the I²C sample record). Up to 16 output fields per personality |
| Sample rate | Sensor-bound, up to 1 kHz. 250 Hz sustained over the serial link. Configurable output decimation, device-wide + per-SI-subject |
| Personality store | 8 flash slots. Auto-load on boot, auto-advance to the next slot on probe failure |
| Multi-node | Host-commissionable node-ID (default 125, range 0–125) and subject-IDs, persisted on the board. Multiple NXS per CAN-FD bus |

## Click personalities

A click personality is a short, human-readable Python description of the sensor, with a YAML facts file beside it. The AI-agent skill generates it from the sensor's datasheet, and an engineer reviews and modifies it directly. The host tool compiles and uploads it at runtime. Eight hardware-validated click personalities ship with the host package as worked examples. The `nxs-generate-click-personality` skill shipped with the product is the reference implementation of the authoring flow.

## Firmware update

| Parameter | Spec |
|---|---|
| Model | Dual-slot (A/B) with automatic rollback: a new image self-confirms after ~1 s of healthy execution or the previous firmware is restored |
| Integrity | Signed images, a 3 s hardware watchdog and a power-loss-safe swap |
| Delivery | Over any host transport: the Cyphal standard file pull, which works with stock tooling, or the I²C register map. Serial recovery as last resort, armed remotely (`nxs recover`) |
| Release artifacts | Each release publishes the signed firmware image, the host tool (a wheel per host architecture), and SHA-256 digests |

## Power

| Parameter | Spec |
|---|---|
| Power input | 12 V (4.7–16 V tolerant) |
| Sensor rails | 3.3 V and 5 V mikroBUS supplies (fused). Sensor rail firmware-switched, power-cycled at personality bind. 1.8 V ↔ 3.3 V level translation on the image-sensor / serializer control domain |

## Mechanical

| Parameter | Spec |
|---|---|
| Dimensions | 30 × 40 × 28 mm (W × H × D) |
| Weight | 21 g |
| Housing | 6061 aluminum alloy |
| Mounting | 4 × M2 × 0.4, L3 |

<div style="page-break-after: always;" />

## Environmental & Ruggedness

| Parameter | Spec |
|---|---|
| Operating temperature | −40 °C to +85 °C (absolute maximum +105 °C) |
| Storage temperature | −40 °C to +125 °C |
| ESD protection | ±2 kV (human-body model, connectors), and ESD-protected high-speed lanes |
| Protection | Automotive-grade CAN transceiver, and surge protection on power input |

## Software

* `nxs` CLI and Python SDK. It probes, uploads and compiles personalities, configures, streams decoded SI samples and manages the personality store. It commissions node/subject IDs, with CAN bit timing and termination. It calibrates (`calibrate`, `set orientation`), strobes the locate LED (`identify`) and pushes firmware. The same commands run over I²C, Cyphal/serial, and Cyphal/CAN. Installs as one wheel via `uv tool install`
* Suite management: every unit (link, firmware pin, sensor panel) is declared in one `suite.yaml`. `nxs switch` idempotently converges every unit, and `nxs status` reports the declaration against the rig node by node. `nxs tune --freeze` adopts live tuning back into the declaration
* Multi-node provisioning over the bus — compile a personality once to a file, serve it to many nodes over the standard Cyphal file protocol
* ROS 2: the bundled host-side bridge (`nxs ros2`) maps the self-described SI fields onto standard ROS 2 topics. A newly added sensor appears on the right topic with no per-sensor wiring, with optional device-to-host time-synced stamps
* AI personality generation: personalities are authored against a public DSL, with AI-assisted generation from the sensor datasheet as the primary flow. It covers any mikroBUS Click sensor on I²C / SPI / UART / AN / PWM
* Cyphal node: standard SI output subjects (acceleration, angular velocity, magnetic field, temperature, pressure), decodable with stock OpenCyphal tooling such as yakut / pycyphal. Plus a liveness heartbeat and device info

## Documentation

* The guides on the documentation site, from the [NVIDIA Jetson deployment guide](https://aliensense.github.io/nxs-docs/guides/deploy-jetson/) on, are the getting-started path. The [Integration & Operation Manual](../nxs-integration-manual/) is the operating reference. The [Interface Description](../nxs-host-interface/) is the normative contract: the register map, the Cyphal node model, commissioning. The [Device Reference](../nxs-device-reference/) carries limits and the supported-sensor catalog. Click personalities are authored per the [Click Personality Reference](../nxs-click-personalities/), cam personalities per the [Cam Personality Reference](../nxs-cam-personalities/). The [FAQ](https://aliensense.github.io/nxs-docs/hardware/faq/) answers common questions.
* The NXS Datasheet (full electrical ratings, connector pinouts, mechanical, handling) and the product brochure are published on the product page.
