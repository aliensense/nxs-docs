---
title: ROS 2 Topics Reference
description: Core RedBrain ROS 2 topics for cameras, IMU, GNSS, odometry, status, and control integration.
---

This table captures the baseline topic contract expected by most integrations.

| Topic | Type | Source | Typical rate |
|---|---|---|---|
| `/rb/cameras/front_left/image_raw` | `sensor_msgs/Image` | Thalamus camera pipeline | 30 Hz |
| `/rb/cameras/front_left/camera_info` | `sensor_msgs/CameraInfo` | Calibration manager | 30 Hz |
| `/rb/cameras/front_right/image_raw` | `sensor_msgs/Image` | Thalamus camera pipeline | 30 Hz |
| `/rb/cameras/front_right/camera_info` | `sensor_msgs/CameraInfo` | Calibration manager | 30 Hz |
| `/rb/imu/data` | `sensor_msgs/Imu` | Axon/Thalamus IMU driver | 200-1000 Hz |
| `/rb/gnss/fix` | `sensor_msgs/NavSatFix` | GNSS driver | 5-20 Hz |
| `/rb/gnss/rtk_status` | `std_msgs/String` or custom status msg | RTK adapter | 1-5 Hz |
| `/rb/vslam/odom` | `nav_msgs/Odometry` | VSLAM node | 15-60 Hz |
| `/tf` | `tf2_msgs/TFMessage` | VSLAM + robot stack | variable |
| `/tf_static` | `tf2_msgs/TFMessage` | Static transforms | latched |
| `/rb/go2/status` | custom status msg | `rb_go2_controller` | 5-20 Hz |
| `/rb/sync/status` | custom status msg | Sync manager | 1-10 Hz |

## Notes

- Exact topic names are configurable in `rb_config.yaml`.
- Keep frame IDs stable once downstream localization/control is integrated.
- Publish rates should remain stable over 30-minute endurance tests.

:::note
If your deployment changes topic naming, preserve a compatibility map for downstream consumers.
:::
