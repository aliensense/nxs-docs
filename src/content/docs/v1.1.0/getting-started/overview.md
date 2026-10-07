---
title: Overview
sidebar:
  order: 1
slug: v1.1.0/getting-started/overview
---

NXS is a sensor co-processor module. It runs sensor drivers as sandboxed
bytecode on an on-device virtual machine and serves SI-unit samples to a
host over I²C, UART (Cyphal/serial), or CAN-FD (Cyphal/CAN). Drivers are
uploaded at runtime — no firmware rebuild per sensor — and every output
field is self-described, so a host decodes any sensor without
sensor-specific code. Any mikroBUS-attachable sensor with a datasheet is
a driver candidate: the SDK's driver-generation skill reads the
datasheet and produces a validated driver.

Working with NXS takes three pieces:

1. **An NXS unit** — the compute board, with a sensor on its mikroBUS
   socket or the built-in path to your camera's serializer. The hardware
   section covers connectors, power, and ratings.
2. **A host** — anything that speaks I²C, UART, or CAN-FD to the unit: a
   Jetson, an embedded Linux board, a dev machine with a USB-UART or
   USB-CAN adapter.
3. **The `nxs` host tool** — driver compile and upload, VM control,
   parameter access, sample streaming, driver store management, and
   firmware update. One wheel, all transports.

## Typical workflow

1. Install the `nxs` host tool — one wheel covers every transport.
2. Wire the unit and confirm it answers: `nxs probe`.
3. Upload a driver for your sensor: `nxs upload iam20680 --param sample_rate=250`.
4. Stream decoded SI samples: `nxs stream` — or consume them over Cyphal or the ROS 2 bridge.
5. Save the driver to a store slot; the unit auto-binds it on every boot.

## The documentation set

The documentation set splits the same way:

* [Install](../install/) puts the host tool on your machine
  and makes first contact with the unit.
* The [Hardware](../../hardware/product-description/) section is the physical
  reference: boards, connectors, electrical characteristics, mechanical.
* The reference set is the released
  specification set — the host interface (registers, commands,
  procedures), the integration and operation manual, and the driver
  development guide. It is mirrored from the firmware release, so it
  always matches the firmware you run.
