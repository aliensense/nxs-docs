---
title: Custom camera personality with an AI agent
sidebar:
  order: 11
slug: v1.1.0-rc2/guides/custom-camera-mcp
---

You will write a camera personality (the driver nxs uses for an image sensor) for your own sensor and bring the sensor up on your Jetson from a chat with an AI agent. The agent writes the personality with the skill on your workstation, compiles it through the nxs tools on your Jetson, brings the camera up and counts its frames. You install the personality at the terminal, because the personality store is root-owned.

## What you need

* **Hardware**: your Jetson and the NXS Hub, set up as for [Custom camera personality](../custom-camera/). The Hub is the GMSL deserializer board on your Jetson's camera connector, and it carries two coax links, A and B. nxs calls that connector a port, here `cam0`.
* **Camera pod**: your sensor on a camera pod, connected to link A. A camera pod is a sensor head on an NXS unit with its serializer. The NXS unit is a small sensor computer, and it runs the camera personality to program the sensor.
* **Declaration**: the pod declared as the unit `unit-cam0-a` in `suite.yaml`, with no `camera:` key yet. `suite.yaml` is your declaration, the file that names each unit on your rig, the personality it runs and the settings it runs with.
* **Skill**: the camera personality skill and nxs on your workstation, installed as in [Custom camera personality](../custom-camera/).
* **Sensor files**: your sensor's datasheet and the vendor's setting file.
* **Agent**: Claude Code on your workstation, connected to nxs on your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/).
* **Time**: about an hour, plus the reboot.

Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson. You type each request to the agent in your Claude Code session.

## 1. Write the personality

In your Claude Code session, point the skill at the datasheet and the setting file, and name the personality:

```
/nxs-generate-camera-personality ./cam1-datasheet.pdf ./cam1_settings_v3.txt — name it cam1
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

Compiled Cam1: 100 B of bytecode of 4096, one parameter (mode, two values), a
374 B descriptor trailer of 2048.
```

The personality fits the unit: 100 B of bytecode out of 4096, and a 374 B descriptor trailer out of 2048.

## 3. Install at the terminal

The personality store on your Jetson is root-owned, so you install the personality at the terminal, as [Custom camera personality](../custom-camera/) installs it: copy the directory to your Jetson and install it. The install asks for your password.

```sh
host$ scp -r cam1 <user>@<jetson>:
orin$ nxs personality install ./cam1
```

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

The agent calls `on`, `status` and `capture` in turn. `on` counts two seconds of frames before it answers, so a rate the link does not deliver comes back as a refusal with the rate it delivered. Link A runs your sensor at 30.0 fps on the pod, and all 60 frames arrived.

## 5. Declare the camera

Add the `camera:` key to link A in your `suite.yaml`, as in [Custom camera personality](../custom-camera/). Then ask the agent to apply the declaration:

```
Apply the declaration and tell me what changed.
```

```
switch

Pod unit-cam0-a holds cam1, in tune. The port's boot table is installed. A
reboot is needed before the port can come up: run sudo reboot, then ask me for
the status.
```

The pod already holds cam1, and `switch` installed the port's boot table. The port comes up only after a reboot, so reboot your Jetson with `sudo reboot`.

After the reboot, ask `Is cam0 up as declared?` and the agent reads the port through `status`. A capture through the agent then proves the frames arrive, as before.

## Next steps

* Do the same steps by hand, with the output nxs prints: [Custom camera personality](../custom-camera/).
* See what each tool touches and when it refuses, with worked prompts, in the [MCP Tool Reference](../../reference/nxs-mcp/).
