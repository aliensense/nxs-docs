---
title: IMU Integration
description: Add and configure an IMU on Axon mikroBUS, publish ROS 2 IMU data, and validate timing consistency.
---

## What You'll Do

Install an IMU Click board on Axon, configure driver selection in YAML, and validate `sensor_msgs/Imu` output.

## What You Need

- Axon board installed in your RedBrain stack
- Supported IMU Click module
- Access to `rb_config.yaml`
- ROS 2 CLI tools (`ros2 topic list`, `ros2 topic hz`, `ros2 topic echo`)

## Step-by-Step

1. **Power down and install IMU module**
   - Insert the Click board into the designated Axon mikroBUS slot.
   - Confirm orientation before power-up.

2. **Configure the IMU entry in YAML**
   - Set the correct `compatible` driver string.
   - Set `data_rate_hz` and mounting `rotation`.
   - Map the sensor to a stable alias like `imu_main`.

3. **Apply the configuration**
   - Apply the updated config live.
   - Wait for IMU driver initialization confirmation.

4. **Validate output topic**
   - Confirm `/rb/imu/data` (or your configured topic) exists.
   - Verify stable rate and sane accelerometer/gyro values.

## Verify It Works

- IMU topic publishes at configured rate (for example 200 Hz or higher).
- Frame ID matches your localization stack expectations.
- No repeated sensor init failures in logs.

## Troubleshooting

### IMU topic not present

- Check module seating and slot assignment.
- Confirm `compatible` value matches installed Click board.
- Verify the link/port path in YAML is correct.

### Orientation appears wrong

- Adjust `rotation` in YAML and re-apply.
- Re-check physical sensor orientation on the robot.

### Unstable rate or noise spikes

- Reduce bus contention from other sensors temporarily.
- Confirm power integrity and grounding on the sensor path.

:::note
For a full configuration pattern, see [rb_config.yaml Reference](/guides/configuration/).
:::
