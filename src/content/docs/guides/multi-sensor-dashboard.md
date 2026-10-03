---
title: "Multi-sensor dashboard on ROS 2"
sidebar:
  order: 4
---

When you finish this guide, your Jetson runs two IMX900 cameras, an IMU and a barometer on one NXS Hub, with both cameras locked to one frame trigger. The Hub is a GMSL deserializer board on a camera connector of your Jetson, with two coax links, A and B. You watch all four sources live on one screen in Foxglove on your laptop: both pictures, the acceleration and the pressure.

## What you need

- **Jetson**: set up with the [NVIDIA Jetson deployment guide](../deploy-jetson/), on JetPack 7.2.1.
- **Software**: ROS 2 Jazzy on your Jetson, from its Ubuntu packages as the [ROS 2 Jazzy installation guide](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html) describes. The base install, `sudo apt install ros-jazzy-ros-base`, is enough: the dashboard runs in Foxglove on your laptop, so the Jetson needs no ROS desktop tools.
- **Hub**: the NXS Hub and its power lead.
- **Camera pods**: two IMX900 camera pods, each with a coax to the Hub. A pod is an IMX900 camera head on an NXS unit with its serializer. The NXS unit is a small sensor computer that runs the drivers for the camera head and for the Click on its socket.
- **Clicks**: an IAM20680 Click (an IMU) for the socket of pod A and an MS5611 Click (a barometer) for the socket of pod B.
- **Laptop**: on the same network as your Jetson, for Foxglove.
- **Console**: a keyboard and display, or a serial console, on your Jetson for the reboot.
- **Time**: about an hour, most of it the reboot and the installs.

## 1. Connect the hardware

Each pod carries one Click and connects to one link of the Hub.

1. Seat each Click on its pod's socket: the IAM20680 on the pod that goes to link A, the MS5611 on the pod that goes to link B.
2. Run a coax from each pod to its link of the Hub, A and B.
3. Plug the Hub into CAM0 and connect its power lead. The pods draw their power over the coax.

`nxs` calls each camera connector of your Jetson a port, and the Hub on CAM0 sits on port `cam0`.

## 2. Declare and switch

Your declaration is one file, `suite.yaml`, that describes the whole rig. This one declares two frame-synced IMX900 heads at 1920x1080 with a pod on each link, an IMU on pod A and a barometer on pod B:

```yaml
ports:
  cam0:
    hub: maxim,max96792a
    sync: {source: fsync}
    links:
      A:
        camera: {sensor: 'framos,imx900', mode: mode6_1920x1080_raw10}
        unit: {name: unit-cam0-a, alias: 0x31}
      B:
        camera: {sensor: 'framos,imx900', mode: mode6_1920x1080_raw10}
        unit: {name: unit-cam0-b, alias: 0x32}
units:
  - name: unit-cam0-a
    module: nxs
    links:
      - {transport: i2c, link: cam0/A}
    sensors: [{personality: iam20680, config: {sample_rate: 250}}]
  - name: unit-cam0-b
    module: nxs
    links:
      - {transport: i2c, link: cam0/B}
    sensors: [{personality: ms5611}]
```

Write it to `/etc/aliensense/suite.yaml`. `nxs switch` makes the hardware match the file: it brings each pod to its declaration, installs the port's boot table and asks for the one reboot the boot table needs.

A personality is the compiled driver a unit runs for a sensor. A pod from the box holds no camera personality, so each pod gets the IMX900 personality once, and keeps it across power cycles. Run `nxs switch`:

```sh
nxs switch
```

```
cam0/A: pod unit-cam0-a does not answer at its alias 0x31; the port comes up to map it
cam0/B: pod unit-cam0-b does not answer at its alias 0x32; the port comes up to map it
cam0: boot table installed
cam0: installed /boot/camera-dtbos/tegra234-p3767-camera-p3768-aliensense_universal-cam0-2lane-overlay.dtbo
cam0: FDT /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb named in aliensense_gen: the boot entry it copies names /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb
cam0: boot label aliensense_gen (DEFAULT) written; reboot to apply: sudo reboot; original extlinux.conf at /boot/extlinux/extlinux.conf.bak-nxs
REBOOT NEEDED
```

Two pods behind one Hub can answer separately only through the aliases the port programs, and the port has not come up yet. The first two lines tell you that `switch` leaves both pods to the port, which brings each to its declaration when it first comes up, after the reboot. The lines under `cam0: boot table installed` name the files the install wrote: the port's camera table, the device tree the boot entry loads, and the boot entry itself.

:::caution[The boot table changes what your Jetson boots]
Keep a keyboard and display, or a serial console, on it. The entry your Jetson boots today stays untouched in the file, and the original file is copied to `extlinux.conf.bak-nxs`. If a boot goes wrong, the entry that worked is one menu selection away.
:::

Reboot your Jetson:

```sh
sudo reboot
```

After the reboot, `nxsd` brings the port up. It programs the Hub, trains both links and programs each serializer. It hands each pod the bus so the pod programs its sensor for the declared mode, and it waits for video to lock.

Then it builds the capture stack's configuration for the booted table, about two minutes with one short session per mode, and checks that every frame arrives. Check the port:

```sh
nxs cam0 status
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: framos,imx900 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-a (imx900, head ok)
cam0/B: framos,imx900 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-b (imx900, head ok)
cam0 on /dev/i2c-cam0, sync fsync 30 fps (exposure the trigger pulse's low time)
cam0 ae: A leads, B follows (nxsd copies the gain each frame: 21.4 dB on both)
cam0: verified 30.0 fps 2 min ago (A 30.0, B 30.0)
…
```

Both links are up at 30 fps. Your declaration names frame sync and no rate, so the pair runs frame-synced at 30 fps. `head ok` means each pod's camera head answers. The lines under them name the port's frame sync, who decides the pair's gain and the rate `nxsd` verified when it brought the port up. `nxs cam0 status` exits 0 when every declared link is up on a ready capture stack and `nxsd` copies the pair's gain. If you see `cam0: preparing the capture stack`, the daemon is still building it, so wait and run the command again.

Without a port, `nxs status` checks your whole declaration against the hardware, the two Clicks included:

```sh
nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 0 installed)
ports:
  cam0  /dev/i2c-cam0  hub maxim,max96792a
    HUB: id 0xB6 ok
    CSI: 2-lane (port and booted overlay agree)
    link A SER: present
    link A SEN: framos,imx900 (declared; no identity register)
    link A NXS@0x31: present
    link A NXS@0x31: sensor personality Iam20680
    link B SER: present
    link B SEN: framos,imx900 (declared; no identity register)
    link B NXS@0x32: present
    link B NXS@0x32: sensor personality Ms5611
    unit-cam0-a  i2c /dev/i2c-cam0@0x31  ok  serial 20313447504650150034005c  fw v1.1.0
      outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
    unit-cam0-b  i2c /dev/i2c-cam0@0x32  ok  serial 2f004b0032510f0011223344  fw v1.1.0
      outputs: pressure temp
```

`IN TUNE` means your declaration holds on this hardware: every setting in it is one your hardware offers, and every unit that answers runs its declared personality. The lines under the port are its health: the Hub answers, the port runs the two CSI lanes it booted with, and each link carries its serializer, its declared camera and its pod with the Click's personality. Each unit answers at its declared alias and lists its outputs. A unit that differed from the file would print a `!` line under its row. A unit that did not answer would read `NO ANSWER`, and the first line would count it.

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

Two windows appear, one per camera. Each shows a line like `cam0 A · imx900 · capture 1 · 1920x1080 RAW10 dt-mode 1 · isp-auto · leads B` and a frame rate that updates once a second. The synced pair runs one gain. Link A's capture session decides it (`isp-auto · leads B`), and `nxsd` copies it to camera B every frame, so link B's window reads `isp-locked · follows A`. To hold both cameras at one fixed gain instead, declare `camera: {gain_db: 20}` under `cam0` and run `nxs switch`. `switch` brings the port up again, and its frame count closes the viewers. Run `nxs cam0 stream` again, and both windows read `isp-locked · 20.0 dB`.

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
viewers crop the trigger frame's filler rows (97 lines, datasheet 20.7.3)
viewer for link A (capture id 1) stopped: the delivery check counts its frames
viewer for link B (capture id 0) stopped: the delivery check counts its frames
cam0: verified 50.0 fps (A 50.0, B 50.0)
fsync 50 fps (exposure the trigger pulse's low time)
```

The port now runs fsync at 50 fps, one trigger pulse per frame. `set sync` closed the viewers from step 3, counted two seconds of frames on both links and verified 50.0 fps on each. Under frame sync the exposure is the trigger pulse's low time, so the rate sets it. A shorter exposure needs a higher rate or less light. `nxs cam0 get sync` reads the setting back. Open the viewers again:

```sh
nxs cam0 stream
```

```
viewers: 2/2
```

Both viewers are back, and each shows its frame rate at 50 fps.

The rate holds until the port comes up again, and the next boot brings it back at 30 fps. To keep 50 fps, declare `sync: {source: fsync, fps: 50}` in `suite.yaml` and run `nxs switch`.

`nxs` checks the rate you ask for against the sensors' datasheet frame and the Hub's CSI lanes, then counts the frames that arrive. If the pair does not deliver the rate, `nxs` refuses it with the rate each camera delivered and puts the previous sync back. To return the port to free running, run `nxs cam0 set sync free_run`.

:::note[Two CSI lanes run the pair at 30 and 50 fps, four lanes at 60 fps]
On two lanes `nxs cam0 set sync fsync --fps 60` is refused with the rates the pair delivered (`cam0: 60 fps asked, … delivered on A, … on B`), and the previous sync stays. Run the pair at 30 or 50 fps on two lanes. On four lanes (`csi_lanes: 4`) the pair runs at 60 fps and delivers every frame.
:::

## 5. Count the frames

Check that every frame arrives. `nxs cam0 capture` counts frames through the same capture stack the viewers use, without a display, on the whole port at once. `nxs cam0 status` then exits nonzero on any gap:

```sh
nxs cam0 capture --frames 60
nxs cam0 status
```

```
cam0/A: 60/60 at 50.0 fps
cam0/B: 60/60 at 50.0 fps
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: framos,imx900 1920x1080 RAW10 50.0 fps, up, pod unit-cam0-a (imx900, head ok)
cam0/B: framos,imx900 1920x1080 RAW10 50.0 fps, up, pod unit-cam0-b (imx900, head ok)
cam0 on /dev/i2c-cam0, sync fsync 50 fps (exposure the trigger pulse's low time)
cam0 ae: A leads, B follows (nxsd copies the gain each frame: 21.4 dB on both)
cam0: verified 50.0 fps 1 min ago (A 50.0, B 50.0)
…
```

Both links delivered 60 of 60 frames at 50.0 fps, and `nxs cam0 status` now reports 50.0 fps on both, with the 50.0 fps that `set sync` verified. The `cam0 ae` line names who decides the pair's gain: link A's capture session, and `nxsd` copies it to camera B every frame. If nothing copies it, `nxs cam0 status` prints `cam0/B: does not follow A (nxsd copies no gain for cam0)` with the command that restarts `nxsd`, and exits 1.

## 6. Publish the ROS 2 topics

You publish the units' samples and the cameras' frames as ROS 2 topics with one launch. The launch starts the bridge for the units and one GStreamer camera node per camera link, on the capture source the `nxs` viewers use. Install the camera node, the Foxglove bridge and the throttle:

```sh
sudo apt install -y ros-jazzy-gscam ros-jazzy-foxglove-bridge ros-jazzy-topic-tools
```

Then launch in two terminals:

```sh title="Terminal 1"
source /opt/ros/jazzy/setup.bash
ros2 launch "$(nxs ros2 --launch-file)" cameras:=true camera_encoding:=jpeg
```

```sh title="Terminal 2"
source /opt/ros/jazzy/setup.bash
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

With `camera_encoding:=jpeg`, the camera node hands each frame to the hardware JPEG encoder and publishes `/nxs/cam0/<link>/image_raw/compressed` at the link's rate. Without it, the topics carry raw `yuv422` frames on `/nxs/cam0/<link>/image_raw`. The other choices are `mono8` and `rgb8`, and the RGB conversion costs a CPU core per camera at 1080p. The Foxglove bridge serves on TCP port 8765. The launch refuses `camera_source:=argus` on the synced pair's links, because the Isaac ROS Argus node takes no exposure or gain setting and would give camera B a gain of its own.

Two 1080p JPEG streams at the links' rates are more than a websocket carries. In a third terminal, give each camera a copy throttled to 15 fps:

```sh title="Terminal 3"
source /opt/ros/jazzy/setup.bash
for link in A B; do
  ros2 run topic_tools throttle messages /nxs/cam0/$link/image_raw/compressed 15.0 /nxs/cam0/$link/image_15/compressed &
done
ros2 topic list | grep nxs
```

```
/nxs/cam0/A/camera_info
/nxs/cam0/A/image_15/compressed
/nxs/cam0/A/image_raw/compressed
/nxs/cam0/B/camera_info
/nxs/cam0/B/image_15/compressed
/nxs/cam0/B/image_raw/compressed
/nxs/unit_cam0_a/imu
/nxs/unit_cam0_b/pressure
```

Each camera has three topics: `camera_info`, the full-rate image and its 15 fps copy. Each unit has one: `imu` for the IAM20680 and `pressure` for the MS5611.

## 7. Build the dashboard

On your laptop, install Foxglove from [its download page](https://foxglove.dev/download). Open a connection: choose **Open connection**, then **Foxglove WebSocket**, and enter `ws://<the Jetson's address>:8765`. Add four panels:

- An **Image** panel on `/nxs/cam0/A/image_15/compressed`.
- An **Image** panel on `/nxs/cam0/B/image_15/compressed`.
- A **Plot** panel on `/nxs/unit_cam0_a/imu`, with the three `linear_acceleration` fields.
- A **Plot** panel on `/nxs/unit_cam0_b/pressure`, with its `fluid_pressure` field.

Tilt the rig. The acceleration traces swing and the pictures follow, but the pressure holds. Every message carries the time the unit or the camera took it, aligned to your Jetson's clock, so the four sources line up on one time axis. Save the layout in Foxglove. It reconnects to the same address next time.

## 8. Park the port

When you are done, park the port with `nxs cam0 off`. It stops the viewers, gates the capture output off and puts the sensors in standby, and each unit parks its camera:

```sh
nxs cam0 off
```

```
viewer for link A (capture id 1) stopped
viewer for link B (capture id 0) stopped
pod A: park (imx900, slot 1)
pod B: park (imx900, slot 1)
port parked (sensors in standby)
```

Each unit's LED drops back to one heartbeat, its Click's. `nxs cam0 on` brings the port back, and so does the next boot.

## Next steps

- Write a personality for a Click that `nxs` does not know yet: [Custom sensor personality](../custom-sensor/).
- Run the same steps from a chat: [Multi-sensor dashboard with an AI agent](../multi-sensor-dashboard-mcp/).
- Read a link's frames in your own Python program, without ROS: `nxs.cam.frames("cam0", "A")` yields them as arrays with their timestamps, as the [Integration & Operation Manual](../../reference/nxs-integration-manual/) describes.
