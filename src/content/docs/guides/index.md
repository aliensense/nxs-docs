---
title: "Guides"
sidebar:
  order: 0
---

Each guide walks you through one setup from the first command to a working result: what you need, the commands, the output you see, and what it means.

- [NVIDIA Jetson deployment guide](deploy-jetson/): install the `nxs` tool, the camera kernel package and the assets on a Jetson Orin Nano, and start its camera buses with stable names.
- [Getting started with the NXS unit](unboxing/): connect the Hub and your first unit, read its sensor, and write the rig's declaration.
- [Multi-sensor dashboard on ROS 2](multi-sensor-dashboard/): two cameras and two sensors on one Hub, frame-synced, on one Foxglove time axis.
- [Custom sensor personality](custom-sensor/): write a personality for a sensor from its datasheet, run it, calibrate it and tune it.
- [Custom camera personality](custom-camera/): write a camera personality from a datasheet and the vendor's register tables, and bring the camera up.

The same five, driven from Claude Code through the `nxs mcp` server:

- [NVIDIA Jetson deployment with an AI agent](deploy-jetson-mcp/)
- [Getting started with an AI agent](unboxing-mcp/)
- [Multi-sensor dashboard with an AI agent](multi-sensor-dashboard-mcp/)
- [Custom sensor personality with an AI agent](custom-sensor-mcp/)
- [Custom camera personality with an AI agent](custom-camera-mcp/)
