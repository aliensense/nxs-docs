---
title: Unitree Go2 Integration
description: Wire RedBrain to Unitree Go2, configure controller inputs, and run safe motion using VSLAM odometry.
---

## What You'll Do

Connect RedBrain to Unitree Go2, bring up `rb_go2_controller`, and execute a safe test motion controlled by RedBrain odometry.

## What You Need

- RedBrain system with camera + IMU pipelines healthy
- Unitree Go2 reachable over Ethernet
- Unitree SDK2 environment configured on Jetson
- Operator stop command path verified before arming

## Step-by-Step

1. **Network and wiring setup**
   - Connect RedBrain and Go2 Ethernet interfaces.
   - Verify IP connectivity and expected SDK2 access.

2. **Start RedBrain perception stack**
   - Ensure VSLAM odometry topic is publishing.
   - Confirm `tracking_ok` or equivalent health signal.

3. **Launch controller in disarmed mode**
   - Start `rb_go2_controller` with safe defaults.
   - Confirm status reports `DISARMED` and no outgoing motion commands.

4. **Arm and run conservative motion primitive**
   - Arm only after odometry health checks pass.
   - Run a low-speed forward/heading-hold test.

5. **Trigger safety stop validation**
   - Simulate odom timeout or send operator stop.
   - Confirm command output goes to zero quickly.

## Verify It Works

- `/rb/go2/status` updates include armed state and tracking status.
- Motion commands are issued only while armed and tracking is healthy.
- Safety stop behavior is deterministic and repeatable.

## Troubleshooting

### Controller stays disarmed

- Verify arm interface path (topic/service) and safety interlocks.
- Check odometry validity gating is satisfied.

### Robot does not move after arming

- Confirm SDK2 transport and permissions.
- Verify command type/range matches Go2 mode.

### Unexpected stop events

- Check odom timeout threshold and network stability.
- Review tracking quality transitions from VSLAM.

:::caution
Run first tests with conservative speed limits and a physical safety perimeter.
:::

## Detailed Guide Coming Soon

This page will be expanded with:

- Recommended controller parameter defaults for stage demos
- Closed-loop square path script example
- Optional kidnapped-robot recovery flow and acceptance checks
