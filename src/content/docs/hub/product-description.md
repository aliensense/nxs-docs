---
title: "NXS Hub"
sidebar:
  order: 1
banner:
  content: |
    ⚠️ <b>Same-side (Type A) FFC cables only.</b> An opposite-side (Type D) cable mirrors the pinout and shorts the port — see the <a href="/nxs-docs/hub/datasheet/#62-mipi-csi-2-output--port-a-ffc">datasheet warning</a>.
# Mirrored from als-docs marketing/NXS Hub/NXS_Hub_Brochure.md by scripts/mirror-marketing.py - edit there, never here.
---

*Aliensense · Version v1.3 · 2026-08-20*

## Overview

The NXS Hub is a purpose-built interface module for modern vision systems that need to bridge remote camera links into a host-friendly CSI-2 environment. It brings together deserialization, power management, control handling, and protection in a compact form factor that is suitable for robotics, industrial sensing, and embedded vision applications.

Rather than forcing system designers to build separate camera-link conditioning and control infrastructure, the NXS Hub consolidates those functions into a single module. It accepts two GMSL inputs and makes them available through clean, structured output paths for downstream compute platforms.

## Key benefits

The NXS Hub simplifies integration at the boundary between camera hardware and embedded processing. It allows teams to focus on system behavior and application logic rather than low-level interconnect complexity.

- Reduces integration complexity for dual-camera systems
- Allows managing two video streams simultaneously   
- Allows selecting one of two output paths — FFC to a host, mezzanine to an embedded carrier.
- Supports long-reach GMSL transport with a compact receiver module
- Presents a clear CSI-2 output path for host processors
- Provides over-the-board control for reset, trigger, enable, and configuration signaling
- Includes power regulation and protection for reliable deployment

## Description

The product is well suited to applications where camera data must travel from remote locations to a central compute node without sacrificing signal integrity or increasing system complexity. Its modular interface approach makes it relevant for platforms that demand flexibility while still preserving a robust hardware foundation.

## Applications

- Autonomous mobile platforms
- Intelligent inspection systems
- Robotics and industrial automation
- Camera-intensive embedded products

## Positioning

The NXS Hub is a practical and scalable interface solution for systems that need a reliable bridge between GMSL camera transport and downstream CSI-2 processing.

## Documentation

- [Technical specifications](../specifications/)
- [Datasheet](../datasheet/) — ratings, interfaces, connectors and pinouts, mechanical
