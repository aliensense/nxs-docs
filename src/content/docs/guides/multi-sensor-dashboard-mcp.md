---
title: "Multi-sensor dashboard with an AI agent"
sidebar:
  order: 9
---

When you finish this guide, your Jetson runs two frame-synced IMX900 cameras, an IMU and a barometer, and you set them up from a chat with an AI agent. You write the declaration, the one file that describes this rig. You also reboot your Jetson and open Foxglove yourself, because the agent has no tool for those.

## What you need

- **Hardware**: the cameras and Clicks connected to the Hub the way [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/) connects them: two IMX900 camera pods on links A and B, an IAM20680 Click on pod A and an MS5611 Click on pod B. The Hub is the GMSL deserializer board on your Jetson's camera connector.
- **Declaration**: the declaration that guide writes, in `/etc/aliensense/suite.yaml`.
- **Agent**: a Claude Code session connected to your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/).
- **Console**: a keyboard and display, or a serial console, on your Jetson for the reboot.

## 1. Realize the declaration

Ask the agent to make the hardware match your declaration:

```
Realize the declaration and tell me what changed.
```

The agent calls `switch` and reports its output. The boot table needs a reboot, and the agent asks you for it:

```
switch

Pod unit-cam0-a held no camera personality; imx900 is uploaded. The port's boot
table is installed. A reboot is needed before the port can come up: run
sudo reboot, then ask me for the status.
```

Reboot your Jetson. After the reboot, the `nxsd` daemon brings the port up on its own and builds the capture stack's configuration on the way, about two minutes. The port is the camera connector of your Jetson that the Hub plugs into, here `cam0`.

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

Both cameras are up as declared, each with its head answering. The declaration names frame sync and no rate, so the pair runs frame-synced at 30 fps, with one gain for both cameras. If you see `preparing the capture stack`, the daemon is still building it. Wait as the agent asks, then ask for the status again. If `nxsd` copies no gain, `status` names the gap, `cam0/B: does not follow A (nxsd copies no gain for cam0)`, with `sudo systemctl restart nxsd` as the next command. Called without a port, `status` checks the whole declaration, the two Clicks included.

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

Both cameras delivered every frame at 50 fps. On the two CSI lanes of `cam0` the synced pair runs at 30 and 50 fps. Under frame sync the trigger pulse sets the exposure, so you ask for a rate and no exposure. A shorter exposure needs a higher rate or less light. `set` counts two seconds of frames on both links before it answers: if the pair does not deliver the rate, `nxs` refuses it with the rate each camera delivered and puts the previous sync back. On four lanes the pair runs at 60 fps. On two, `set` refuses 60 fps with the rates the pair delivered and puts the previous sync back. The agent passes the refusal on in the words of `nxs`.

The rate holds until the port comes up again, and the next boot brings it back at 30 fps. To keep 50 fps, declare `sync: {source: fsync, fps: 50}` in `suite.yaml` and ask the agent to apply the declaration.

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

Start the ROS 2 topics and Foxglove from a terminal, the way [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/) publishes the topics and builds the dashboard. The agent has no tool for `ros2 launch` or for a window on your laptop. While the dashboard runs, you can still ask the agent for the port's status.

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

- Write a personality for a Click that `nxs` does not know yet, with the agent's help: [Custom sensor personality with an AI agent](../custom-sensor-mcp/).
- Run the same steps by hand in a terminal: [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/).
