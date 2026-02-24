---
title: Camera Setup
description: Connect and configure GMSL cameras end-to-end on RedBrain, then verify stable ROS 2 image output.
---

## What You'll Do

Connect one or more GMSL cameras to Thalamus, apply camera configuration, and verify ROS 2 image streams with stable rates.

## What You Need

- RedBrain powered and reachable over SSH
- Thalamus board installed and detected
- Supported camera + serializer hardware
- Baseline `rb_config.yaml` file
- RViz2 or equivalent image viewer

## Step-by-Step

1. **Connect cameras to physical links**
   - Connect each camera coax to a known Thalamus link index.
   - Keep a wiring map from physical connector to logical link ID.

2. **Update camera sections in `rb_config.yaml`**
   - Set `compatible` sensor model per link.
   - Set topic names and frame IDs.
   - Select the correct calibration profile.

3. **Apply config live**
   - Run your apply command to reload camera drivers without reflashing MCUs.
   - Expect a brief stream interruption while drivers restart.

4. **Validate stream health**
   - Confirm `Image` and `CameraInfo` topics per enabled camera.
   - Check frame rate and dropped frame counters.

## Verify It Works

- Images render with correct orientation and expected resolution.
- `CameraInfo` corresponds to selected calibration profile.
- ROS topic rates are within expected tolerance.
- No recurring deserializer lock-loss messages.

## Troubleshooting

### No stream from one link

- Verify coax seating and serializer power.
- Confirm the link is enabled in config.
- Swap camera/cable with a known-good link to isolate hardware.

### Stream appears but calibration is wrong

- Confirm calibration profile matches camera model and mount position.
- Re-check left/right mapping for stereo pairs.

### Frequent dropouts under load

- Lower resolution/FPS during initial validation.
- Check thermals and power margin.

:::note
Name links after physical placement (`front_left`, `front_right`) using aliases to make downstream launch files easier to maintain.
:::
