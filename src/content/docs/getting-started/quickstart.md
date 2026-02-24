---
title: 30-Minute Quickstart
description: Unbox, power, boot, and validate camera and ROS 2 outputs on a new RedBrain kit.
---

## What You'll Do

Bring a new RedBrain kit from powered-off hardware to validated camera and ROS 2 data flow in about 30 minutes.

## What You Need

- Cerebrum + Jetson Orin Nano/NX installed
- Thalamus A (minimum) connected to Cerebrum
- Two known-good GMSL cameras connected to Thalamus A links 0 and 1
- 12 V DC power source (current headroom appropriate for your Jetson mode and connected peripherals)
- Ethernet cable to your workstation
- Display/keyboard or SSH access path

:::caution
Use the recommended power input range from your hardware program guide. Undervoltage is the most common cause of unstable bring-up.
:::

## Step-by-Step

1. **Mechanical check (3 min)**
   - Confirm Jetson module seating and heatsink/fan connection.
   - Confirm Thalamus mezzanine is fully mated.
   - Confirm camera coax connectors are seated and locked.

2. **Power and network (5 min)**
   - Connect the 12 V supply to Cerebrum.
   - Connect Ethernet from RedBrain to your network/workstation.
   - Power on and wait for Jetson boot completion.

3. **Login and baseline health (5 min)**
   - SSH to the Jetson.
   - Verify board and service status using your platform health check command.
   - Confirm no repeating boot or power faults in logs.

4. **Start RedBrain stack (7 min)**
   - Launch your baseline RedBrain runtime.
   - Apply your baseline `rb_config.yaml` if not already applied.
   - Confirm camera and middleware nodes report healthy startup.

5. **Validate topics and timing (10 min)**
   - Check camera image + `CameraInfo` topics are active.
   - Confirm frame rates are stable.
   - Confirm no backward timestamp jumps in logs.

## Verify It Works

Use these checks as minimum pass criteria:

- `ros2 topic list` includes expected `/rb/cameras/...` and status topics.
- `ros2 topic hz` on both camera streams is stable at configured rate.
- Image feeds render correctly in RViz2 or your viewer.
- No repeated link-flap or deserializer lock-loss warnings.

## Troubleshooting

### No camera topics appear

- Re-seat coax and confirm camera power.
- Confirm camera links are enabled in `rb_config.yaml`.
- Check that expected Thalamus board is detected.

### Topics exist but frame rate is unstable

- Reduce camera resolution/framerate and re-test.
- Validate power supply capacity under load.
- Check thermal state of Jetson and enclosure airflow.

### Timestamp issues in fusion or VSLAM

- Verify sync/PPS wiring and source selection.
- Check sync status diagnostics before tuning VSLAM.

:::note
After this quickstart, continue with [Camera Setup](/guides/camera-setup/) and [Configuration Reference](/guides/configuration/).
:::
