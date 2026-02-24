---
title: FAQ
description: Common RedBrain setup and integration questions about power, modules, cameras, sensors, temperature, and support.
---

## Which Jetson modules are supported?

RedBrain is designed for **Jetson Orin Nano** and **Jetson Orin NX** modules.

## What power supply should I use?

Use a stable 12 V class supply sized for Jetson mode, cameras, and attached peripherals. Always keep power margin for startup and peak compute load.

## How many cameras can I connect?

A common full stack supports up to **6 GMSL cameras** total: 2 on Thalamus A and 4 on Thalamus B.

## Which IMU and GNSS modules are supported?

In the MVP scope:

- 6DOF IMU 23 Click (IIM-20670)
- 6DOF IMU Click (LSM6DS33)
- GNSS 7 Click
- GNSS RTK Click (ZED-F9P)

## What operating temperature range is targeted?

Carrier and extension boards target industrial operation around **-40 C to +85 C** at board level. Final system limits also depend on enclosure, cooling, and power design.

## Can I switch sensors without reflashing firmware?

Yes, common camera/IMU/GNSS changes are intended to be handled by updating `rb_config.yaml` and applying live.

## How do I update Thalamus and Axon firmware?

Use the Jetson-side `rb-fw-updater` flow described in [Firmware Update](/guides/firmware-update/).

## Where can I find connector pinouts?

See [Connectors and Pinouts](/reference/connectors/).

## How do I get help?

1. Capture logs, config, and hardware topology.
2. Include the exact firmware and software versions.
3. Contact your RedBrain integration support channel with those artifacts.
