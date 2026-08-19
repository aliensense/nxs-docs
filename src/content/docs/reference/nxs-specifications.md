---
title: "NXS — Technical Specifications"
sidebar:
  order: 1
# Mirrored from the firmware repository (docs/specs/nxs-specifications.md) at pre-release v1.0.0-rc1-193-g3e0ac604d (3e0ac604d).
# Do not edit here — changes flow through the next release.
---

Applies to: NXS v1.0 · product version 1.0.x

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, supported sensors, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Driver Development Guide](../nxs-driver-development/) | authoring drivers for unsupported sensors |
| [FAQ](../nxs-faq/) | frequently asked questions |
| **Technical Specifications** (this document) | capability summary tables |

## Overview

NXS is a sensor connector module that gives robotics teams plug-and-play access to the mikroBUS Click sensor ecosystem. It sits inline on a GMSL camera link, so sensor data rides the existing coax alongside the video, readable as an I²C register map with no extra wiring. Prefer a bus? The same board is a standard Cyphal node over CAN-FD or serial, decodable with stock OpenCyphal tooling. Either way, measurements arrive in SI units — scaled on-device from the sensor's datasheet, with optional per-unit calibration and mounting-orientation alignment for inertial sensors — self-described per field, so a host reads them with no sensor-specific code and maps them onto standard ROS 2 topics with the bundled bridge.

## System

| Parameter | Spec |
|---|---|
| Compute | STM32G491 (Cortex-M4F @ 160 MHz), 512 KB flash, 112 KB SRAM |
| Status indicator | Green status LED — moving-pattern state ladder (idle / measuring / sensor-not-answering / driver fault) plus a host-triggered identify strobe (`nxs identify`); a static LED always means firmware not executing |
| Product versioning | MAJOR.MINOR.PATCH — MAJOR: host-facing contract change (requalify); MINOR: driver image format moved (rebuild driver images); PATCH: drop-in. All contract versions self-reported at runtime |

## Connectivity

| Parameter | Spec |
|---|---|
| Upstream link to compute | CAN-FD (up to 40 m at reduced data-phase bit rate) and/or GMSL3/2 (up to 15 m) — CAN-FD carries Cyphal sensor data; GMSL carries video + the tunnelled I²C register map |
| GMSL3/2 link | Single coax cable carries power (POC), multi-Gbps video, and sensor data (tunnelled I²C) |
| Host interfaces | I²C register map (address `0x30`) over the GMSL tunnel or direct · Cyphal/CAN-FD · Cyphal/serial (460800 baud, 8N1) |
| CAN | Selectable bit timing — CAN-FD (1 Mbit/s arbitration / 4 Mbit/s data, sample points 0.875 / 0.750; default) or Classic / lower-rate profiles to match an existing bus; the host interface must match the selected profile. On-board split termination, software-switched per unit (off by default) |
| Sensor-side interface | mikroBUS socket — sensors attach over I²C (400 kHz), SPI, or UART; drivers can also sample the AN pad and drive the PWM pad; RST and INT are driver-managed |
| Image sensor mezzanine | DF40 60-pin, MIPI CSI-2 (2 or 4 data lanes) |
| Timestamping | Microsecond-resolution per-sample timestamps (local clock); a two-way sync surface on every transport translates them into host time with bounded error |

The I²C register map is complete on its own — samples, parameters, driver store, commissioning, and firmware update — so a sensor added to an existing GMSL camera link needs no additional bus or protocol. Cyphal adds networked, multi-node access on the same firmware.

## Sensor pipeline

| Parameter | Spec |
|---|---|
| Driver model | Compiled driver images executed by an on-device VM; upload, swap, and re-tune at runtime — no firmware rebuild |
| Acquisition | Direct register reads or the sensor's on-chip FIFO (tear-free high-rate capture); analog capture and PWM drive on the mikroBUS pads |
| Output | SI units — datasheet-nominal scaling on-device, plus the part's own compensation math where its datasheet defines it; self-describing per-field descriptors (name, type, scale, offset, unit, semantic) readable from the device |
| Calibration | Optional per-unit calibration (accelerometer / gyroscope / magnetometer vectors, encoder zero-offset) and mounting-orientation alignment — host-guided (`nxs calibrate`), persisted on the board, applied in the SI tier; the raw stream stays unmodified |
| Parameters | Runtime-settable, device-validated: enumerated value sets or `[min, max]` ranges; live parameters apply without interrupting sampling |
| Communication profiles | Up to 3 per driver image — a dual-bus sensor (I²C + SPI) switches bus by parameter write, no re-upload |
| Sample window | ≤ 128 bytes per sample (≤ 110 over the I²C sample record); up to 16 output fields per driver |
| Sample rate | Sensor-bound (up to 1 kHz); 250 Hz sustained over the serial link; configurable output decimation (device-wide + per-SI-subject) |
| Driver store | 8 flash slots; auto-load on boot, auto-advance to the next slot on probe failure |
| Multi-node | Host-commissionable node-ID (default 125, range 0–125) and subject-IDs, persisted on the board; multiple NXS per CAN-FD bus |

## Sensor drivers

A driver is a short, human-readable Python description of the sensor — the AI-agent skill generates it from the sensor's datasheet, an engineer reviews and modifies it directly, and the host tool compiles and uploads it at runtime. Eight hardware-validated drivers ship with the host package as worked examples; the driver-generation skill shipped with the product is the reference implementation of the authoring flow.

## Firmware update

| Parameter | Spec |
|---|---|
| Model | Dual-slot (A/B) with automatic rollback: a new image self-confirms after ~1 s of healthy execution or the previous firmware is restored |
| Integrity | Signed images; 3 s hardware watchdog; power-loss-safe swap |
| Delivery | Over any host transport (Cyphal standard file pull — works with stock tooling — or the I²C register map); serial recovery as last resort, armed remotely (`nxs recover`) |
| Release artifacts | Each release publishes the signed firmware image, the host tool (wheel + container image), and SHA-256 digests |

## Power

| Parameter | Spec |
|---|---|
| Power input | 12 V (4.7–16 V tolerant) |
| Sensor rails | 3.3 V and 5 V mikroBUS supplies (fused); sensor rail firmware-switched, power-cycled at driver bind; 1.8 V ↔ 3.3 V level translation on the image-sensor / serializer control domain |

## Mechanical

| Parameter | Spec |
|---|---|
| Dimensions | 30 × 40 × 28 mm (W × H × D) |
| Weight | 21 g |
| Housing | 6061 aluminum alloy |
| Mounting | 4 × M2 × 0.4, L3 |

<div style="page-break-after: always;"></div>

## Environmental & Ruggedness

| Parameter | Spec |
|---|---|
| Operating temperature | −40 °C to +85 °C (absolute maximum +105 °C) |
| Storage temperature | −40 °C to +125 °C |
| ESD protection | ±2 kV (human-body model, connectors); ESD-protected high-speed lanes |
| Protection | Automotive-grade CAN transceiver; surge protection on power input |

## Software

- `nxs` CLI and Python SDK — probe, upload and compile drivers, configure, stream decoded SI samples, manage the driver store, commission node/subject IDs (with CAN bit timing and termination), calibrate (`calibrate`, `set-orientation`), strobe the locate LED (`identify`), push firmware; same commands over I²C, Cyphal/serial, and Cyphal/CAN. Installs as one wheel via `uv tool install`
- Suite management — declare every unit (link, firmware pin, sensor panel) in one `suite.yaml`; `nxs suite apply` idempotently converges every unit, `status`/`scan --diff` report drift, `freeze` adopts live tuning back into the manifest
- Multi-node provisioning over the bus — compile a driver once to a file, serve it to many nodes over the standard Cyphal file protocol
- ROS 2 — the bundled host-side bridge (`nxs ros2`) maps the self-described SI fields onto standard ROS 2 topics; a newly added sensor appears on the right topic with no per-sensor wiring, with optional device-to-host time-synced stamps
- AI driver generation — drivers are authored against a public DSL, with AI-assisted generation from the sensor datasheet as the primary flow (any mikroBUS Click sensor on I²C / SPI / UART / AN / PWM)
- Cyphal node — standard SI output subjects (acceleration, angular velocity, magnetic field, temperature, pressure) decodable with stock OpenCyphal tooling (yakut / pycyphal), plus liveness heartbeat and device info

## Documentation

- The [Integration & Operation Manual](../nxs-integration-manual/) is the getting-started path; the [Interface Description](../nxs-host-interface/) is the normative contract (register map, Cyphal node model, commissioning); the [Device Reference](../nxs-device-reference/) carries limits and the supported-sensor catalog; drivers are authored per the [Driver Development Guide](../nxs-driver-development/); the [FAQ](../nxs-faq/) answers common questions.
- The NXS Datasheet (full electrical ratings, connector pinouts, mechanical, handling) and the product brochure are published on the product page.
