---
title: "Custom cam personality with an AI agent"
sidebar:
  order: 11
---

A cam personality is the compiled program a unit runs for an image sensor. You write one for your own sensor and bring the sensor up on your Jetson, from a chat with an AI agent. The agent writes the personality with the skill on your workstation. It compiles the personality through the nxs tools on your Jetson, brings the camera up and counts its frames. You install the personality at the terminal, because the personality store is root-owned.

```d2 title="Custom cam personality with an AI agent at a glance"
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

connect: "What you connect" {
  class: group
  direction: down
  files: "Datasheet and\nthe vendor's setting file" {class: data}
  workstation: "Workstation\nClaude Code with the cam personality skill" {class: hw}
  mcp: "nxs mcp\nthe MCP server on your Jetson" {class: open}
  hub: "NXS Hub\nlinks A and B, on CAM0" {class: hw}
  pod: "Camera pod\nyour sensor head on an NXS unit" {class: hw}
  files -> workstation: "read by the skill"
  workstation -> mcp: "ssh"
  mcp <-> hub: "camera connector"
  hub <-> pod: "coax, link A"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Write the personality\n/nxs-generate-cam-personality, then scp" {class: step}
  s2: "2. Compile it on your Jetson\nupload with compile_only" {class: step}
  s3: "3. Install at the terminal\nnxs personality install" {class: step}
  s4: "4. Bring the link up and count frames\non, status, capture" {class: step}
  s5: "5. Declare the camera\nsuite_set, switch, reboot, status" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5
}

have: "What you have" {
  class: group
  direction: down
  stream: "Your sensor up on link A at 30 fps\n60 of 60 frames through the agent" {class: result}
  boot: "The declaration applied\nnxsd brings the port up at every boot" {class: result}
}
```

## What you need

- **Hardware**: your Jetson and the NXS Hub, set up as for [Custom cam personality](../custom-camera/). The Hub is the GMSL deserializer board on your Jetson's camera connector. It carries two coax links, A and B. nxs calls that connector a port, here `cam0`.
- **Camera pod**: your sensor on a camera pod, connected to link A. A camera pod is an NXS unit with the camera head it carries and its serializer. The NXS unit is a small sensor computer, and it runs the cam personality to program the sensor.
- **Declaration**: the pod declared as the unit `unit-cam0-a` in `suite.yaml`, with no camera node on it yet. `suite.yaml` is your declaration, the file that names each part of your rig as a node. It names the personality each unit runs and the settings it runs with.
- **Skill**: the cam personality skill and nxs on your workstation, installed as in [Custom cam personality](../custom-camera/).
- **Sensor files**: your sensor's datasheet and the vendor's setting file.
- **Agent**: Claude Code on your workstation, connected to nxs on your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/).
- **Time**: about an hour, plus the reboot.

Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson. You type each request to the agent in your Claude Code session.

## 1. Write the personality

In your Claude Code session, point the skill at the datasheet and the setting file, and name the personality:

```
/nxs-generate-cam-personality ./cam1-datasheet.pdf ./cam1_settings_v3.txt — name it cam1
```

The skill writes the `cam1/` directory, compiles it and prints its report card. Copy the directory to your Jetson:

```sh
host$ scp -r cam1 <user>@<jetson>:
```

## 2. Compile it on your Jetson

Ask the agent to compile the personality on your Jetson without touching a unit:

```
Compile cam1/cam1.py without touching a unit and tell me the budget.
```

The agent calls `upload` with `compile_only`:

```
upload  name=cam1/cam1.py  compile_only=true

Compiled Cam1: 109 B of bytecode of 4096, two parameters (action and mode),
a 458 B descriptor trailer of 4096.
```

The personality fits the unit: 109 B of bytecode out of 4096, and a 458 B descriptor trailer out of 4096.

## 3. Install at the terminal

The personality store on your Jetson is root-owned, so you install the personality at the terminal. Do it as [Custom cam personality](../custom-camera/) does: copy the directory to your Jetson and install it. The install asks for your password.

```sh
host$ scp -r cam1 <user>@<jetson>:
orin$ nxs personality install ./cam1
```

```
installed cam1 (cam) into /opt/aliensense/personalities/cam1; next: nxs <port> <link> on --sensor cam1
```

The personality sits in the store at `/opt/aliensense/personalities/cam1`, and every port offers it.

## 4. Bring the link up and count frames

With the personality installed, ask the agent to bring the link up and count frames:

```
Bring cam0 link A up on cam1, judge the port, and capture 60 frames.
```

```
on       port=cam0  link=A  sensor=cam1
status   port=cam0
capture  port=cam0  link=A  frames=60

on verified 30.0 fps on link A. Link A runs acme,cam1 at 1920x1080 RAW10, 30.0
fps, up, on pod unit-cam0-a with its head answering. It delivered 60 of 60 frames
at 30.0 fps.
```

The agent calls `on`, `status` and `capture` in turn. `on` counts two seconds of frames before it answers. A rate the link does not deliver comes back as a refusal with the rate it delivered. Link A runs your sensor at 30.0 fps on the pod, and all 60 frames arrived.

## 5. Declare the camera

Ask the agent to give link A its camera in your declaration, then to apply the declaration:

```
Declare acme,cam1 on cam0 link A in mode_full, apply the declaration and tell me
what changed.
```

```
suite_get
suite_set  sets=["cam0/A:CAM=acme,cam1", "cam0/A:mode=mode_full"]
switch

Link A declares acme,cam1 in mode_full beside pod unit-cam0-a, and the
declaration is in tune. Pod unit-cam0-a holds cam1. The port's boot table is
installed. A reboot is needed before the port can come up: run sudo reboot, then
ask me for the status.
```

The camera takes two knobs, the sensor and its mode, so the agent sets both in one `suite_set` call with `sets`. The declaration is saved once, with the previous file kept beside it. The pod already holds cam1, and `switch` installed the port's boot table. The port comes up only after a reboot, so reboot your Jetson with `sudo reboot`.

After the reboot, ask `Is cam0 up as declared?` and the agent reads the port through `status`. A capture through the agent then proves the frames arrive, as before.

## Next steps

- Do the same steps by hand, with the output nxs prints: [Custom cam personality](../custom-camera/).
- See what each tool touches and when it refuses, with worked prompts, in the [MCP Tool Reference](../../reference/nxs-mcp/).
