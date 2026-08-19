---
title: "NXS — Integration & Operation Manual"
sidebar:
  order: 5
# Mirrored from the firmware repository (docs/specs/nxs-integration-manual.md) at pre-release v1.0.0-rc1-193-g3e0ac604d (3e0ac604d).
# Do not edit here — changes flow through the next release.
---

Applies to: NXS v1.0 · product version 1.0.x · `nxs` tool 1.0.x

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, supported sensors, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| **Integration & Operation Manual** (this document) | design-in, host setup, workflows |
| [Driver Development Guide](../nxs-driver-development/) | authoring drivers for unsupported sensors |
| [FAQ](../nxs-faq/) | frequently asked questions |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

## 1. Quick start

Evaluation path: one NXS module, one sensor on the mikroBUS socket, a USB-UART adapter on the host serial port (460800 8N1).

Install the host tool (isolated, no system Python changes). Install `uv` per [its documentation](https://docs.astral.sh/uv/getting-started/installation/) or from your OS package manager, then:

```sh
uv tool install "./nxs-<version>-py3-none-any.whl[cyphal]"
eval "$(nxs env)"
```

The wheel comes from the release bundle. `nxs env` exports the Cyphal environment (DSDL path, host node-ID 127) and installs tab completion for every `nxs` verb, flag, and argument choice on bash and zsh.

Talk to the module:

```sh
export NXS="nxs --transport cyphal-serial --port /dev/ttyUSB0 --remote-node-id 125"
$NXS probe
```

```
register map: v1
```

Load a driver and stream:

```sh
$NXS upload iam20680 --param sample_rate=250 accel_fs=8
```

```
Uploaded and running.
```

```sh
$NXS stream --count 5
```

```
accel_x=0.12 accel_y=-0.05 accel_z=9.81 temp=298.4 gyro_x=0.001 ...
```

Values are SI: `m/s^2`, `kelvin`, `rad/s`. Persist the driver so it survives power cycles:

```sh
$NXS store save 0
$NXS store ls
```

```
slot 0: iam20680
```

The same commands run over I²C (`--transport i2c --bus /dev/i2c-2`) and CAN-FD (`--transport cyphal-can --port can0`); only the transport flags change.

## 2. Hardware design-in

### 2.1 Carrier essentials

- Supply and I/O are 3.3 V. The mikroBUS 3V3 sensor rail is firmware-switched — sensors are power-cycled at driver bind, so do not feed sensor circuits from another rail.
- Sensor reset (mikroBUS RST) is driven by the loaded driver with per-driver polarity. Leave it unconnected for sensors without reset and never strap it to a fixed level. Do not tie RST to CS on the carrier either, because the bootloader reads that pair as a recovery request at every reset (§4.5).
- CAN-FD requires an external transceiver on the carrier rated for the 4 Mbps data phase. Termination per CAN practice (120 Ω at both bus ends): v2 modules carry an on-board split termination that is **off by default** — commission `can-term on` (§4.3) on the two bus-end modules, or terminate externally. v1.0 modules always need external termination.
- The host UART carries the host link in normal operation, and the update protocol during firmware update and recovery. Reserve it for that and do not share it with other carrier functions. Console and log output does not share the port, in the bootloader as much as in the application.
- The socket contract — pin functions, the one-active-driver rule, and the pull-up requirement above 400 kHz on the sensor I²C bus: [Device Reference §2.2](../nxs-device-reference/). Pinout and electrical limits: the NXS product datasheet.

### 2.2 Transport choice

| Transport | Use when | Full node surface? |
|---|---|---|
| I²C (target `0x30`) | The host is an autopilot/MCU polling a register map | full management surface — drivers, parameters, store, commissioning, firmware update, identify; samples by polling; no pub/sub |
| Cyphal/serial (UART 460800) | Point-to-point host link, evaluation, Linux hosts | yes — registers, services, subjects, DFU |
| Cyphal/CAN-FD | Vehicle bus, multiple nodes, longer runs | yes — registers, services, subjects, DFU |

All three expose the same driver, parameter, store, and update procedures; the [Interface Description](../nxs-host-interface/) defines each surface normatively.

## 3. Host platform setup

### 3.1 Linux serial

```sh
ls /dev/ttyUSB*
sudo usermod -aG dialout "$USER"
```

The listing identifies the adapter; the group change is once per host, effective after re-login.

### 3.2 Linux I²C (embedded hosts, e.g. Jetson)

```sh
ls /dev/i2c-*
sudo usermod -aG i2c "$USER"
i2cdetect -y 2
```

The group change is once per host, effective after re-login; the module answers at `0x30`.

### 3.3 Linux CAN-FD

The default module profile is CAN FD 1 Mbps arbitration / 4 Mbps data:

```sh
sudo ip link set can0 up type can \
    bitrate 1000000 sample-point 0.875 sjw 4 \
    dbitrate 4000000 dsample-point 0.75 dsjw 4 fd on
ip -details link show can0
```

The second command verifies FD mode, both bitrates, the sample points, and both jump widths.

For a module commissioned onto a Classic profile, bring the interface up without FD at the module's nominal rate (here 1 Mbps), and drive nxs with `--mtu 8`:

```sh
sudo ip link set can0 up type can bitrate 1000000 sample-point 0.875 sjw 4 fd off
nxs -t cyphal-can -p can0 --mtu 8 probe
```

Name the jump widths explicitly as well. Linux defaults both the nominal `sjw` and the data-phase `dsjw` to 1 time quantum, too little margin at these bit timings for a receiver to track another node's clock. The symptom is one-directional, in that the interface receives normally while its own transmissions go unacknowledged and the controller sits at `ERROR-PASSIVE`. A value of 4 is sufficient for `sjw` on both profiles and for `dsjw` on an FD profile; a Classic profile has no data phase and takes `sjw` alone. An FD interface left at the default `dsjw` fails this way even with `sjw` set, and only while carrying bit-rate-switched frames — Classic traffic on the same interface passes.

`nxs can-bitrate` reads the module's persisted profile (Interface Description §8.2.7). The explicit `fd off` matters: Linux keeps CAN control-mode flags across reconfigurations, so an interface previously brought up with `fd on` stays in FD mode unless the flag is named. The host interface must match the module's *active* profile exactly — bitrates and sample points (0.875 / 0.750); a mismatch shows as error frames under load, and FD and Classic nodes cannot share a segment. Classic profiles carry control, telemetry, and decimated streams; full-rate raw capture needs an FD profile (Device Reference §3).

### 3.4 Stock Cyphal tooling

`nxs env` exports everything stock OpenCyphal tools need (DSDL path, host node-ID):

```sh
uv tool install yakut
eval "$(nxs env)"
yakut monitor
```

Node 125 appears with a heartbeat.

### 3.5 ROS 2 host environment

The ROS 2 bridge (§5.10) requires a ROS 2 environment on the host, installed per the ROS 2 project's documentation for the host's OS release (Ubuntu 22.04 → Humble, Ubuntu 24.04 → Jazzy). The nxs wheel is pure-Python and distro-neutral — one file serves either distro.

Two NXS-specific requirements on top of a stock ROS 2 install:

```sh
source /opt/ros/<distro>/setup.bash
python3 -m pip install 'nxs[cyphal] @ file:///tmp/nxs-<version>-py3-none-any.whl'
```

- nxs must be installed into the sourced distro's own Python: `rclpy` ships with the distro, so an isolated `uv tool` environment cannot see it. `nxs ros2 --plan` alone needs no ROS.
- The visualization launch (`viz:=true`, §5.10) uses `rviz2` with the `imu_tools` Imu display and PlotJuggler; install those packages for the distro to use it.

## 4. Operating

Set the transport once per shell (examples use CAN; substitute your transport flags):

```sh
export NXS="nxs --transport cyphal-can --port can0 --remote-node-id 125"
```

### 4.1 Drivers and parameters

```sh
$NXS upload iam20680
$NXS caps
$NXS get sample_rate
$NXS set sample_rate 500
$NXS outputs
```

`upload` compiles a driver from the shipped set and runs it. `caps` lists every parameter with its allowed values and defaults; `set` re-configures the sensor live; `outputs` prints each field's name, type, scale/offset, unit, and semantic.

A full-scale change on an IMU (`set accel_fs 16`) retunes the output scale on the device; streamed values stay SI with no re-upload.

A driver may expose an upload-time configuration key in addition to runtime parameters — for a choice that changes the compiled image rather than a patchable value. A register whose reserved bits mandate read-modify-write has no runtime patch site, so its setting is a compile-time key:

```sh
$NXS upload iim20670
$NXS upload iim20670 --config accel_fs=4
```

The first form compiles with the config defaults; the second recompiles with a different full-scale.

Changing a config key is a re-upload; to switch without a host, save each configuration to a store slot (`store save 0` / `store save 1`) and cycle.

### 4.2 Streaming and decimation

```sh
$NXS stream
$NXS stream --raw
$NXS stream --units si
```

`stream` prints decoded samples until Ctrl-C; `--raw` prints the undecoded sample bytes.

The device always publishes canonical SI. The stream table converts display units for readability (kelvin prints as °C, the column header following); `--units si` — or `NXS_UNITS=si` — prints the SI values verbatim.

Two independent thinning stages: the device gate (every Nth sample to every consumer) and per-SI-subject decimation (Cyphal subjects only):

```sh
$NXS decimation 1
$NXS decimation --subject temperature 25
```

```
decimation[temperature] = 25
```

`decimation 1` opens the device gate to every sample; the per-subject factor publishes temperature at 1/25th of the sample rate.

Factors persist with `commission --save` (§4.4) — not with `store save`, which persists only the driver.

For publishing the stream onto ROS 2 topics instead of the terminal, see §5.10.

### 4.3 Multi-node commissioning (CAN)

A factory-fresh node boots at node-ID 125 on the default subjects. Give each node a distinct identity:

```sh
$NXS commission --show
```

```
node-id  125 ...
```

```sh
$NXS commission --node-id 10
$NXS commission --save
```

The node-ID is staged by the first command; `--save` persists it, effective after reboot.

Subject remaps are per-subject registers; identical boards may share subjects (subscribers disambiguate by node-ID), so remap only on collision with other equipment:

```sh
$NXS commission --subject acceleration=6246
$NXS commission --save
```

`--node-id 65535` (the `0xFFFF` sentinel) reverts to the compiled default. Full semantics: [Interface Description §6.7](../nxs-host-interface/).

The CAN bit timing is commissioned the same way — verify the new profile on a bench link before deploying, and reconfigure the host interface (§3.3) after the reboot that applies it. A read with no value prints the active profile (`1000000/4000000 (fd)` on a factory-fresh module); a bare rate stages Classic CAN at that rate; `0` stages a revert to the default FD profile; the save persists the staged profile, which applies at the next reboot:

```sh
$NXS can-bitrate
$NXS can-bitrate 1000000
$NXS commission --save
```

`commission --can-bitrate 1000000/4000000` stages the pair inside a commissioning run. Supported profiles: Device Reference §3. A node whose profile does not match its bus is unreachable over CAN but stays reachable over the serial link and I²C — rewrite the profile there.

The on-board split termination is part of the same commissioning session. It applies **live** (no reboot) and is off by default — turn it on only at the two modules sitting at the physical bus ends. The read prints `off` on a factory-fresh module, the toggle applies immediately, and the save persists it; an unsaved change reverts at the next power-cycle:

```sh
$NXS can-term
$NXS can-term on
$NXS commission --save
```

`commission --can-term on` folds it into a node-ID session. A live `can-term off` on a module providing the bus's only end-termination degrades the bus under you — if the link drops before the Save, power-cycle: the unsaved change reverts.

### 4.4 Persistence model

Running configuration and startup configuration are distinct. `store save <slot>` persists the driver; `commission --save` persists identity, subjects, decimation, the running calibration record, the CAN bit timing, and the termination selection (the calibration verbs of §4.9 persist by default). Anything not saved reverts at power-cycle.

```sh
$NXS store save 0
$NXS store ls
$NXS store rm 0
```

Slot 0 auto-loads at boot.

### 4.5 Firmware update

Over any transport, with automatic rollback on a failed boot (watchdog + self-confirm):

```sh
$NXS push-fw nxs-fw-1.0.1.bin
```

```
progress bar; node reboots into the new image and confirms
```

```sh
$NXS probe
```

The module is back, reporting `register map: v1`.

If an update is interrupted, the module keeps running the old image. A new image that fails to self-confirm is rolled back automatically (watchdog + self-confirm). Recovery is therefore a last resort, needed only when the application is too broken to boot the normal update path.

#### Serial recovery

```sh
$NXS recover
```

The module reboots into MCUboot serial recovery on the host UART and holds there until an upload completes. There is no window to catch. `push-fw` does not operate in recovery. Upload with `smpmgr` or `mcumgr`:

```sh
smpmgr --port /dev/ttyUSB0 --line-buffers 8 image upload nxs-fw-1.0.1.signed.bin
smpmgr --port /dev/ttyUSB0 os reset
```

Recovery runs the port at 115200 8N1, which is the default of every mcumgr client, so no baud option is needed. The application's 460800 does not apply here — a client pinned to it gets no response.

Every upload prints one warning before it starts, and it is expected on every unit:

```
WARNING  Error reading MCUMgr parameters: ... rc=<MGMT_ERR.ENOTSUP: 8>
```

The bootloader implements the subset of SMP that recovery needs, and the optional parameters query is not part of it, so the module answers "not supported" and the client falls back to a conservative frame size. `--line-buffers 8` supplies the value that query would have returned. Without it the upload still succeeds, roughly a third slower. Full procedure: [Interface Description §7.4](../nxs-host-interface/).

Three entrances reach that state. Each one covers a failure the entrance above it cannot.

| Entrance | Use when |
|---|---|
| `$NXS recover` | the application still answers on a host transport |
| mikroBUS `RST`–`CS` bridge, then reset | the application boots but stops answering |
| reset with no valid image in slot 0 | the slot is erased, unsigned, or corrupt. Nothing beyond power is needed |

Throughout recovery the status LED shows two dark winks per second (§4.7).

**Forcing recovery with a bridge.** The module tests the mikroBUS `RST` and `CS` pins for continuity once at every reset. A wire between them forces recovery on that boot regardless of what the application is doing. Fitting the wire needs the sensor removed and the socket pins exposed, which is what a mikroBUS shuttle-style adapter provides (the MikroElektronika mikroBUS Shuttle is one compatible part).

1. Remove the sensor board from the mikroBUS socket.
2. Fit the shuttle adapter.
3. Bridge `RST` to `CS` with a jumper wire. They are the second and third pins from the AN end of the AN-side header, per [Device Reference §2.2](../nxs-device-reference/).
4. Power-cycle or reset the module.

The LED confirms the state. Upload as above, then remove the jumper. A module reset with the jumper still fitted re-enters recovery.

A seated sensor board never triggers this. The test requires both pins to follow a driven level through a high phase and a low phase, which only a wire does.

Version compatibility promises (what MAJOR/MINOR/PATCH mean for your integration): [Device Reference §5](../nxs-device-reference/).

### 4.6 Reading samples over I²C registers

An MCU host without Cyphal reads the same data through the register map: descriptor window once at integration time, then one latched read of the sample record per sample — acquisition timestamp, sequence number, and data in a single coherent snapshot — decoding `raw × scale + offset` per field. The record's latch-time field also gives the host a device-clock sync observation per poll. Registers, the record layout, and the sync method: [Interface Description §3–§6](../nxs-host-interface/).

### 4.7 The status LED, and locating a unit

The green status LED renders the module's state as a moving pattern. Two families share the LED, and their backgrounds are opposite, so which family is running is legible before any pulse is counted.

**Normal operation** draws short pulses on a dark background. One flash per second is idle with no driver loaded. A double pulse is the measuring heartbeat. Three fast ticks after that heartbeat mean the driver is still measuring but the sensor bus has faulted since boot or since the last host-commanded restart. A fast blink near 5 Hz is a loaded driver whose sensor is not answering, and a three-flash burst is a driver fault whose error code is readable over any transport.

**The bootloader** inverts that. It holds the LED lit and notches it with dark winks. One wink per second is the image check, two is serial recovery awaiting an upload (§4.5), and three is an update applying, during which power must stay on. A module with no valid image departs from the family with a single slow 300 ms pulse per second, mostly dark, like the failure it reports.

Every state in both families moves. A static LED, dark or solid, therefore always means the module is not executing. Exact frame timings are in the pattern table at [Device Reference §2.3](../nxs-device-reference/).

To pick one unit out of several identical modules:

```sh
$NXS identify
```

Works over I²C and the Cyphal transports; on a suite-managed host, `nxs --unit <name> identify` addresses the unit by its manifest role.

### 4.8 Reading device logs

The module forwards its own log lines over Cyphal, so a fielded unit is debuggable without any debug-probe access. Lines at or above a severity floor (warnings, by default) arrive as `uavcan.diagnostic.Record` on fixed subject 8184, over serial and CAN alike:

```sh
yakut sub 8184:uavcan.diagnostic.record.1.1
```

Each record carries the device timestamp, the severity, and the log text. The floor is the `uavcan.diagnostic.severity` register: write `2` to stream informational lines during a session, and `4` to restore the default when done — values and semantics in the [Interface Description §8.2](../nxs-host-interface/). The stream is rate-bounded and sent below data priority, so subscribing never disturbs sample traffic.
### 4.9 Calibration

Per-unit calibration corrects the SI outputs. The raw stream stays raw counts, and a raw sample decoded with the served record reproduces the SI subjects exactly. Wire surface, record layout, and the on-device procedures: [Interface Description §6.9](../nxs-host-interface/). The calibration verbs persist by default. `--no-persist` leaves the result in the running state, reverting at power-cycle.

Declare the mounting orientation at installation — one of the 24 axis-aligned rotation codes (`YAW_90`, `PITCH_180`, `ROLL_90_YAW_270`, …), naming the module's rotation relative to the vehicle body:

```sh
$NXS set-orientation YAW_90
# orientation = YAW_90 (persisted)
$NXS set-orientation                  # no argument: print the current code
```

Gyro bias — hold the vehicle still:

```sh
$NXS calibrate gyro
# hold still — the device is measuring gyro bias
# ━━━━━━━━━━ 100%
# ✓ applied on-device + persisted
```

The same solve runs automatically at every boot. A still boot completes unaided. A moving boot gives up after ~15 s and leaves the stored bias untouched.

Magnetometer — in-situ, mounted in the vehicle. The iron the fit removes belongs to the installation, so a bench calibration does not transfer. Rotate the vehicle through all attitudes:

```sh
$NXS calibrate mag
# coverage ━━━━━━━━━─ 12/14
# ✓ applied on-device + persisted
```

The verb auto-stops at sufficient coverage; a stop refused for coverage keeps the collection open, so the verb tells the operator to keep rotating and asks again. Any other refused fit — degenerate geometry, a failed self-check — reports its reason and changes nothing. The procedure also runs without the tool, from any Cyphal master:

```sh
yakut cmd 125 0xA00B                              # CAL_MAG_START
yakut r 125 aliensense.nxs.calibration.progress
yakut cmd 125 0xA00C                              # CAL_MAG_STOP: status 0 = solved + applied
yakut cmd 125 0xA00D                              # CAL_ABORT: cancel, applying nothing
```

Accelerometer — a bench procedure of six still poses, each axis up and down, auto-captured on stillness. The affine solves host-side and is refused if any pose residual exceeds 5 % of g:

```sh
$NXS calibrate accel
# ✓ +Z  (0.998 g)
# ...                                 # six poses
# solve: max residual 0.6% of g
# ✓ applied on-device + persisted
```

Encoder zero — declare the current mechanical position as zero (circular mean of 50 samples):

```sh
$NXS calibrate encoder-zero
```

Inspect and reset:

```sh
$NXS calibrate show                   # orientation, per-bucket status + guard, encoder zero
$NXS calibrate show --full            # + the M / b coefficients
$NXS calibrate reset                  # identity + persist; orientation kept
```

Each solved bucket is guarded by the driver it was solved against. After a sensor swap the stale calibration goes inactive and only the mount rotation still applies. `calibrate show` names the mismatch, and `suite status` flags the unit's CAL column `STALE` (§5.9). Recalibrate after any sensor change.

## 5. Suite provisioning

A multi-unit host — units behind GMSL/I²C tunnels, on CAN segments, on serial links — is described once in a manifest and converged with one command. The manifest is declared intent, hand-owned. A separate state file records what the tool learned (first-seen serials, applied versions).

| File | Role | Default location |
|---|---|---|
| `suite.yaml` | declared intent | `/etc/aliensense/suite.yaml`, else `~/.config/aliensense/suite.yaml` |
| `state.yaml` | tool-recorded facts | `/var/lib/aliensense/state.yaml`, else `~/.local/share/aliensense/state.yaml` |
| firmware store | signed images, matched by header version | `/opt/aliensense/firmware/` |
| driver store | host-local `.py` drivers, override the shipped set | `/opt/aliensense/drivers/` |

### 5.1 Manifest

Generate a skeleton from what is plugged in, then declare intent:

```sh
nxs suite scan --init
nxs --unit <name> identify
```

`scan --init` writes the manifest in place, transcribing links, serials, and running versions. Re-running it later grows the file additively: hand-written names and configs survive, recognized boards keep their entries (new routes append to their `links`), and new boards append as skeletons. `identify` strobes each unit's LED (§4.7) to map names to physical boxes.

```yaml
units:
  - name: imu-mast
    module: nxs
    links:
      - {transport: i2c, bus: /dev/i2c-9, address: 0x30}
      - {transport: cyphal-can, iface: can1, node_id: 125}
    serial: "2f004b0032510f0011223344"
    firmware: "1.0.0"
    orientation: YAW_90   # optional; declared mounting rotation (§4.9)
    sensors:
      - driver: iam20680
        config: {sample_rate: 250, accel_fs: 8}
    egress:
      decimation: 1
      subjects: {temperature: 25}
  - name: fl-knee
    module: nxs
    links: [{transport: cyphal-can, iface: can0, node_id: 10}]
    sensors: [{driver: iam20680, config: {sample_rate: 1000}}]
```

Link forms are `{transport: i2c, bus, address}`, `{transport: cyphal-can, iface, node_id}`, and `{transport: cyphal-serial, port[, baud]}`. A top-level `defaults: {firmware: "..."}` sets a suite-wide pin that units may override. Unknown keys and malformed values are rejected with the YAML path named.

A unit-level `orientation:` (a rotation code name, §4.9) declares the mounting: `switch` converges the device to it, `freeze` adopts the device's current code into the manifest, and a mismatch reports as `orientation` drift (§5.9). Solved calibration coefficients never enter the manifest — they are per-unit device state, persisted on the device.

A `driver:` name resolves against `/opt/aliensense/drivers/*.py` first, then the shipped set; an unknown name fails that unit and names the generation route (the Driver Development Guide's datasheet-in → driver-out flow).

Units sharing one host bus behind a multi-link deserializer all answer the fixed register-map address `0x30`. The bus layer must present each at a distinct host-side address via the deserializer's I²C address translation — link B's `0x30` becomes `0x31`, the convention `scan` probes on every leaf bus. Mux parent adapters are excluded, since a trunk only duplicates a child's unit, and any address the manifest declares is swept too. The platform owns the translation, whether in devicetree, the camera stack, or a boot service, and it is programmed before first contact. Two un-aliased units answering one address return merged reads: probe succeeds while the serial belongs to neither board, and writes reach both units at once.

Bus and port values accept any path that resolves to the device. Prefer stable names over enumeration order on multi-connector hosts: the stock `/dev/serial/by-id/...` aliases for serial links, and a udev alias per carrier connector for I²C (`bus: /dev/i2c-cam1`). Link matching resolves aliases, and `scan` reports buses and serial ports by their stable alias when one exists, so transcribed manifests carry connector names.

The optional `egress` section declares the decimation intent — the device-wide gate and the per-SI-subject factors. A declared section is enforced: switch retunes differing factors over the management link and persists them, drift reports them as `egress`, and freeze adopts the live values back into the section. An absent section leaves the factors unmanaged, exactly like an absent `sensors` key.

One board is one unit, however many routes reach it: a board on I²C behind a deserializer *and* on CAN-FD is one entry whose `links` list both. Link order is management priority — every verb uses the first link that answers, so a dropped route degrades instead of failing the unit (reported by `switch` as `edge …: down` and by `status` as `degraded`). Before writing anything, `switch` verifies every other answering link serves the management link's serial, and fails the unit on a mismatch (miswiring, or two un-aliased boards merged on one address). `scan --init` groups same-serial hits into one unit automatically, with the links ordered I²C first, then CAN, then serial. The wired-local route manages, and the network and debug routes are fallbacks. Reorder them freely, since manifest order is authoritative. The parser rejects one route or one pinned serial declared by two units, and `switch` fails a unit whose observed serial another unit already claimed.

### 5.2 Converge

```sh
nxs suite switch --dry-run
nxs suite switch
```

```
✓ imu-mast (i2c /dev/i2c-9@0x30)
    recorded serial 2f004b0032510f0011223344
    deploy panel: Iam20680
    active: Iam20680 (slot 0)
✓ fl-knee (can can0 node 10)
    commission node-id 10 (now 125; adopts on next power-cycle)
    deploy panel: Iam20680
    active: Iam20680 (slot 0)
```

Per unit, switch works in a fixed order: it opens the management link (the first of `links` that answers), checks the serial, verifies cross-link identity, flashes firmware where pinned (§5.4), commissions the node-ID on every CAN link, and converges the driver panel. Switch is idempotent and repairs proportionately. A unit that already matches reports `converged` and is not written to. A parameter tuned away from the manifest (`retune sample_rate 500→250`) is fixed in place with no store wipe and no sample gap. Only a wrong driver or a changed sensor list redeploys the panel. Units fail independently, the exit code is non-zero when any unit failed, and `--unit NAME` restricts a run to one unit.

### 5.3 Identity: role names, serial as the guard

A unit is one board, named by its role, and its `links` are the routes that reach it. A replaced board inherits the role's configuration with no manifest edit. The serial is the guard against miscabling: an explicit `serial:` pin fails switch on mismatch, and without a pin the serial recorded on first contact is verified on every later switch — over the management link, and against every other declared link that answers. A deliberate board swap on an unpinned unit is accepted with:

```sh
nxs suite switch --accept-new-serial
```

The flag never overrides a manifest pin — a pinned swap is a manifest edit.

On a shared CAN trunk, factory-fresh units all boot at node-ID 125, so bring them up one at a time: power one on, `nxs suite switch` — it is found at 125, commissioned to its declared `node_id`, its serial recorded — then power the next and re-run. Each run converges one more unit, and the finished ones report `converged`.

### 5.4 Firmware pinning

`firmware: "X.Y[.Z]"` pins a unit to a version held in `/opt/aliensense/firmware/`. The pin matches the version in each image's MCUboot header — filenames are irrelevant. Switch flashes on any provable mismatch, up **or down**: a release build identity proves its full version and decides alone, while a device serving a prerelease or untagged identity proves no version and converges through the tool's own flash records. Rollback is editing the pin and re-applying.

```sh
cp nxs-v1.0.signed.bin /opt/aliensense/firmware/
nxs suite switch
```

A unit whose running version differs from the pin is flashed — up or down.

The device reports its full build identity on every transport (the `aliensense.nxs.fw.describe` register over Cyphal, the build-info transfer over I²C; Interface Description §6.10), with legacy firmware falling back to a bare MAJOR.MINOR. A MAJOR.MINOR mismatch always flashes, and the state file refines convergence to the exact pin: a recorded patch different from the pin flashes, while a proven MAJOR.MINOR match with no record is left alone, so a correctly-pinned unit is not reflashed on its first switch. On firmware old enough to predate the `FW_VERSION` registers, I²C serves no version, so the first pinned switch flashes once and later applies trust the record.

### 5.5 Tune, then freeze

Manual `nxs` verbs work on suite-managed units — imperative tuning is the authoring mode. `--unit` addresses a declared unit by name (the manifest supplies the transport and link, replacing `-t/-b/-p/-a`):

```sh
nxs --unit imu-mast caps
nxs --unit imu-mast set accel_fs 16
nxs --unit imu-mast stream --hz 50
```

A flag-addressed change to a declared unit prints a breadcrumb (never a block):

```sh
nxs -b /dev/i2c-9 -a 0x30 set accel_fs 16
```

```
note: unit 'imu-mast' is suite-managed — this change reverts on
`nxs suite switch`; keep it with `nxs suite freeze --unit imu-mast`
```

Both resolutions are one command. `switch` makes the manifest win (the device is retuned back). `freeze` makes the device win — it adopts the active driver's full live parameter set into that unit's `config:` in suite.yaml, editing only those values (comments and layout survive):

```sh
nxs suite freeze --unit imu-mast --dry-run
nxs suite freeze --unit imu-mast
```

```
✓ imu-mast: froze
    accel_fs: 8→16
```

```sh
nxs suite switch
```

The switch recompiles the stored image so the tuning survives power-cycles.

`--all` freezes every declared unit. `--pin-firmware` also records the running firmware version where the transport serves one. Freeze updates declared units and drivers only — a tuning session on an undeclared driver needs its one-line manifest entry first.

### 5.6 Decommissioning

A unit leaves the suite in two explicit steps: blank it while it is still declared, then delete its manifest entry. Deleting the entry alone deprovisions nothing — the tool never touches devices the manifest does not claim.

```sh
nxs suite reset --unit imu-mast
```

```
✓ imu-mast (i2c /dev/i2c-9@0x30)
    stopped driver, cleared store
    forgot recorded state (serial, firmware, panel)
```

A blank reset keeps the board addressable: node-id, subject remaps, and decimation factors survive, so the unit is one switch away from service. `--factory` additionally reverts the node-id to the compiled default and the decimation factors to their shipping values. On a shared CAN trunk this returns every factory-reset unit to node 125 simultaneously, so factory-reset shared trunks one unit at a time. `--all` resets every declared unit and requires `--yes`.

The panel alone can be decommissioned declaratively: an explicit `sensors: []` means "enforce an empty store" — the next switch stops the driver and clears the store, and a driver appearing later reads as `driver` drift. An absent `sensors` key means the panel is unmanaged and switch leaves it alone.

State entries for units no longer in the manifest are never deleted automatically: the TOFU serial is a trust anchor, and dropping one silently would re-open the trust-on-first-use window. Switch prints a note when such entries exist, so drop them explicitly:

```sh
nxs suite collect-garbage
```

```
dropped unit-can1-125
```

### 5.7 Generations: snapshot and rollback

Every fully-converged switch records the manifest as a generation in a tool-managed repository under the state directory (a byte-identical manifest records nothing, and partial converges never record). Tag a validated configuration and return to it when a later experiment goes south:

```sh
nxs suite snapshot field-day-1
nxs suite list-generations
```

```
tagged field-day-1 at generation 3f2a91c
3f2a91c  2026-07-18 14:02  2/2 converged  [field-day-1]
9c01b44  2026-07-18 11:40  2/2 converged
```

```sh
nxs suite rollback field-day-1
```

The rollback restores that manifest over the live file and re-applies. Convergence is per unit: an unreachable unit catches up on a later switch. The state file is never versioned or restored — trust history is not intent. One retention rule: never delete a firmware image that a recorded generation pins. The pin rule flashes down as well as up, so returning to an old generation needs its image still in `/opt/aliensense/firmware/`.

The field flow: tune imperatively, `freeze`, switch (a generation records), `snapshot <label>` once validated — and `rollback <label>` when needed.

### 5.8 Time discipline

A converged switch seeds each unit with the host's clock offset, so the suite shares one timescale — synced units render their status LEDs in phase, and the Cyphal SI subjects carry comparable timestamps. The operating posture is a resident pusher that keeps every unit disciplined continuously (the ROS 2 bridge refreshes on the same cadence while it runs):

```sh
nxs suite timesync
```

```
disciplining 2 units every 1 s
✓ unit-imu-mast  ±180 µs
✓ unit-fl-knee  ±140 µs
```

Pushes repeat every second; the loop prints state changes only, so a healthy installation stays quiet after the first round. `--unit <name>` (repeatable) disciplines a subset, `--once` runs a single round printing every unit, and per-unit `nxs timesync` serves a manual route. Each push carries the estimator's offset, error bound, fitted clock rate, and a validity window sized at ten push cycles, so units hold synchronization to well under a millisecond between pushes. Every push is verified against the unit's reported discipline record; a push the unit does not apply reports as a failed round. The discipline expires when ten consecutive pushes are lost — a stale unit reports unsynced rather than serving a bound nobody maintains, and the expiry scales with the configured cadence. For unattended operation, emit the pusher as a systemd service and enable it; the emitted unit runs as the invoking user with the installed tool's path:

```sh
nxs suite timesync --systemd | sudo tee /etc/systemd/system/nxs-timesync.service
sudo systemctl daemon-reload
sudo systemctl enable --now nxs-timesync
```

`suite status` reports each unit's discipline in the SYNC column: `±<bound>µs` while fresh, `-` when never synced or stale. The full mechanism — surfaces, record layout, semantics — is [Interface Description §6.8](../nxs-host-interface/).

### 5.9 Drift and health

```sh
nxs suite status
```

```
UNIT      LINK                 STATE  DRIVER    VM       FW   SERIAL  DRIFT   SYNC  CAL  SAMPLES
imu-mast  i2c /dev/i2c-9@0x30  up     Iam20680  running  -    ok      config  -     ok   12842
fl-knee   can can0 node 10     up     Iam20680  running  1.1  ok      -       -     -    51203
```

```sh
nxs suite scan --diff
```

The diff compares reality against the manifest: silent units, undeclared devices, serial mismatches.

Both are read-only. DRIFT names what differs from the manifest — `config` (parameters, resolved with `switch` or `freeze`), `driver`, `shape` (the stored panel), `fw`, `orientation` (§5.1) — and `-` means the unit matches. CAL is the calibration guard verdict (§4.9): `ok` — solved and active for the running driver; `STALE` — solved against a different driver, recalibrate; `-` — nothing solved.

### 5.10 Serving compiled drivers over Cyphal

The manifest flow uploads per unit. For mass distribution over the Cyphal file protocol instead, compile once and serve to many nodes:

```sh
nxs upload iam20680 -o ./drivers/iam20680.nxs
yakut file-server ./drivers &
```

`-o` produces the artifact with no device attached; the file server serves the directory. Per node, command a `LOAD_FROM_FILE` with the artifact name ([Interface Description §6.1](../nxs-host-interface/)).

Provisioning artifacts are build products with a paired-format lifetime: regenerate the directory with the matching `nxs` tool after a firmware MINOR update — the tool refuses a stale artifact with its rebuild command.

### 5.10 Serving the suite to ROS 2

`nxs ros2` publishes decoded samples onto standard ROS 2 topics, mapped automatically from the device-served field descriptors by semantic — no per-sensor configuration. With a manifest it bridges the whole suite: **each unit becomes its own ROS 2 node** in namespace `/<base>/<unit>`, so `ros2 node list` shows one node per unit. Without a manifest it bridges the connected device, exactly like every other verb. `--unit NAME` narrows to one declared unit; explicit transport flags (`-t`/`-p`/`-b`) always select one ad-hoc device on flat `/<base>/…` topics, even when a manifest exists (`$NXS_*` environment defaults do not — only typed flags override the manifest).

One streaming bridge runs per unit set per host: a second `nxs ros2` (or a second launch) serving the same units refuses to start and names the holding process — concurrent bridges would duplicate every ROS node and contend on the device buses. `nxs ros2 --plan` takes no such lock and runs alongside a live bridge.

Suite roles are dashed (`imu-mast`, `unit-i2c-10-30`); ROS names allow only `[A-Za-z_][A-Za-z0-9_]*`, so the bridge sanitizes each token — `unit-i2c-10-30` publishes as node `unit_i2c_10_30` under `/nxs/unit_i2c_10_30/`, and the `frame_id` takes the same form. On a shared CAN bus the bridge opens one Cyphal node per unit, claiming host node-IDs downward from the tooling default; commission device node-IDs below the top of the ID space (§4.3) so host tooling never collides with a unit.

Install nxs into a sourced ROS 2 environment (§3.5 — one wheel serves both Humble and Jazzy). Preview the topic layout without ROS, then launch:

```sh
nxs ros2 --plan
```

```
imu-mast:
  nxs/imu_mast/imu          sensor_msgs/msg/Imu          accel_x accel_y accel_z gyro_x gyro_y gyro_z
  nxs/imu_mast/temperature  sensor_msgs/msg/Temperature  temp
```

```sh
ros2 launch "$(nxs ros2 --launch-file)"
```

```
publishing nxs/imu_mast/imu  [sensor_msgs/msg/Imu]
time sync imu-mast: ±0.35 ms
```

Verify from a separate shell: `ros2 node list` shows one node per unit (`/nxs/imu_mast/imu_mast`), and `ros2 topic echo --once /nxs/imu_mast/imu` reads `z ≈ 9.81` with the unit flat on the bench.

`ros2 launch "$(nxs ros2 --launch-file)"` runs the shipped launch file — a thin wrapper that starts `nxs ros2` reading the manifest at runtime; compose it into a larger launch tree with `IncludeLaunchDescription`. `viz:=true` also starts RViz2 with a config generated from the manifest — one Imu display per IMU-publishing unit, wired to that unit's `imu` topic — and a static transform per unit, so the IMUs and frames appear at once. The moving element per display is the acceleration arrow; boxes and axes hold still because the bridge publishes no orientation. Pair it with PlotJuggler (`ros2 run plotjuggler plotjuggler`) to plot every numeric stream:

```sh
ros2 launch "$(nxs ros2 --launch-file)" viz:=true stamp:=synced
```

One `Ctrl+C` (or `kill -INT` on the launch process) stops the whole tree — bridge processes, RViz, and transforms — and releases the per-target run locks; an immediate relaunch starts cleanly.

The bridge itself has no visualization dependencies: `rviz2`, `imu_tools`, and PlotJuggler are distro packages on the operator's side, and a headless install runs the bridge without them — `viz` simply stays `false`.

The auto-map, by descriptor semantic:

| Semantics | Message | Topic | Conversion |
|---|---|---|---|
| accel + gyro triads | `sensor_msgs/Imu` | `imu` | none (already m/s², rad/s); no orientation |
| mag triad | `sensor_msgs/MagneticField` | `mag` | none (tesla) |
| temperature | `sensor_msgs/Temperature` | `temperature` | kelvin → °C |
| pressure | `sensor_msgs/FluidPressure` | `pressure` | none (pascal) |
| lat+lon+alt (+ accuracies, `fix_type`) | `sensor_msgs/NavSatFix` | `fix` | rad → deg; accuracy² → diagonal covariance; fix type → status |
| vel N/E/D | `geometry_msgs/TwistStamped` | `vel` | NED → ENU: (east, north, −down) |
| anything else numeric | `std_msgs/Float64` | `<field name>` | none |
| string fields | `std_msgs/String` | `<field name>` | CR/LF stripped |

Conventions:

- **Timestamps.** By default (`--stamp synced`) `header.stamp` is the sample's acquisition time projected into host time via the device's two-way sync surface (Interface Description §6.8) — the launch banner prints each unit's measured bound (~0.1 ms I²C, ~0.3–0.5 ms CAN, ~1–2 ms serial). `--stamp device` publishes the raw device clock (µs since boot — not host time); `--stamp arrival` stamps on receipt. Before the first sync observation the bridge stamps on arrival and warns once. `--stamp itow` builds `header.stamp` from a GNSS unit's own solution epoch — its time-of-week field resolved to UTC against the host clock — on units whose descriptors carry the GNSS epoch semantics (Interface Description §6.6); `nxs ros2 --plan` marks those units epoch-capable. A message without a time-solved fix falls back to the synced projection with one warning. This mode requires an NTP- or PTP-disciplined host clock: the host resolves the GPS week, every non-GNSS topic still carries host-projected stamps, and a fallback transition steps `header.stamp` by the host-to-GNSS clock offset.
- **QoS.** Sensor-data profile (best-effort). Subscribe with matching QoS; `ros2 topic echo` adapts automatically.
- **GNSS validity.** No `NavSatFix` publishes until latitude, longitude, and altitude are all present; a fix-type below fix threshold publishes `status: -1` (NO_FIX) with NaN position — never zeros — and suppresses `vel`. Covariance is the accuracy fields squared (`COVARIANCE_TYPE_DIAGONAL_KNOWN`); altitude is MSL, with any ellipsoidal height on its own `<field>` topic.
- **Frames.** Vectors are in the sensor's own frame; mounting rotation is the consumer's static TF (`viz:=true` seeds a nominal per-unit transform for the bench). `frame_id` is the sanitized unit name (suite/`--unit`) or driver name (ad-hoc); `--frame-id` overrides it for a single device.

`--hz N` thins each unit's stream as in §4.2; `--topic-base` moves the namespace root; `--map FILE` replaces the auto-map with explicit `{message, topic, mapping, constants}` blocks for the rare custom contract (single device only).

## 6. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `probe` times out (serial) | wrong port or baud | port from §3.1; the link is 460800 8N1 |
| `probe` times out (CAN) | host timing ≠ the module's active profile, or wrong MTU | read the module's profile over serial/I²C (`can-bitrate`); bring the interface up per §3.3 with matching rates and `--mtu` |
| any CAN verb fails naming `No buffer space available` | the interface is not getting frames onto the bus, its transmissions unacknowledged | `ip -details -statistics link show <iface>` confirms it as `ERROR-PASSIVE`: terminate the bus (§4.3) and set explicit `sjw` and `dsjw` (§3.3) |
| CAN link unstable, error frames under load | bus not terminated — the module's termination is off by default | terminate both physical ends: `can-term on` at the end modules (§4.3) or external 120 Ω |
| module absent from `i2cdetect` | wiring, wrong bus number | check §3.2; the module answers at `0x30` |
| `image format X.Y, this tool builds ...` on upload | stale compiled artifact | run the printed command: `nxs upload <name>` |
| `device speaks register-map vN; this nxs speaks vM only` | the `nxs` tool and the module firmware are different releases | install the matching `nxs` (§1), or bring the module to this tool's release with `push-fw` (§4.5). The tool refuses a mismatched contract before it can misread the device, but `probe`, `push-fw`, and `recover` stay available so a mismatched module can still be identified and updated in place |
| `Uploaded, but the driver did not come up` | sensor missing / wrong bus wiring | check mikroBUS wiring and the sensor's address in [Device Reference §4](../nxs-device-reference/); the LED blinks fast while the probe fails |
| status LED static (dark or solid) | module not executing | check power and reset; reflash via recovery (§4.5) — no firmware or bootloader state renders a static LED |
| status LED mostly lit, dark winks | stalled in the bootloader | two winks: held in recovery, upload an image (§4.5); three winks: an update is applying, wait; one wink: the image check is not completing, reflash |
| status LED single slow pulse per second | no valid firmware image | upload via recovery (§4.5) — the module holds in this state and needs no window |
| driver refuses a parameter value | outside the allowed set | `caps` lists allowed values per parameter |
| unexpected behavior on a deployed unit | device-side fault visible only in its logs | subscribe to the log stream (§4.9): `yakut sub 8184:uavcan.diagnostic.record.1.1`, and lower `uavcan.diagnostic.severity` for more detail |
| node absent from `yakut monitor` | environment not loaded | `eval "$(nxs env)"` in this shell |
| yakut errors after installing nxs (`ruamel.yaml` conflict) | both tools pip-installed into one site — yakut pins `ruamel.yaml<0.18`, nxs uses a newer one | install yakut isolated, per §3.4: `pipx install yakut` / `uv tool install yakut` |
| repeated reboots after an update | new image failed self-confirm | the module rolled back automatically; re-push a good image |
| `serial changed: recorded ...` on switch | board swapped on that link, or miscabled | intended swap: `suite switch --accept-new-serial`; otherwise fix the wiring |
| both SerDes-shared units refuse switch after aliasing | first contact ran un-aliased; the recorded or pinned serial is a merged read of two boards | re-pin from a fresh `scan --init`, then `suite switch --accept-new-serial` (§5.1) |
| `no image for firmware X.Y.Z` on switch | pin has no matching image in the store | copy the signed image into `/opt/aliensense/firmware/` (§5.4) |
| `ros2: rclpy not found` | nxs not installed into the ROS environment's Python | source the ROS 2 environment and install the wheel into it (§3.5) |
| `ros2: <unit>: serves no output descriptors` | no driver loaded and running on that unit | `suite switch`, or `upload` + `run` on the unit, then relaunch |
| no SI subject traffic while `stream` works | subject decimated or ID 0 | `decimation --subject <name>`; `commission --show` |

Error codes served by the device (`CMD_ERROR`, `ERROR_CODE`) are enumerated in [Interface Description §12](../nxs-host-interface/).
