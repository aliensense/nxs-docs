---
title: "Multi-sensor dashboard with an AI agent"
sidebar:
  order: 9
---

When you finish this guide, your Jetson runs two frame-synced IMX900 cameras, an IMU and a barometer. You set them up from a chat with an AI agent. The agent writes the declaration, the one file that describes this rig, from the values `nxs` offers. You reboot your Jetson and open Foxglove yourself, because the agent has no tool for those.

```d2 title="Multi-sensor dashboard with an AI agent at a glance"
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
  workstation: "Workstation\nClaude Code" {class: third}
  jetson: "Jetson\nnxs mcp" {class: hw}
  hub: "NXS Hub on CAM0\nlinks A and B, one frame trigger" {class: hw}
  poda: "Pod A\nIMX900 head on an NXS unit\nIAM20680 Click, the IMU" {class: hw}
  podb: "Pod B\nIMX900 head on an NXS unit\nMS5611 Click, the barometer" {class: hw}
  laptop: "Laptop\nFoxglove" {class: third}
  workstation -> jetson: "ssh"
  jetson <-> hub: "CAM0"
  hub <-> poda: "coax, link A"
  hub <-> podb: "coax, link B"
  jetson <-> laptop: "websocket, port 8765"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Realize the declaration\nsuite_set · switch" {class: step}
  s2: "2. Check the port\nstatus port=cam0" {class: step}
  s3: "3. Sync the cameras and count the frames\nset sync fps=50 · capture frames=60" {class: step}
  s4: "4. Read the Clicks\nsamples unit=… count=3" {class: step}
  s5: "5. Build the dashboard\nros2 launch and Foxglove, by hand" {class: step}
  s6: "6. Park the port\noff port=cam0" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5 -> s6
}

have: "What you have" {
  class: group
  direction: down
  screen: "Four sources on one screen\nset up from a chat" {class: result}
  sync: "Both cameras on one frame trigger\nat 50 fps, with one gain" {class: result}
}
```

## What you need

- **Hardware**: the cameras and Clicks connected as in [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/). Two IMX900 camera pods sit on links A and B. An IAM20680 Click sits on pod A, an MS5611 Click on pod B. The Hub is the GMSL deserializer board on your Jetson's camera connector.
- **Agent**: a Claude Code session connected to your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/).
- **Console**: a keyboard and display, or a serial console, on your Jetson for the reboot.

## 1. Realize the declaration

Your declaration is the file `/etc/aliensense/suite.yaml`. Ask the agent to declare the rig and make the hardware match it:

```
Declare the Hub on cam0 with an IMX900 pod on each link at 1920x1080, frame-synced,
iam20680 at 250 Hz on pod A and ms5611 on pod B. Then realize the declaration and
tell me what changed.
```

The agent reads the knobs with `suite_get` and sets them in one `suite_set` call, a batch in `sets` that is saved once. Then it calls `switch` and reports its output. The boot table is the boot entry and the device tree overlays that make your Jetson boot with the declared port. It needs a reboot, and the agent asks you for it:

```
suite_get
suite_set  sets=["cam0:HUB=maxim,max96792a",
                 "cam0/A:CAM=framos,imx900", "cam0/A:POD=unit-cam0-a",
                 "cam0/B:CAM=framos,imx900", "cam0/B:POD=unit-cam0-b",
                 "cam0/A:mode=mode6_1920x1080_raw10", "cam0/B:mode=mode6_1920x1080_raw10",
                 "cam0:sync_source=fsync",
                 "unit-cam0-a:CLICK=iam20680", "unit-cam0-a:sample_rate=250",
                 "unit-cam0-b:CLICK=ms5611"]
switch

The declaration is saved and in tune. Both pods wait for the port to map their
aliases, which it does when it first comes up. The port's boot table is
installed. A reboot is needed before the port can come up: run sudo reboot,
then ask me for the status.
```

Reboot your Jetson. After the reboot, the `nxsd` daemon brings the port up on its own and builds the capture stack's configuration on the way, about two minutes. The capture stack is your Jetson's camera pipeline, from the kernel to the frames an application reads. The port is the camera connector of your Jetson that the Hub plugs into, here `cam0`.

## 2. Check the port

Ask the agent whether the port is up:

```
Is the camera port up as declared?
```

```
status  port=cam0

cam0: the Hub answers and the capture stack is ready. Link A runs framos,imx900 at
1920x1080 RAW10, 30.0 fps, up, on pod unit-cam0-a with its head answering; link B
the same on pod unit-cam0-b. Link A's capture session decides the pair's gain, and
nxsd copies it to link B every frame.
```

Both cameras are up as declared, each with its head answering. Frame sync is the trigger pulse from the Hub that starts every exposure on both heads at one rate. The declaration names frame sync and no rate, so the pair runs frame-synced at 30 fps, with one gain for both cameras.

If you see `preparing the capture stack`, the daemon is still building it. Wait as the agent asks, then ask for the status again. If `nxsd` copies no gain, `status` names the gap, `cam0/B: does not follow A (nxsd copies no gain for cam0)`, with `sudo systemctl restart nxsd` as the next command. Called without a port, `status` checks the whole declaration, the two Clicks included.

## 3. Sync the cameras and count the frames

Ask the agent to run the synced cameras at 50 fps and to count what arrives:

```
Run both cameras on their shared frame trigger at 50 fps, then capture 60 frames
from each link and tell me what arrived.
```

```
set      port=cam0  knob=sync  value=fsync  fps=50
capture  port=cam0  link=A  frames=60
capture  port=cam0  link=B  frames=60

The port runs fsync at 50 fps, one pulse per frame, and the pulse's low time
sets the exposure; the set verified 50.0 fps on both links. Link A delivered 60
of 60 frames at 50.0 fps, link B 60 of 60 at 50.0 fps.
```

Both cameras delivered every frame at 50 fps. On the two CSI lanes of `cam0` the synced pair runs at 30 and 50 fps. Under frame sync the trigger pulse sets the exposure, so you ask for a rate and no exposure. A shorter exposure needs a higher rate or less light.

`set` counts two seconds of frames on both links before it answers. If the pair does not deliver the rate, `nxs` refuses it with the rate each camera delivered and puts the previous sync back. On four lanes the pair runs at 60 fps. On two, `set` refuses 60 fps with the rates the pair delivered and puts the previous sync back. The agent passes the refusal on in the words of `nxs`.

The rate holds until the port comes up again, and the next boot brings it back at 30 fps. To keep 50 fps, ask the agent to set it in the declaration and apply it. It calls `suite_set` with `channel: cam0`, `field: sync_fps` and `value: 50`, then `switch`.

## 4. Read the Clicks

Each Click sits on an NXS unit. The unit is a small sensor computer that hands your Jetson the Click's samples in SI units. Ask for three samples from each unit:

```
Show me three samples from each unit.
```

```
samples  unit=unit-cam0-a  count=3
samples  unit=unit-cam0-b  count=3

unit-cam0-a (Iam20680, 250 Hz): accel_z reads gravity, the gyro is still.
unit-cam0-b (Ms5611): 101325 Pa, 297.4 K.
```

The IMU runs at 250 Hz, the `sample_rate` your declaration sets for it.

## 5. Build the dashboard

`nxsd` publishes the ROS 2 topics from boot once a `nxs switch` ran with ROS 2 sourced, as step 5 of the deployment guide does. Start the throttled copies and the Foxglove bridge from a terminal, the way [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/) builds the dashboard. The agent has no tool for `ros2` or for a window on your laptop. While the dashboard runs, you can still ask the agent for the port's status.

## 6. Park the port

When you are done, ask the agent to park the port:

```
Park the port.
```

```
off  port=cam0

cam0 is parked: the sensors are in standby and the capture output is gated off.
```

The next boot brings the port back, and so does the `on` tool.

## Next steps

- Write a click personality for a Click that `nxs` does not know yet, with the agent's help: [Custom click personality with an AI agent](../custom-sensor-mcp/).
- Run the same steps by hand in a terminal: [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/).
