---
title: "Aliensense NXS"
sidebar:
  order: 1
# Copied from als-docs marketing/NXS (NXS_Brochure.md) at 33bbb5e; update by PR here.
---

*v0.10 · 2026-08-18*

## Overview

NXS is a compact PCB that connects MikroElektronika Click sensors (mikroBUS) and MIPI cameras to your robot over a single long-distance cable. It handles the hardware interface, driver layer, and data transport — so the engineering team works with sensor data, not sensor wiring.

Two connection modes. Same board:

- **GMSL** — up to 15 m. Single coax carries power, video, and sensor data together. For camera + sensor setups where both need to run over one cable.
- **CAN-FD** — up to 40 m (at reduced data rate). Sensor data only. Longer reach, no video. For distributed sensor networks across a chassis or structure.

## Description

NXS sits between the sensor and the host computer. On the sensor side, it powers the Click board and MIPI camera and reads their output. On the host side, it publishes measurements in SI units over CAN-FD or serial, and serves the same data over an I²C register map — reachable directly or tunnelled through the GMSL link. Every field is self-described on the wire (name, unit, scale, semantic), so a host decodes any sensor with no sensor-specific code, using the bundled `nxs` tool or stock OpenCyphal tooling. The bundled bridge maps those self-described fields onto standard ROS 2 topics — a newly added sensor appears on the right topic with no per-sensor wiring.

Eight validated sensor drivers ship out of the box. Beyond those, a driver is a short, human-readable description of the sensor: the AI-agent skill writes it from the sensor's datasheet — for any mikroBUS Click sensor on I²C, SPI, UART, AN, or PWM — and an engineer, or an AI agent, can read and modify it directly. No firmware rebuild, no shipping the unit back.

## Key benefits

- A Click sensor, a MIPI camera, and power — one GMSL coax carries it all.
- Driver work is done before you plug in. The AI-agent skill handles driver generation.
- Two connection options: GMSL for camera + sensor over coax, CAN-FD for long-reach, sensor-only networks.
- Measurements arrive in SI units on the wire, self-described per field — no host-side conversion tables, and no sensor-specific decode code.
- Per-unit inertial calibration and mounting-orientation alignment — each unit corrected and its axes aligned to your robot's body frame on-device, applied to the SI output and persisted on the board.
- Standards-based output: read it with the bundled `nxs` tool or with stock OpenCyphal tooling (yakut / pycyphal) — no proprietary host stack to adopt.
- Remote firmware update and runtime reconfiguration — retune or re-flash in place, no field disassembly.
- SI fields map automatically onto standard ROS 2 topics — a new sensor lands on the right topic with no per-sensor wiring.
- Runs on 12 V (4.7–16 V tolerant) — no bench supply required in the field.
- Built for harsh environments: ESD protection, automotive-grade connectors, −40 °C to +85 °C operating range.
- Manages whole sensor suites: declare every unit in one manifest file; one command converges firmware, drivers, and network addresses — and reports drift.
- Glance-readable status LED on every unit — and `nxs identify` strobes one to pick it out of a rack of identical modules.

## Key specs

**Connectivity**

| Parameter | Spec |
|---|---|
| GMSL3/2 | Up to 15 m — single coax, power + video + sensor data |
| CAN-FD | Up to 40 m — sensor data, reduced data rate |
| Sensor interface | mikroBUS Click board socket |
| Image sensor | DF40 60-pin, MIPI CSI-2 |
| Timestamping | Per-board µs timestamps; host-time translation via the bridge's synced stamps |

**Hardware**

| Parameter | Spec |
|---|---|
| MCU | STM32G491 (Cortex-M4F @ 160 MHz) |
| Power input | 12 V primary (4.7–16 V tolerant) |
| Dimensions | 30 × 40 × 28 mm |
| Weight | 21 g |
| Housing | 6061 aluminum alloy |
| Operating temp | −40 °C to 85 °C |
| ESD protection | ±2 kV (human-body model) |

**Software**

| Component | Runs on | Detail |
|---|---|---|
| Cyphal node · I²C register map | NXS firmware | Standard SI subjects over CAN-FD / serial (460800 8N1); register map over the I²C tunnel |
| `nxs` CLI + Python SDK | Host | Probe · compile & upload drivers · stream samples · commission · update firmware |
| ROS 2 bridge | Host | Maps the self-described SI fields onto standard ROS 2 topics |
| AI driver generation | Host / dev | Writes a driver from the sensor datasheet — any Click sensor on I²C / SPI / UART / AN / PWM |
| Suite management | Host | One `suite.yaml` converges firmware, drivers, and addresses across every unit; drift reporting built in |

## Applications

NXS is relevant to any team that needs to place sensors or cameras away from the main compute unit — robotics, autonomous vehicles, industrial automation, research platforms. It removes the integration work between the sensor and the software stack, so the team focuses on what the sensor data is used for, not how to get it.

## Documentation

- [Technical specifications](../../reference/nxs-specifications/)
- [Datasheet](../datasheet/) — electrical ratings, connectors and pinouts, mechanical
- [FAQ](../../reference/nxs-faq/)
