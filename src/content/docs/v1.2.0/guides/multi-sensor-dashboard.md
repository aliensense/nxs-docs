---
title: Multi-sensor dashboard on ROS 2
sidebar:
  order: 4
slug: v1.2.0/guides/multi-sensor-dashboard
---

When you finish this guide, your Jetson runs two IMX900 cameras, an IMU and a barometer on one NXS Hub. Both cameras are locked to one frame trigger. The Hub is the GMSL deserializer board on a camera connector of your Jetson, and it carries two coax links, A and B. You watch all four sources live on one screen in Foxglove on your laptop: both pictures, the acceleration and the pressure.

```d2 title="Multi-sensor dashboard on ROS 2 at a glance"
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
  laptop: "Laptop\nFoxglove, same network" {class: third}
  jetson: "Jetson\nJetPack 7.2.1, ROS 2 Jazzy" {class: hw}
  hub: "NXS Hub on CAM0\nlinks A and B, one frame trigger" {class: hw}
  poda: "Pod A\nIMX900 head on an NXS unit\nIAM20680 Click, the IMU" {class: hw}
  podb: "Pod B\nIMX900 head on an NXS unit\nMS5611 Click, the barometer" {class: hw}
  laptop <-> jetson: "websocket, port 8765"
  jetson <-> hub: "CAM0"
  hub <-> poda: "coax, link A"
  hub <-> podb: "coax, link B"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Connect the hardware\nClicks, coax, Hub on CAM0" {class: step}
  s2: "2. Declare and switch\nsuite.yaml or nxs tune --set · nxs switch · reboot" {class: step}
  s3: "3. Watch the streams\nnxs cam0 stream" {class: step}
  s4: "4. Sync the cameras\nnxs cam0 set sync fsync --fps 50" {class: step}
  s5: "5. Count the frames\nnxs cam0 capture --frames 60" {class: step}
  s6: "6. Publish the ROS 2 topics\nros2 launch … cameras:=true" {class: step}
  s7: "7. Build the dashboard\nFoxglove, four panels" {class: step}
  s8: "8. Park the port\nnxs cam0 off" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5 -> s6 -> s7 -> s8
}

have: "What you have" {
  class: group
  direction: down
  screen: "Four sources on one screen\nboth pictures, the acceleration, the pressure" {class: result}
  sync: "Both cameras on one frame trigger\nat 50 fps, with one gain" {class: result}
}
```

## What you need

* **Jetson**: set up with the [NVIDIA Jetson deployment guide](../deploy-jetson/), on JetPack 7.2.1.
* **Software**: ROS 2 Jazzy on your Jetson, from its Ubuntu packages as the [ROS 2 Jazzy installation guide](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html) describes. The base install, `sudo apt install ros-jazzy-ros-base`, is enough. The dashboard runs in Foxglove on your laptop, so the Jetson needs no ROS desktop tools.
* **Hub**: the NXS Hub and its power lead.
* **Camera pods**: two IMX900 camera pods, each with a coax to the Hub. A pod is an IMX900 camera head on an NXS unit with its serializer. The NXS unit is a small sensor computer. It runs a cam personality for the camera head and a click personality for the Click on its socket.
* **Clicks**: an IAM20680 Click, an IMU, for the socket of pod A. An MS5611 Click, a barometer, for the socket of pod B.
* **Laptop**: on the same network as your Jetson, for Foxglove.
* **Console**: a keyboard and display, or a serial console, on your Jetson for the reboot.
* **Time**: about an hour, most of it the reboot and the installs.

## 1. Connect the hardware

Each pod carries one Click and connects to one link of the Hub.

1. Seat each Click on its pod's socket. The IAM20680 goes on the pod for link A, the MS5611 on the pod for link B.
2. Run a coax from each pod to its link of the Hub, A and B.
3. Plug the Hub into CAM0.
4. Connect the Hub's power lead. The pods draw their power over the coax.

`nxs` calls each camera connector of your Jetson a port, and the Hub on CAM0 sits on port `cam0`. If your Hub is on CAM1, read `cam1` wherever you see `cam0`. Nothing else changes.

## 2. Declare and switch

Your declaration is one file, `suite.yaml`, that describes the whole rig as nodes and the connections between them. A node is one part of the rig: your Jetson, the Hub, a pod's unit, a camera head or a Click. Frame sync is the trigger pulse from the Hub that starts every exposure on both heads at one rate. This declaration names two frame-synced IMX900 heads at 1920x1080 with a pod on each link. Pod A carries an IMU and pod B a barometer:

```yaml
api: 3
nodes:
  host: {type: jetson}
  hub-cam0:
    type: 'maxim,max96792a'
    parameters: {csi_a_lanes: 2, sync_source: fsync}
  unit-cam0-a: {type: nxs}
  camera-cam0-a:
    type: 'framos,imx900'
    parameters: {mode: mode6_1920x1080_raw10}
  click-unit-cam0-a:
    type: iam20680
    parameters: {sample_rate: 250}
  unit-cam0-b: {type: nxs}
  camera-cam0-b:
    type: 'framos,imx900'
    parameters: {mode: mode6_1920x1080_raw10}
  click-unit-cam0-b: {type: ms5611}
connections:
  host.bus_cam0: [hub-cam0.i2c]
  hub-cam0.csi.A: [host.cam0]
  unit-cam0-a.out: [hub-cam0.links.A]
  camera-cam0-a.out: [unit-cam0-a.head]
  click-unit-cam0-a.out: [unit-cam0-a.click]
  unit-cam0-b.out: [hub-cam0.links.B]
  camera-cam0-b.out: [unit-cam0-b.head]
  click-unit-cam0-b.out: [unit-cam0-b.click]
```

A connection runs from a node's port to the ports it feeds. Each head feeds its pod's `head`, and each pod's `out` rides its link of the Hub. Each Click feeds its pod's socket, and the Hub's CSI output feeds your Jetson's `cam0`. Your Jetson runs the Hub over `bus_cam0`, the I²C bus beside `cam0`. The frame sync and the lanes are parameters of the Hub, the mode one of each head, and the IMU's rate one of its Click. The Hub's `csi_a_lanes: 2` matches the two CSI lanes of your Jetson's `cam0`.

`nxs describe <type>` prints the parameters a node of each type takes, with the values each accepts. Write the file to `/etc/aliensense/suite.yaml`, or declare the same rig with `nxs tune`. Each `--set` sets one knob: the Hub on `cam0`, each link's sensor, pod and mode, the frame sync, each pod's personality and the IMU's rate. `nxs tune` offers a pod on a link once it answers there, as your pods do since step 1:

```sh
nxs tune --set cam0:HUB=maxim,max96792a \
    --set cam0/A:CAM=framos,imx900 --set cam0/A:POD=unit-cam0-a \
    --set cam0/B:CAM=framos,imx900 --set cam0/B:POD=unit-cam0-b \
    --set cam0/A:mode=mode6_1920x1080_raw10 --set cam0/B:mode=mode6_1920x1080_raw10 \
    --set cam0:sync_source=fsync \
    --set unit-cam0-a:CLICK=iam20680 --set unit-cam0-a:sample_rate=250 \
    --set unit-cam0-b:CLICK=ms5611
```

```
set cam0:DECLARE:HUB = maxim,max96792a
set cam0/A:DECLARE:CAM = framos,imx900
set cam0/A:DECLARE:POD = unit-cam0-a
set cam0/B:DECLARE:CAM = framos,imx900
set cam0/B:DECLARE:POD = unit-cam0-b
set cam0/A:camera:mode = mode6_1920x1080_raw10
set cam0/B:camera:mode = mode6_1920x1080_raw10
set cam0:hub:sync_source = fsync
set unit-cam0-a:DECLARE:CLICK = iam20680
set unit-cam0-a:unit-cam0-a/iam20680:sample_rate = 250
set unit-cam0-b:DECLARE:CLICK = ms5611
IN TUNE ✓
```

Each `set` line is one knob, in the order of the batch, and `nxs tune` saved the file once. `IN TUNE` means the saved declaration holds on this hardware. The file holds the nodes and connections above, with each pod's serial as `nxs tune` read it. Over a declaration you already had, a `saved (backup …)` line names the copy `nxs tune` kept.

`nxs switch` makes the hardware match the file. It brings each pod to its declaration, installs the port's boot table and asks for the one reboot the boot table needs. The boot table is the boot entry and the device tree overlays that make your Jetson boot with the declared port.

A personality is the compiled program a unit runs for a sensor. A pod from the box holds no cam personality, so each pod gets the IMX900 personality once, and keeps it across power cycles. Source ROS 2 and run `nxs switch`, so the `nxsd` service carries the ROS 2 environment:

```sh
source /opt/ros/jazzy/setup.bash
nxs switch
```

```
cam0/A: pod unit-cam0-a does not answer at its alias 0x32; the port comes up to map it
cam0/B: pod unit-cam0-b does not answer at its alias 0x34; the port comes up to map it
cam0: boot table installed
cam0: installed /boot/camera-dtbos/tegra234-p3767-camera-p3768-aliensense_universal-cam0-2lane-overlay.dtbo
cam0: FDT /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb named in aliensense_gen: the boot entry it copies names /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb
cam0: boot label aliensense_gen (DEFAULT) written; reboot to apply: sudo reboot; original extlinux.conf at /boot/extlinux/extlinux.conf.bak-nxs
REBOOT NEEDED
```

Two pods behind one Hub can answer separately only through the aliases the port programs, and the port has not come up yet. The first two lines tell you that `switch` leaves both pods to the port. The port brings each pod to its declaration when it first comes up, after the reboot. The lines under `cam0: boot table installed` name the files the install wrote. They are the port's camera table, the device tree, and the boot table's entry that loads it.

:::caution[The boot table changes what your Jetson boots]
Keep a keyboard and display, or a serial console, on it. The entry your Jetson boots today stays untouched in the file, and the original file is copied to `extlinux.conf.bak-nxs`. If a boot goes wrong, the entry that worked is one menu selection away.
:::

Reboot your Jetson:

```sh
sudo reboot
```

After the reboot, `nxsd` brings the port up. It programs the Hub, trains both links and programs each serializer. It hands each pod the bus so the pod programs its sensor for the declared mode, and it waits for video to lock.

Then it builds the capture stack's configuration for the booted table and checks that every frame arrives. That takes about two minutes, one short session per mode. The capture stack is your Jetson's camera pipeline, from the kernel to the frames an application reads. Check the port:

```sh
nxs cam0 status
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: framos,imx900 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-a (Imx900, head ok)
cam0/B: framos,imx900 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-b (Imx900, head ok)
cam0 on /dev/i2c-cam0, sync fsync 30 fps (exposure the trigger pulse's low time)
cam0 ae: A leads, B follows (nxsd copies the gain each frame: 21.4 dB on both)
cam0: verified 30.0 fps 2 min ago (A 30.0, B 30.0)
…
```

Both links are up at 30 fps. Your declaration names frame sync and no rate, so the pair runs frame-synced at 30 fps. `head ok` means each pod's camera door, the unit's address for camera controls, reports a mode of your declared camera. The lines under them name the port's frame sync, who decides the pair's gain and the rate `nxsd` verified when it brought the port up. `nxs cam0 status` exits 0 when every declared link is up on a ready capture stack and `nxsd` copies the pair's gain. If you see `cam0: preparing the capture stack`, the daemon is still building it, so wait and run the command again.

Without a port, `nxs status` checks your whole declaration against the hardware, the two Clicks included:

```sh
nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 0 installed)
ports:
  cam0  /dev/i2c-cam0  hub hub-cam0 (maxim,max96792a)
    HUB: id 0xB6 ok
    CSI: 2-lane (port and booted overlay agree)
    link A SER: present
    link A SEN: framos,imx900 (camera door @0x33 id 0xc4 v1, 8 rows, READY, mode 1, streaming)
    link A NXS@0x32: present
    link A NXS@0x32: click personality Iam20680
    link B SER: present
    link B SEN: framos,imx900 (camera door @0x35 id 0xc4 v1, 8 rows, READY, mode 1, streaming)
    link B NXS@0x34: present
    link B NXS@0x34: click personality Ms5611
    unit-cam0-a  i2c /dev/i2c-cam0@0x32  ok  serial 20313447504650150034005c  fw vX.Y.Z-0-g<sha>
      outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
    unit-cam0-b  i2c /dev/i2c-cam0@0x34  ok  serial 2f004b0032510f0011223344  fw vX.Y.Z-0-g<sha>
      outputs: pressure temp
```

`IN TUNE` means your declaration holds on this hardware. Every setting in it is one your hardware offers, and every unit that answers runs its declared personality. The lines under the port are its health. The Hub answers, and the port runs the two CSI lanes it booted with. Each link carries its serializer, its declared camera and its pod with the Click's personality.

Each unit answers at its declared alias and lists its outputs. A unit that differed from the file would print a `!` line under its row. A unit that did not answer would read `NO ANSWER`, and the first line would count it.

:::note[Run the port by hand]
`nxs cam0 on` and `nxs cam0 off` do by hand what `nxsd` does at boot. `nxs cam0 on` prints each pod's run, counts two seconds of frames on both links and prints `cam0: verified 30.0 fps (A 30.0, B 30.0)`. Where the Hub's line memory needs a longer line on your rig, `on` says so and `nxs cam0 status` prints the line the pair runs. If `on` ends without the `verified` line, power-cycle the Hub and run `nxs cam0 on` again.
:::

## 3. Watch the streams

With a display on your Jetson, `nxs cam0 stream` opens one viewer per link:

```sh
nxs cam0 stream
```

```
viewers: 2/2
```

Two windows appear, one per camera. Each shows a line like `cam0 A · imx900 · capture 1 · 1920x1080 RAW10 dt-mode 1 · isp-auto · leads B` and a frame rate that updates once a second. The synced pair runs one gain. Link A's capture session decides it (`isp-auto · leads B`), and `nxsd` copies it to camera B every frame, so link B's window reads `isp-locked · follows A`.

To hold both cameras at one fixed gain instead, set it in your declaration with `nxs tune --set cam0:gain=20` and run `nxs switch`. `switch` brings the port up again, and its frame count closes the viewers. Run `nxs cam0 stream` again, and both windows read `isp-locked · 20.0 dB`.

To stream the Clicks' samples, name the unit:

```sh
nxs --unit unit-cam0-a stream --count 3
nxs --unit unit-cam0-b stream --count 3
```

```
Streaming Iam20680 — 7 fields, 14B/sample, every_nth=1 (ctrl-C to stop)
...
Streaming Ms5611 — 2 fields, 8B/sample, every_nth=1 (ctrl-C to stop)
...
```

The IAM20680 streams seven fields and the MS5611 two, the same outputs `nxs status` listed.

## 4. Sync the cameras

When cameras run free, each sensor times its own frames, and the two drift against each other. Your declaration locks both cameras to one frame trigger from the Hub, which stereo and any multi-camera fusion need. On the two CSI lanes of `cam0` the synced pair runs at 30 and 50 fps, and your declaration starts it at 30. `sync` belongs to the port, so `nxs cam0 set` takes it without a link. Run the pair at 50 fps:

```sh
nxs cam0 set sync fsync --fps 50
nxs cam0 get sync
```

```
fsync 50 fps: exposure the trigger pulse's low time, trigger frame 1271 lines
link A: trigger 1 on its camera door at 0x33
link B: trigger 1 on its camera door at 0x35
viewers crop the trigger frame's filler rows (97 lines, datasheet 20.7.3)
viewer for link A (capture id 1) stopped: the delivery check counts its frames
viewer for link B (capture id 0) stopped: the delivery check counts its frames
cam0: verified 50.0 fps (A 50.0, B 50.0)
fsync 50 fps (exposure the trigger pulse's low time)
```

The two `link` lines show each pod putting its camera on the trigger through its camera door, the unit's address for camera controls.

The port now runs frame sync at 50 fps, one trigger pulse per frame. `set sync` closed the viewers from step 3, counted two seconds of frames on both links and verified 50.0 fps on each. Under frame sync the exposure is the trigger pulse's low time, so the rate sets it. A shorter exposure needs a higher rate or less light. `nxs cam0 get sync` reads the setting back. Open the viewers again:

```sh
nxs cam0 stream
```

```
viewers: 2/2
```

Both viewers are back, and each shows its frame rate at 50 fps.

The rate holds until the port comes up again, and the next boot brings it back at 30 fps. To keep 50 fps, set it in your declaration with `nxs tune --set cam0:sync_fps=50` and run `nxs switch`.

`nxs` checks the rate you ask for against the sensors' datasheet frame and the Hub's CSI lanes, then counts the frames that arrive. If the pair does not deliver the rate, `nxs` refuses it with the rate each camera delivered and puts the previous sync back. To return the port to free running, run `nxs cam0 set sync free_run`.

:::note[Two CSI lanes run the pair at 30 and 50 fps, four lanes at 60 fps]
On two lanes the pair drops frames at 60 fps, so `nxs cam0 set sync fsync --fps 60` is refused. The refusal names the rates the pair delivered (`cam0: 60 fps asked, … delivered on A, … on B`), and the previous sync stays. Run the pair at 30 or 50 fps on two lanes. On four lanes, with the Hub on `cam1`, which wires four, the pair runs at 60 fps and delivers every frame.
:::

## 5. Count the frames

Check that every frame arrives. `nxs cam0 capture` counts frames through the same capture stack the viewers use, without a display, on the whole port at once. It stops the viewers from step 4 first. Open them again with `nxs cam0 stream` once the count ends. `nxs cam0 status` then exits nonzero on any gap:

```sh
nxs cam0 capture --frames 60
nxs cam0 status
```

```
viewer for link A (capture id 1) stopped: the capture counts its frames
viewer for link B (capture id 0) stopped: the capture counts its frames
cam0/A: 60/60 at 50.0 fps
cam0/B: 60/60 at 50.0 fps
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: framos,imx900 1920x1080 RAW10 50.0 fps, up, pod unit-cam0-a (Imx900, head ok)
cam0/B: framos,imx900 1920x1080 RAW10 50.0 fps, up, pod unit-cam0-b (Imx900, head ok)
cam0 on /dev/i2c-cam0, sync fsync 50 fps (exposure the trigger pulse's low time)
cam0 ae: A leads, B follows (nxsd copies the gain each frame: 21.4 dB on both)
cam0: verified 50.0 fps 1 min ago (A 50.0, B 50.0)
…
```

Both links delivered 60 of 60 frames at 50.0 fps, and `nxs cam0 status` now reports 50.0 fps on both, with the 50.0 fps that `set sync` verified. The `cam0 ae` line names who decides the pair's gain: link A's capture session, and `nxsd` copies it to camera B every frame. If nothing copies it, `nxs cam0 status` prints `cam0/B: does not follow A (nxsd copies no gain for cam0)` with the command that restarts `nxsd`, and exits 1.

## 6. Publish the ROS 2 topics

`nxsd` publishes the units' samples and the cameras' frames as ROS 2 topics from boot. Your `nxs switch` in step 2 ran in a sourced shell, so the daemon carries the ROS 2 environment. There is nothing to launch. Install the Foxglove bridge, the throttle and the compressed image transport:

```sh
sudo apt install -y ros-jazzy-foxglove-bridge ros-jazzy-topic-tools ros-jazzy-image-transport-plugins
```

List the topics:

```sh
source /opt/ros/jazzy/setup.bash
ros2 topic list | grep nxs
```

```
/nxs/cam0/A/camera_info
/nxs/cam0/A/image_raw
/nxs/cam0/B/camera_info
/nxs/cam0/B/image_raw
/nxs/unit_cam0_a/imu
/nxs/unit_cam0_b/pressure
```

Each camera has two topics: `camera_info` and the full-rate `mono8` image, stamped at the exposure. Each unit has one: `imu` for the IAM20680 and `pressure` for the MS5611. Each camera node prints `no calibration at /etc/aliensense/camera_info/cam0_A.yaml: camera_info carries zeros` in the daemon's journal. The line is harmless: your cameras have no calibration file yet, and a calibration lands there once you run one.

Two full-rate raw streams are more than a websocket carries. Give each camera a copy throttled to 15 fps and compressed to JPEG:

```sh title="Terminal 1"
source /opt/ros/jazzy/setup.bash
for link in A B; do
  ros2 run topic_tools throttle messages /nxs/cam0/$link/image_raw 15.0 /nxs/cam0/$link/image_15 &
  ros2 run image_transport republish --ros-args -p in_transport:=raw -p out_transport:=compressed -r in:=/nxs/cam0/$link/image_15 -r out/compressed:=/nxs/cam0/$link/image_15/compressed &
done
ros2 topic list | grep image_15
```

```
/nxs/cam0/A/image_15
/nxs/cam0/A/image_15/compressed
/nxs/cam0/B/image_15
/nxs/cam0/B/image_15/compressed
```

Then start the Foxglove bridge. It serves on TCP port 8765:

```sh title="Terminal 2"
source /opt/ros/jazzy/setup.bash
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

## 7. Build the dashboard

On your laptop, install Foxglove from [its download page](https://foxglove.dev/download). Open a connection: choose **Open connection**, then **Foxglove WebSocket**, and enter `ws://<the Jetson's address>:8765`. Add four panels:

* An **Image** panel on `/nxs/cam0/A/image_15/compressed`.
* An **Image** panel on `/nxs/cam0/B/image_15/compressed`.
* A **Plot** panel on `/nxs/unit_cam0_a/imu`, with the three `linear_acceleration` fields.
* A **Plot** panel on `/nxs/unit_cam0_b/pressure`, with its `fluid_pressure` field.

Tilt the rig. The acceleration traces swing and the pictures follow, but the pressure holds. Every message carries the time the unit or the camera took it, aligned to your Jetson's clock. So the four sources line up on one time axis. Save the layout in Foxglove. It reconnects to the same address next time.

## 8. Park the port

When you are done, park the port with `nxs cam0 off`. It stops the viewers and gates the capture output off, and each unit parks its camera:

```sh
nxs cam0 off
```

```
viewer for link A (capture id 1) stopped
viewer for link B (capture id 0) stopped
pod A: park (imx900)
pod B: park (imx900)
port parked (sensors in standby)
```

Each unit's LED drops back to one heartbeat, its Click's. `nxs cam0 on` brings the port back, and so does the next boot.

## Next steps

* Write a click personality for a Click that `nxs` does not know yet: [Custom click personality](../custom-sensor/).
* Run the same steps from a chat: [Multi-sensor dashboard with an AI agent](../multi-sensor-dashboard-mcp/).
* Read a link's frames in your own Python program, without ROS. `nxs.cam.frames("cam0", "A")` yields them as arrays with their timestamps, as the [Integration & Operation Manual](../../reference/nxs-integration-manual/) describes.
