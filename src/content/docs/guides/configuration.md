---
title: Configuration Reference (`rb_config.yaml`)
description: Full RedBrain configuration structure, field-by-field guidance, annotated YAML examples, and live apply workflow.
---

## What You'll Do

Understand and edit `rb_config.yaml`, apply changes live, and verify that cameras and sensors are publishing with expected settings.

## What You Need

- SSH access to RedBrain Jetson
- Working baseline config checked into version control
- Knowledge of your physical link mapping (which sensor is on which link/slot)

## Step-by-Step

1. **Copy baseline config for your robot**
   - Start from a known-good file and branch your edits.

2. **Update only the sections you are changing**
   - Sensor driver, rates, frame IDs, calibration profile, and aliases.

3. **Validate syntax before apply**
   - Run YAML lint or config-check command.

4. **Apply live**
   - Apply config without reflashing MCUs.
   - Expect short stream interruptions while affected nodes restart.

5. **Run post-apply checks**
   - Confirm expected topic set and topic rates.
   - Verify timestamps and frame IDs in downstream tools.

## Annotated Example

```yaml
# rb_config.yaml
version: 1
robot:
  name: go2_devkit
  namespace: /rb

runtime:
  log_level: info
  auto_restart: true
  diagnostics_rate_hz: 1

sync:
  source: mcu_master               # mcu_master | gnss_pps
  publish_status_topic: /rb/sync/status

thalamusA:
  links:
    "0":
      enabled: true
      compatible: framos,imx296m
      role: cam_front_left
      topic:
        image: /rb/cameras/front_left/image_raw
        camera_info: /rb/cameras/front_left/camera_info
      frame_id: cam_front_left_optical
      fps: 30
      resolution: [1280, 720]
      calib:
        profile_id: framos_imx296_stereo_v1
    "1":
      enabled: true
      compatible: framos,imx296m
      role: cam_front_right
      topic:
        image: /rb/cameras/front_right/image_raw
        camera_info: /rb/cameras/front_right/camera_info
      frame_id: cam_front_right_optical
      fps: 30
      resolution: [1280, 720]
      calib:
        profile_id: framos_imx296_stereo_v1

thalamusB:
  links:
    "0":
      enabled: true
      compatible: invensense,iim20670
      role: imu_main
      topic:
        imu: /rb/imu/data
      frame_id: imu_link
      data_rate_hz: 500
      rotation: roll_90

axon:
  mikrobus:
    "0":
      enabled: true
      device: imu_main
      transport: i2c
    "1":
      enabled: true
      device: gnss_main
      transport: uart

gnss:
  enabled: true
  type: gnss7_click                 # switch to gnss_rtk_click for RTK module
  topic: /rb/gnss/fix
  frame_id: gnss_link

can:
  main:
    enabled: true
    bitrate: 1000000
    data_bitrate: 2000000
  aux:
    enabled: true
    bitrate: 1000000
    data_bitrate: 2000000

aliases:
  cam_front_left: thalamusA.links."0"
  cam_front_right: thalamusA.links."1"
  imu_main: thalamusB.links."0"
  gnss_main: axon.mikrobus."1"
```

## Field Notes

- Keep aliases stable even when hardware swaps happen.
- Change only `compatible` and `calib.profile_id` during camera model swaps.
- For IMU swaps, update driver + rotation + data rate together.
- Track every config change in git to support rollback during field tests.

## Verify It Works

- `ros2 topic list` matches expected sensors and cameras.
- `ros2 topic hz` reports expected rates.
- RViz frame tree has expected frame IDs with no disconnected branches.

## Troubleshooting

### Apply fails immediately

- YAML syntax error or unsupported key name.
- Missing required fields for an enabled link.

### Apply succeeds but topics are missing

- Link enabled state does not match physical wiring.
- Driver selection (`compatible`) does not match installed hardware.

### Topic names changed unexpectedly

- Check namespace and alias changes.
- Ensure downstream launch files still target the updated topic names.
