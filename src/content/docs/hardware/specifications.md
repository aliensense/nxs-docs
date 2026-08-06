---
title: "Aliensense NXS: Technical Specifications"
sidebar:
  order: 3
# Copied from als-docs marketing/NXS (NXS_Specs.md) at 72b40d8; als-docs copy retires after the site review.
---

*v0.8 · 2026-08-05 · aligned to product version 1.0.x*

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

The full integration-grade documentation — register map, Cyphal node model, commissioning, driver DSL — is the released specification set in [the Reference section](../../reference/).

---

## Changes in v0.8 (vs v0.7)

GMSL naming policy: plain GMSL in prose; the Analog Devices term GMSL3/2 in spec/table rows and part-adjacent text (was GMSL2/3).

## Changes in v0.7 (vs v0.6)

Synced to the merged firmware and the calibration / ROS 2 branches. CAN row: default profile marked, software-switched per-unit termination (off by default) added. Calibration row: vector buckets named (accel / gyro / mag + encoder zero-offset), SI-tier application with the raw stream unmodified. Timestamping: two-way host time-sync surface. Sample window: ≤ 128 B (≤ 110 over the I²C sample record). CLI verbs: commissioning covers bit timing + termination; `calibrate` / `set-orientation` added; ROS 2 bridge named (`nxs ros2`) with synced stamps. Power input floor corrected to 4.7 V (merged from main).

## Changes in v0.6 (vs v0.5)

Overview and tables state the full 1.0 capability set. Selectable CAN bit timing (CAN-FD or Classic / lower-rate profiles) replaces the fixed-timing CAN row. Per-unit inertial calibration and mounting-orientation alignment added (Overview, a new Sensor-pipeline Calibration row); the "no per-unit calibration" wording retired. ROS 2 stated as descriptor-driven auto-mapping onto standard topics (Overview, Software bullet). Output-decode strengthened to "self-described per field, no sensor-specific code," and stock-OpenCyphal decode kept explicit. Feature statements are capability-level (outcomes, not procedures) so implementation specifics stay open.

## Changes in v0.5 (vs v0.4)

Review round. Sensor-window numbers corrected to the shipping VM caps (128-byte sample, up to 16 output fields — was 96 / 8). Overview reworded to separate the GMSL and Cyphal paths. `fleet` renamed to `suite` throughout; the two multi-unit software bullets grouped together. Added the status-LED System row (state ladder + identify strobe) and `identify` to the CLI verb list. Sensor drivers: eight hardware-validated drivers claimed; the generation skill named the reference implementation of the authoring flow (a standalone commented reference driver no longer ships). CAN row: the "configurable down to 2/1 Mbit/s or Classic CAN" claim removed — bit timing is fixed in the firmware. Output claims tightened to datasheet-nominal scaling plus per-driver datasheet compensation, no per-unit calibration (Overview + Output row).

## Changes in v0.4 (vs v0.1)

Aligned to the product 1.0.x release documentation. (v0.2/v0.3 were interim Drive-only iterations, folded in here; this repository is canonical from v0.4.)

- Overview corrected: ROS 2 topics come from the **host-side bridge** in the `nxs` tool — nothing ROS runs on the board; timestamps are local-clock microsecond, not network-synchronized ("hardware timestamps" claim removed).
- CAN-FD reach caveated: 40 m holds at a reduced data-phase bit rate; sample points and the configurable data rate added.
- Added **System** (160 MHz MCU, flash/SRAM, MAJOR.MINOR.PATCH compatibility promise), **Sensor pipeline**, **Sensor drivers** (the descriptive layer: AI-generated from the datasheet, human-modifiable; no fixed catalog claimed), and **Firmware update** sections.
- mikroBUS row: sensors attach over I²C, SPI, or UART; analog capture and PWM drive are driver-usable ("SLVS-EC class" removed — MIPI CSI-2 is the shipped interface).
- Software: `uv tool install` flow; **suite management** (`suite.yaml` manifest, apply/status/freeze, firmware pinning); AI driver generation restated as datasheet-in → driver-out against the public DSL (the earlier "natural-language configuration and diagnostics" claim removed); release artifacts named.
- Power: rails restated from the carrier design — fused 3.3 V / 5 V mikroBUS supplies, firmware-switched sensor rail; level translation is on the image-sensor/serializer domain (not "auto-switching for mixed-voltage Click boards").
- Added the released specification mirror (`firmware/`) as the normative reference.

---

*Aliensense · aliensense.com · support@aliensense.com · Specifications subject to change. For full electrical ratings, connector pinouts, and handling requirements, see the NXS Datasheet.*
