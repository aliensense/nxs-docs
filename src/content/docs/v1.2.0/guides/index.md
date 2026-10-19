---
title: Guides
sidebar:
  order: 0
slug: v1.2.0/guides
---

Each guide walks you through one setup, from the first command to a working result. It tells you what you need, the commands, the output you see, and what it means.

```d2 title="Guides at a glance"
vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

grid-columns: 3
grid-gap: 40

classes: {
  hw: {style: {fill: "#e3ecf7"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14}}
  open: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 2; font-size: 14}}
  data: {style: {fill: "#fff0c2"; stroke: "#b07a00"; stroke-width: 2; font-size: 14}}
  third: {style: {fill: "#ececec"; stroke: "#6b6b6b"; stroke-dash: 3; font-size: 14}}
  step: {style: {fill: "#ffffff"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14; border-radius: 6}}
  result: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 3; font-size: 15; bold: true}}
  group: {style: {fill: "#fafafa"; stroke: "#999"; font-size: 18}}
}

deploy: "1 · Jetson Orin Nano, JetPack 6.2.1 or 7.2.1" {
  class: group
  direction: down
  rig: "The Jetson alone\nnothing connected yet" {class: hw}
  guide: "NVIDIA Jetson deployment guide\nnxs, the kernel package, the assets, the buses" {class: step}
  agent: "… with an AI agent\nthe same tools from Claude Code" {class: open}
  rig -> guide -> agent
}

sensor: "4 · A Click the tool does not ship" {
  class: group
  direction: down
  rig: "A unit with your Click\nits datasheet, a workstation" {class: hw}
  guide: "Custom click personality\nwrite, run, calibrate, tune" {class: step}
  agent: "Custom click personality with an AI agent\nthe same, from a chat" {class: open}
  rig -> guide -> agent
}

unboxing: "2 · The NXS box and a Hub" {
  class: group
  direction: down
  rig: "Hub on CAM0, the unit on link A\nwith its FXOS8700 Click" {class: hw}
  guide: "Getting started with the NXS unit\nfirst samples in two minutes, the declaration" {class: step}
  agent: "Getting started with an AI agent\nthe same, from a chat" {class: open}
  rig -> guide -> agent
}

camera: "5 · A camera head the tool does not ship" {
  class: group
  direction: down
  rig: "A pod with your head on link A\nits datasheet and the vendor's register tables" {class: hw}
  guide: "Custom cam personality\nwrite the personality, bring the camera up" {class: step}
  agent: "Custom cam personality with an AI agent\nthe same, from a chat" {class: open}
  rig -> guide -> agent
}

dashboard: "3 · Two camera pods and two Clicks" {
  class: group
  direction: down
  rig: "Two IMX900 pods on one Hub\nan IAM20680 and an MS5611, Foxglove" {class: hw}
  guide: "Multi-sensor dashboard on ROS 2\nframe-synced, on one time axis" {class: step}
  agent: "Multi-sensor dashboard with an AI agent\nthe same, from a chat" {class: open}
  rig -> guide -> agent
}

read: "Read them in this order" {
  class: group
  direction: down
  note: "Every guide: what you need, the commands,\nthe output you see, and what it means" {class: result}
}
```

* [NVIDIA Jetson deployment guide](deploy-jetson/): install the `nxs` tool, the camera kernel package and the assets on a Jetson Orin Nano. Start its camera buses with stable names.
* [Getting started with the NXS unit](unboxing/): connect the Hub and your first unit, read its sensor, and declare the rig.
* [Multi-sensor dashboard on ROS 2](multi-sensor-dashboard/): two cameras and two sensors on one Hub, frame-synced, on one Foxglove time axis.
* [Custom click personality](custom-sensor/): write a click personality for a sensor from its datasheet, run it, calibrate it and tune it.
* [Custom cam personality](custom-camera/): write a cam personality from a datasheet and the vendor's register tables, and bring the camera up.

The same five, driven from Claude Code through the `nxs mcp` server:

* [NVIDIA Jetson deployment with an AI agent](deploy-jetson-mcp/)
* [Getting started with an AI agent](unboxing-mcp/)
* [Multi-sensor dashboard with an AI agent](multi-sensor-dashboard-mcp/)
* [Custom click personality with an AI agent](custom-sensor-mcp/)
* [Custom cam personality with an AI agent](custom-camera-mcp/)
