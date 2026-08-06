---
title: Overview
sidebar:
  order: 1
---

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

The documentation set splits the same way:

- [Install](../install/) puts the host tool on your machine
  and makes first contact with the unit.
- The [Hardware](../../hardware/product-description/) section is the physical
  reference: boards, connectors, electrical characteristics, mechanical.
- The reference set is the released
  specification set — the host interface (registers, commands,
  procedures), the integration and operation manual, and the driver
  development guide. It is mirrored from the firmware release, so it
  always matches the firmware you run.
