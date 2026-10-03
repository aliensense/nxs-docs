---
title: NXS — Integration & Operation Manual
sidebar:
  order: 6
slug: v1.1.0-rc2/reference/nxs-integration-manual
---

Applies to: NXS v1.1 · product version 1.1.x · `nxs` tool 1.1.x

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, shipped personalities, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| **Integration & Operation Manual** (this document) | design-in, host setup, workflows |
| [Personality Authoring Reference](../nxs-personality-authoring/) | authoring personalities for unsupported sensors |
| [Camera Personality Reference](../nxs-camera-personalities/) | describing camera chains for the camera ports |
| [MCP Tool Reference](../nxs-mcp/) | operating and configuring through an AI agent |
| [FAQ](https://aliensense.github.io/nxs-docs/hardware/faq/) | frequently asked questions |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

## 1. Quick start

Install the host tool (isolated, no system Python changes). Install `uv` per [its documentation](https://docs.astral.sh/uv/getting-started/installation/) or from your OS package manager, then:

```sh
uv tool install "./aliensense_nxs-<version>-py3-none-manylinux_2_35_aarch64.whl[cyphal]"
nxs --version
```

The wheel is a release asset on the SDK repository, and it carries the DSDL the Cyphal transports compile against, so those transports need no environment. `nxs switch` (§3.2) starts and names the host's camera buses (a stock JetPack then reboots once) and installs tab completion for every `nxs` verb, flag, and argument choice into `/etc/bash_completion.d/nxs`.

The first hour with the hardware is the guides on the documentation site: the [NVIDIA Jetson deployment guide](https://aliensense.github.io/nxs-docs/guides/deploy-jetson/), [Getting started with the NXS unit](https://aliensense.github.io/nxs-docs/guides/unboxing/), [Multi-sensor dashboard on ROS 2](https://aliensense.github.io/nxs-docs/guides/multi-sensor-dashboard/), [Custom sensor personality](https://aliensense.github.io/nxs-docs/guides/custom-sensor/) and [Custom camera personality](https://aliensense.github.io/nxs-docs/guides/custom-camera/). Every command in this manual takes the transport flags below; set them once per shell as `$NXS` (§4).

| Transport | Flags | Host setup |
|---|---|---|
| I²C | `-t i2c -b /dev/i2c-cam1` — the bus may be left out when `$NXS_BUS` is set, when the manifest declares one i2c unit, or when a single unit answers on a camera host's buses | §3.2 |
| Cyphal/serial | `-t cyphal-serial -p /dev/ttyUSB0 --remote-node-id 125` | §3.1 |
| Cyphal/CAN-FD | `-t cyphal-can -p can0 --remote-node-id 125` | §3.3 |

## 2. Hardware design-in

### 2.1 Carrier essentials

* Supply and I/O are 3.3 V. The mikroBUS 3V3 sensor rail is firmware-switched — sensors are power-cycled at personality bind, so do not feed sensor circuits from another rail.
* Sensor reset (mikroBUS RST) is driven by the loaded personality with per-personality polarity. Leave it unconnected for sensors without reset and never strap it to a fixed level. Do not tie RST to CS on the carrier either, because the bootloader reads that pair as a recovery request at every reset (§4.5).
* CAN-FD requires an external transceiver on the carrier rated for the 4 Mbps data phase. Termination per CAN practice (120 Ω at both bus ends): v2 modules carry an on-board split termination that is **off by default** — commission `can-term on` (§4.3) on the two bus-end modules, or terminate externally. v1.0 modules always need external termination.
* The host UART carries the host link in normal operation, and the update protocol during firmware update and recovery. Reserve it for that and do not share it with other carrier functions. Console and log output does not share the port, in the bootloader as much as in the application.
* The socket contract — pin functions, the one-active-personality rule, and the pull-up requirement above 400 kHz on the sensor I²C bus: [Device Reference §2.2](../nxs-device-reference/). Pinout and electrical limits: the NXS product datasheet.

### 2.2 Transport choice

| Transport | Use when | Full node surface? |
|---|---|---|
| I²C (target `0x30`) | The host is an autopilot/MCU polling a register map | full management surface — personalities, parameters, store, commissioning, firmware update, identify; samples by polling; no pub/sub |
| Cyphal/serial (UART 460800) | Point-to-point host link, evaluation, Linux hosts | yes — registers, services, subjects, DFU |
| Cyphal/CAN-FD | Vehicle bus, multiple nodes, longer runs | yes — registers, services, subjects, DFU |

All three expose the same personality, parameter, store, and update procedures; the [Interface Description](../nxs-host-interface/) defines each surface normatively.

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
nxs switch
```

The group change is once per host, effective after re-login; the module answers at `0x30`. `nxs switch` installs the host's files with everything else it realizes (§5.11): udev rules that give every camera-connector bus a stable name (`/dev/i2c-cam0`, `/dev/i2c-cam1`), the file that keeps the crash reporter quiet about the capture daemon, the tab completion, the `nxsd` service, the shared state store `/var/lib/aliensense`, and the declaration's directory `/etc/aliensense`, which the `i2c` group writes (§5). On a Jetson that boots no camera bus, as a stock JetPack image does, it also installs the camera kernel package's I²C multiplexer overlay under the generated boot label `aliensense_gen`, with or without a declaration, and exits 3 with `REBOOT NEEDED`: the camera-connector buses and their names exist from that reboot on. A declared camera later adds its port's camera table to the same label and asks for one more reboot; units without a camera need none. The generated entry's kernel command line ends with `aliensense_label=aliensense_gen`, which tells `switch` that its entry booted: when it has and no camera bus came up, `switch` stops with `host: the boot entry aliensense_gen booted without its overlays`, prints what `fdtoverlay` says of the multiplexer overlay on the entry's device tree where that tool is installed, and names `nxs switch --fdt <dtb>` instead of asking for the same reboot again; `--fdt` naming another device tree rewrites the entry. It asks for your password in a terminal, once per root step, and without a terminal sudo refuses and the step names sudo's answer. Run it as yourself, never under `sudo`.

A camera port needs two more things before its verbs answer: the camera kernel package for the booted Jetson Linux release, `nxs-jetson_<l4t>_arm64.deb` from its release page (the [NVIDIA Jetson deployment guide](https://aliensense.github.io/nxs-docs/guides/deploy-jetson/) installs it), and the release's assets, which `nxs assets install` fetches for the tool's own version (or takes as a downloaded `nxs-assets-<version>.tar.gz`) and lands under `/opt/aliensense`, owned by root whatever machine packed it, after the license is accepted once. The assets carry the sealed camera personalities the units run, the Hub's and serializer's images the host runs, and the pod firmware; assets of another release are refused by name. The descriptor pack (the chip descriptors, the carrier topology) ships inside the wheel; nothing installs it. Supported hosts: the NVIDIA Jetson Orin Nano Developer Kit (the p3768 carrier) on Jetson Linux 36.4.4 (JetPack 6.2.1) and 39.2.1 (JetPack 7.2.1); other carriers and releases on request. On JetPack 7.2.1 a camera port also needs NVIDIA's camera hotfix (the guide's step 3): the capture stack's configuration mode, which the tool runs to build a port's tuning, is refused on a stock image.

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

`nxs get can-bitrate` reads the module's persisted profile (Interface Description §8.2.7). The explicit `fd off` matters: Linux keeps CAN control-mode flags across reconfigurations, so an interface previously brought up with `fd on` stays in FD mode unless the flag is named. The host interface must match the module's *active* profile exactly — bitrates and sample points (0.875 / 0.750); a mismatch shows as error frames under load, and FD and Classic nodes cannot share a segment. Classic profiles carry control, telemetry, and decimated streams; full-rate raw capture needs an FD profile (Device Reference §3).

### 3.4 Stock Cyphal tooling

Stock OpenCyphal tools read their DSDL and their node-ID from the environment. The wheel carries the DSDL; export the three variables that point `yakut` at it:

```sh
uv tool install yakut
export CYPHAL_PATH=$(python3 -c 'import nxs, os; print(os.path.join(os.path.dirname(nxs.__file__), "dsdl"))')
export CYPHAL_ALLOW_UNREGULATED_FIXED_PORT_ID=1
export UAVCAN__NODE__ID=127
yakut monitor
```

`CYPHAL_PATH` names the namespace roots to compile, the allow-unregulated flag admits the vendor service's fixed port-ID, and `UAVCAN__NODE__ID` is the host's own node-ID on the bus — any free ID, 127 by convention. Node 125 appears with a heartbeat.

### 3.5 ROS 2 host environment

The ROS 2 bridge (§5.10) requires a ROS 2 environment on the host, installed per the ROS 2 project's documentation for the host's OS release (Ubuntu 22.04 → Humble, Ubuntu 24.04 → Jazzy). The nxs wheel is a platform wheel for the host's architecture (`manylinux_2_35_aarch64` on Jetson, `manylinux_2_35_x86_64` on a workstation) and installs on any distribution with glibc 2.35 or newer. Any other host, macOS among them, takes the pure wheel, `py3-none-any`: it carries the compiler and `nxs personality check`, and no runtime library, so no verb on it reaches a unit.

Two NXS-specific requirements on top of a stock ROS 2 install:

```sh
source /opt/ros/<distro>/setup.bash
python3 -m pip install 'aliensense-nxs[cyphal,ros2] @ file:///tmp/aliensense_nxs-<version>-py3-none-manylinux_2_35_aarch64.whl'
```

On Ubuntu 24.04 the system interpreter refuses that install with `externally-managed-environment`; add `--break-system-packages`, because the bridge has to share `rclpy`'s interpreter and a virtual environment does not see it.

* nxs must be installed into the sourced distro's own Python: `rclpy` ships with the distro, so an isolated `uv tool` environment cannot see it. `nxs ros2 --plan` alone needs no ROS.
* The visualization launch (`viz:=true`, §5.10) uses `rviz2` with the `imu_tools` Imu display and PlotJuggler; install those packages for the distro to use it.

## 4. Operating

Set the transport once per shell (examples use CAN; substitute your transport flags):

```sh
export NXS="nxs --transport cyphal-can --port can0 --remote-node-id 125"
```

### 4.1 Personalities and parameters

```sh
$NXS upload iam20680
$NXS caps
$NXS get sample_rate
$NXS set sample_rate 250
$NXS status
```

`upload` compiles a personality from the shipped set and runs it. `caps` lists every parameter with its allowed values and defaults, a parameter the unit applies in place tagged `[live]` (§6.4 of the Interface Description: the others reload the personality); `set` re-configures the sensor live. An addressed `status` ends with the `Outputs:` block — each field's name, type, scale, offset, unit, and semantic — so the host can decode the sample record without a driver of its own. `get` on a name neither the personality nor the device carries answers `no parameter <name>` and lists both families, one ` -` line each.

A full-scale change on an IMU (`set accel_fs 16`) retunes the output scale on the device; streamed values stay SI with no re-upload.

A personality may expose an upload-time configuration key in addition to runtime parameters — for a choice that changes the compiled image rather than a patchable value. A register whose reserved bits mandate read-modify-write has no runtime personality site, so its setting is a compile-time key:

```sh
$NXS upload iim20670
$NXS upload iim20670 --config accel_fs=4
```

The first form compiles with the config defaults; the second recompiles with a different full-scale.

Changing a config key is a re-upload; to switch without a host, save each configuration to a store slot (`store save 0` / `store save 1`) and cycle.

A camera personality takes the same verb. It programs the image sensor on the unit's pod, so it lands in a store slot instead of running on the sensor runner, and the camera verbs run it from there under the bus token ([Interface Description §6.11](../nxs-host-interface/)):

```sh
nxs cam1 A upload imx900
nxs cam1 A store ls
nxs cam1 A status
nxs cam1 A store rm 1
```

`upload` resolves a name against the personality store (`/opt/aliensense/personalities/<name>.nxs`, the shipped sealed set), then the built-in drivers, then a descriptor pack's sensor pair, and takes a file of either kind (`.nxs`, or a source pair); the bare `nxs upload <name>` works when exactly one unit answers on the camera buses. A unit runs one camera personality: an upload overwrites the camera slot the unit holds in place, and `--slot` lands it in the slot it names, after the populated slots when that one is empty. The upload's line names the slot the image took, and the sensor personalities keep theirs. `store ls` prints each slot's personality and kind; the link's `status` line names the unit's camera personality, its slot, its last run (`never run` before the first) and the line time and frame length that run achieved; `store rm <slot>` frees the slot. The driver personality in slot 0 keeps auto-loading at boot: the sensor runner never loads a camera slot. A bare `nxs status` names the store the host resolves from, how many personalities the assets ship into it and how many are installed beside them.

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
$NXS set decimation 1
$NXS set decimation.temperature 25
```

```
decimation = 1 (applies live; persists on nxs commission --save)
decimation.temperature = 25 (applies live; persists on nxs commission --save)
```

`set decimation 1` opens the device gate to every sample; the per-subject factor publishes temperature at 1/25th of the sample rate. `get` reads either back, and the sample FIFO's depth is the third device parameter of the stream path (`nxs get fifo-depth`, `nxs set fifo-depth N`; `0` means all the storage holds).

Factors persist with `commission --save` (§4.4) — not with `store save`, which persists only the personality.

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
$NXS get can-bitrate
$NXS set can-bitrate 1000000
$NXS commission --save
```

`commission --can-bitrate 1000000/4000000` stages the pair inside a commissioning run. Supported profiles: Device Reference §3. A node whose profile does not match its bus is unreachable over CAN but stays reachable over the serial link and I²C — rewrite the profile there.

The on-board split termination is part of the same commissioning session. It applies **live** (no reboot) and is off by default — turn it on only at the two modules sitting at the physical bus ends. The read prints `off` on a factory-fresh module, the toggle applies immediately, and the save persists it; an unsaved change reverts at the next power-cycle:

```sh
$NXS get can-term
$NXS set can-term on
$NXS commission --save
```

`commission --can-term on` folds it into a node-ID session. A live `set can-term off` on a module providing the bus's only end-termination degrades the bus under you — if the link drops before the Save, power-cycle: the unsaved change reverts.

### 4.4 Persistence model

Running configuration and startup configuration are distinct. `store save <slot>` persists the personality; `commission --save` persists identity, subjects, decimation, the running calibration record, the CAN bit timing, and the termination selection (the calibration verbs of §4.9 persist by default). Anything not saved reverts at power-cycle.

```sh
$NXS store save 0
$NXS store ls
$NXS store rm 0
```

Slot 0 auto-loads at boot.

### 4.5 Firmware update

Over any transport, with automatic rollback on a failed boot (watchdog + self-confirm). A pod behind the Hub takes its update over the host link through the Hub, and that rollback is its field recovery: the serial recovery of [Interface Description §7.4](../nxs-host-interface/) needs the pod's UART, which the coax does not carry.

```sh
$NXS push-fw /opt/aliensense/firmware/nxs-v1.1.0-firmware.bin
```

```
  nxs-v1.1.0-firmware.bin  ━━━━━━━━━━━━━━━━━━━━━━━━ 100%
  ✓ updated: v1.0.0-4-gabc1234 → v1.1.0
```

The bootloader installs any validly signed image whatever its version, so re-serving an older release is the rollback. To keep that from happening by accident — a stale wheel, the wrong artifact — the tool names both versions and asks before it installs an older one:

```
  ! nxs-v1.0.0-firmware.bin is 1.0.0; the module runs v1.1.0-4-gabc1234
install the older image? [Y/n]
```

Answer `n` and nothing is pushed (exit status 1). `--allow-downgrade` answers for a script, and is what a deliberate rollback passes. A module whose identity names no release — a release-candidate tag, an untagged build — is not compared, and pushes unquestioned.

The module reboots into the new image after the transfer and confirms it on its own. The tool reads the module's build identity before the push and again once the module answers after the reboot (it waits up to 30 s), and reports one of three outcomes: `✓ updated` with both identities, `✓ unchanged` when the module already ran the pushed image, or `✗ rejected or reverted` (exit status 1) when the module still serves an identity other than the pushed file's — the bootloader refused the image or rolled it back; read the device log (§4.8). A file that is not a signed MCUboot image (`zephyr.bin` instead of `zephyr.signed.bin`, a truncated download) is refused before the module is touched:

```
  ✗ zephyr.bin: not an MCUboot image (no header magic) — push zephyr.signed.bin, not zephyr.bin
```

`$NXS confirm-fw` confirms the running image explicitly. The shipped firmware self-confirms after 1 s of healthy running, so the verb is idempotent there; it is the required step on a build configured for host confirmation ([Interface Description §7.2](../nxs-host-interface/)).

```sh
$NXS probe
```

The module is back, reporting `register map: v1`.

If an update is interrupted, the module keeps running the old image; the abandoned session releases itself within 6 s, and a `push-fw` retry is enough. A new image that faults, hangs, or fails to confirm is rolled back automatically at the next reset (watchdog + self-confirm). Recovery is therefore a last resort, needed only when the application is too broken to boot the normal update path.

#### Serial recovery

```sh
$NXS recover
```

The module reboots into MCUboot serial recovery on the host UART and holds there until an upload completes. There is no window to catch. `push-fw` does not operate in recovery. (`$NXS reboot` is the plain cold reset: no recovery, a staged update swaps in, an unconfirmed image reverts.) Upload with `smpmgr` or `mcumgr`:

```sh
smpmgr --port /dev/ttyUSB0 --line-buffers 8 image upload /opt/aliensense/firmware/nxs-v1.1.0-firmware.bin
smpmgr --port /dev/ttyUSB0 os reset
```

Recovery runs the port at 115200 8N1, which is the default of every mcumgr client, so no baud option is needed. The application's 460800 does not apply here — a client pinned to it gets no response.

Every upload prints one warning before it starts, and it is expected on every unit:

```
WARNING  Error reading MCUMgr parameters: ... rc=<MGMT_ERR.ENOTSUP: 8>
```

The bootloader implements the subset of SMP that recovery needs, and the optional parameters query is not part of it, so the module answers "not supported" and the client falls back to a conservative frame size. `--line-buffers 8` supplies the value that query would have returned. Without it the upload still succeeds, roughly a third slower. A recovery upload replaces the application directly; an image left staged by an interrupted update is applied first at the next boot and takes precedence over it. Full procedure: [Interface Description §7.4](../nxs-host-interface/).

Three entrances reach that state. Each one covers a failure the entrance above it cannot.

| Entrance | Use when |
|---|---|
| `$NXS recover` | the application still answers on a host transport |
| mikroBUS `RST`–`CS` bridge, then reset | the application boots but stops answering |
| reset with no valid image in the application slot | the slot is erased, unsigned, or corrupt. Nothing beyond power is needed |

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

An MCU host without Cyphal reads the same data through the register map: descriptor window once at integration time, then one latched read of the sample record per sample — acquisition timestamp, sequence number, and data in a single coherent snapshot — decoding `raw × scale + offset` per field. The record's latch-time field also gives the host a device-clock sync observation per poll. A host that needs every sample, such as a visual-inertial estimator, drains the sample FIFO instead: one read returns the queued samples in order, each with its own timestamp, and a late host loses nothing inside the queue's depth. While a camera run holds the host off the pod's bus (about two seconds, at a port's bring-up and at a reconverge), a host that drains over I²C loses the samples past the queue's depth for that window, 85 records at the default depth; the CAN and serial transports keep delivering through it. Registers, the record and burst layouts, and the sync method: [Interface Description §3–§6](../nxs-host-interface/).

### 4.7 The status LED, and locating a unit

The green status LED renders the module's state as a moving pattern. Two families share the LED, and their backgrounds are opposite, so which family is running is legible before any pulse is counted.

**Normal operation** draws short pulses on a dark background. One flash per second is idle with no personality running. A double pulse is the heartbeat, and the unit beats it once for each job it runs: a sensor personality measuring, and a camera personality whose last run left its sensor streaming. A unit running both shows two heartbeats back to back. A camera head its unit parked in standby does not beat, which is how `off` leaves each unit it reaches. Three fast ticks after the heartbeat mean samples were lost since boot or since the last host-commanded restart: the sensor announced data while the unit was still busy with the previous sample, or the personality reloaded on its own. A fast blink near 5 Hz is a sensor or a camera head that is not answering. A three-flash burst is a personality fault whose error code is readable over any transport, or a camera run that faulted.

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
$NXS set orientation YAW_90
# orientation = YAW_90 (applied and persisted)
$NXS get orientation                  # print the current code
```

Every `calibrate` verb that needs samples (gyro, accel, mag, encoder-zero) first checks that the loaded personality is measuring; a personality whose sensor is not answering declares its vectors but delivers no samples, so the verb refuses before any command reaches the device instead of waiting out the procedure's stillness timeout. The device applies the same gate: a raw `CAL_GYRO` or `CAL_MAG_START` against a personality that is not measuring answers `ENODATA`, and the boot-time gyro pass arms only once the personality delivers samples.

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

Accelerometer — a bench procedure of six still poses, each axis up and down, then two check poses, corner-up with every axis between 40% and 80% of the reading and the same flipped corner-down, all auto-captured on stillness. The solve fits one offset and one scale per axis to the magnitude of gravity, so a pose needs no seating, only its axis within about 37° of vertical. The check poses take no part in the fit; the run is refused if either corrected length is more than 3 % off g, if a recovered scale leaves 0.8..1.2, or if an offset exceeds a tenth of g:

```sh
$NXS calibrate accel
# ✓ +Z  (0.998 g)
# ...                                 # six poses, then check and flipped
# solve: scale (1.0132, 0.9871, 1.0044), offset (+0.152, -0.203, +0.248) m/s^2, check poses 0.31% off g
# ✓ applied + persisted (tag Iam20680)
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

Each solved bucket is guarded by the personality it was solved against. After a sensor swap the stale calibration goes inactive and only the mount rotation still applies. `calibrate show` names the mismatch, and `nxs status` prints `! cal: STALE` under the unit (§5.8). Recalibrate after any sensor change.

### 4.10 Discovery and status

Two commands answer two different questions. `nxs probe` discovers what is physically present — it sweeps every leaf I²C bus for hubs, NXS units (identified by serial), and bare sensors, and consults no configuration at all. `nxs status` reports the declared machine against reality: every manifest port and unit is marked present or absent over its routes, and several declarations answered by one serial are collapsed into the one physical board they are, with a hint to declare it once.

```sh
nxs probe
nxs status
```

Both are read-only on the bus and serve `--json` in the bare form. `probe --json` lists each bus it swept under `buses` and each it could not open under `not_opened`, with the reason. A bare `status` opens with `declaration: IN TUNE`, or `declaration: OUT OF TUNE (N finding(s))` and the findings that belong to no node, with the declared units that do not answer counted after it (`declaration: IN TUNE, 2 units do not answer`), then the personality store, then the ports and the units (§5.8). An addressed `status` — `nxs --unit <name> status`, `nxs -b <bus> status` — is one unit's own report instead: its serial, firmware, personality, VM and runner state, over I²C the camera personality it holds with its slot and last run (`Camera: Imx900 (slot 1, last run DONE)`, `never run` before its first run, `Camera: (none)` when the store holds none), store, sample count, and the `Outputs:` block. Individual devices are still probed directly with `nxs -b <bus> probe` or `nxs --unit <name> probe`.

## 5. Suite provisioning

A multi-unit host — units behind a hub's GMSL link windows, on CAN segments, on serial links — is described once in a manifest and converged with one command. The manifest is declared intent, hand-owned. A separate state file records what the tool learned (first-seen serials, applied versions).

| File | Role | Default location |
|---|---|---|
| `suite.yaml` | declared intent | `/etc/aliensense/suite.yaml` on a Jetson; on another host that file when it exists, else `~/.config/aliensense/suite.yaml` |
| `state.yaml` | tool-recorded facts | `/var/lib/aliensense/state.yaml`, else `~/.local/share/aliensense/state.yaml` |
| firmware store | signed images, matched by header version | `/opt/aliensense/firmware/` |
| personality store | installed personalities, override the shipped set | `/opt/aliensense/personalities/` |

A Jetson has one declaration, `/etc/aliensense/suite.yaml`. `nxsd` runs it at boot, and every verb reads it, whoever runs the verb. `hardware.yaml` lives beside it. `nxs switch` makes `/etc/aliensense` for the `i2c` group (§3.2), so `nxs generate`, `nxs tune` and an editor write there without `sudo`. Before that step `nxs generate` makes the directory the same way and asks for the password once. A declaration left under `~/.config/aliensense/` on a Jetson is not read: `nxs switch` and `nxs status` refuse it and print the `mv` that moves it, with its `hardware.yaml`, to `/etc/aliensense/`.

### 5.1 Manifest

Generate the rig's files from what is plugged in, then declare intent:

```sh
nxs generate
nxs --unit <name> identify
```

`generate` walks every camera port (the hub, each of its links through its window, the unit riding it; a link the hub reports unlocked is `link not locked, nothing behind it`, and two locked links are probed one at a time through their own windows, so each pod is named on its link) and the bare buses, writes `hardware.yaml` — what is wired — on every run, and seeds `suite.yaml` with names, serials and running personalities only when there is none, every I²C address in hex as the tool's lines name it (`alias: 0x31`); an existing manifest is never touched. A unit on a bare bus that runs nothing it names by trial: every personality the tool knows is uploaded in turn, and the one whose sensor answers stays running from RAM and seeds that unit's `sensors:`. A pod behind a hub link is seeded with the personality it reports running. A unit that runs no personality the tool knows, a pod that runs none included, is seeded without a `sensors` key, so the first `switch` leaves its store as it stands (an explicit `sensors: []` clears it). `--dry-run` walks and reports without writing, and without trying a silent unit. `hardware.yaml` holds what answered: a hub the wiring or the platform names that does not answer is reported on one line (`hub … @0x6A does not answer and is not written (check its power and cabling, then generate again)`) and is left out of the file. `--json` prints the walk as data, every port with the nodes that answered on it and what was written. `nxs tune --schema` prints the rig's rules as JSON Schema, the manifest schema narrowed by what is on this rig, for validating a declaration before it reaches the file ([MCP Tool Reference §3.1](../nxs-mcp/)). `nxs tune --freeze --ports` adopts a live port's mode and sync into a manifest that already exists. `identify` strobes each unit's LED (§4.7) to map names to physical boxes. `nxs tune` declares too: it opens a strip for every camera port the platform names and for every unit that answered on one, declared or not, and an undeclared strip's DECLARE knobs (the hub and a sensor per link, or a unit's personality) write its manifest entry at save, so an empty port can be declared before anything is plugged into it.

```yaml
ports:
  cam0:
    bus: /dev/i2c-cam0
    csi_lanes: 2
    hub: {compatible: "maxim,max96792a", driver: nxs}
    camera: {mode: 1920x1080@30, sync: fsync}
    links:
      A: {camera: "framos,imx900", ser: "maxim,max96793",
          des_window: 0x21, csi_vc: 1,
          unit: {name: imu-a, alias: 0x31}}
      B: {camera: "framos,imx900", ser: "maxim,max96793",
          des_window: 0x22, csi_vc: 0}
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
      - personality: iam20680
        config: {sample_rate: 250, accel_fs: 8}
    egress:
      decimation: 1
      subjects: {temperature: 25}
  - name: fl-knee
    module: nxs
    links: [{transport: cyphal-can, iface: can0, node_id: 10}]
    sensors: [{personality: iam20680, config: {sample_rate: 250}}]
```

`ports.<name>.bus` names the connector by its stable udev alias (installed by `nxs switch`, §3.2); a port that names none takes the host's bus for its name. `csi_lanes` is 1 to 4 (omit it to follow the booted overlay, or the connector's lane count on a port that booted no table: 2 on cam0, 4 on cam1). A declared count other than the booted one is a boot-table gap: `nxs switch` installs the declared count's table and asks for the reboot. `camera.mode` takes a geometry token `WIDTHxHEIGHT@FPS` (`WIDTHxHEIGHT-rawN` when two bit depths share a geometry) or a descriptor mode name; the fps sets the sensor's frame length and the capture stack runs at the same rate, or, with `sync: fsync`, it is the hub's frame-sync generator's rate (`sync` is `free_run`, the default, or `fsync`; any other spelling is refused at load). A link declares its own mode and rate as `camera: {sensor, mode, fps}`; free-running links may differ, and under frame sync the pair runs one rate (two declared rates are refused naming both). A link with no declared mode, its own or the port's, runs the highest-resolution mode its port admits (2064x1552 RAW12 for one IMX900 on two lanes, 1920x1080 for the pair, whose program carries RAW10), and `nxs status` judges it there. A port that declares no rate runs at 30 fps, and so does a declared frame sync without a rate. A rate runs from the driver's minimum to the ceiling the sensor datasheet's recommended frame and the CSI lanes give at the port's line: 1.50 to 160.49 fps for one IMX900 at 1920x1080 on two lanes, 1.50 to 80.13 fps for the pair at the deserializer datasheet's line. A synced rate is a whole rate of that range whose trigger frame ends inside the pulse period, and a refused rate names the nearest whole rates the port takes. On two CSI lanes the frame-synced 1920x1080 pair runs at 30 and 50 fps; on four lanes at 60 fps (`csi_lanes: 4` and the four-lane overlay). `on`, `set sync` and `set fps` count two seconds of frames on each camera link they bring up or change, the tool's own viewers on those links stopped first, and refuse a rate the rig does not deliver, naming the rate each link delivered and the whole rate at or under the lowest (`cam0: 60 fps asked, 58.1 delivered on A, 57.9 on B`). `on` then leaves the links unknown, and `set` puts back the sync or the rate that ran before. On a pair `on` reads the hub's line-memory overflow probe around that count and, while the probe reports an overflow, lengthens the pair's line in 5 % steps from the deserializer datasheet's up to twice it, recording the line it finds, which `status` prints beside the verified rate where it is longer. Under frame sync the hub's generator pulses once per frame, and the exposure is the trigger pulse's low time plus the sensor's trigger offset, so the rate sets it; `status` and `set sync fsync` state that fact without a number, and the capture stack's loop drives gain alone. `set exposure` on a synced link, `set sync fsync --exposure` and a declared `camera.exposure_us` are refused with that fact: a shorter exposure needs a higher rate or less light. Under free run a declared `camera.exposure_us` without `camera.gain_db` is refused naming the capture stack's exposure loop, which sets the exposure; `set exposure` sets it on a running link. A frame-synced pair of one camera kind runs one gain: link A's capture session decides it and `nxsd` copies it to link B's head every frame (§5.10), and `nxs cam0 status` names who decides it (§5.11). `camera.gain_db` locks the camera links at one analog gain. `on` writes it to each head once, under the sensor's register hold, after the trigger and before the delivery count, and the capture sessions on those links run their loops locked at it. Under frame sync it locks a pair of one sensor kind; in free run it locks every camera link together with `camera.exposure_us`, the exposure those sessions then run. A gain past the sensor's ceiling or between two of its steps is refused naming the gains that fit (`ports.cam0.camera.gain_db: 48.1 is past framos,imx900's 48 dB`; the IMX900 takes 0 to 48 dB in 0.1 dB steps), and so is a gain on a port the lock does not fit. `set gain` and `set gain_db` on a port whose links run one gain are refused naming `camera.gain_db`. A hub declared `driver: kernel` marks a port whose SerDes a vendor kernel stack programs; nxs then reads it and refuses to write.

Link forms are `{transport: i2c, bus, address}`, `{transport: cyphal-can, iface, node_id}`, and `{transport: cyphal-serial, port[, baud]}`. A top-level `defaults: {firmware: "..."}` sets a suite-wide pin that units may override. Unknown keys and malformed values are rejected with the YAML path named.

A unit-level `orientation:` (a rotation code name, §4.9) declares the mounting: `switch` converges the device to it, `freeze` adopts the device's current code into the manifest, and a mismatch reports as `orientation` drift (§5.8). Solved calibration coefficients never enter the manifest — they are per-unit device state, persisted on the device.

A `personality:` name resolves against the personality store (`/opt/aliensense/personalities/<name>/`, or its earlier locations `/opt/aliensense/patches/` and `/opt/aliensense/drivers/`, both still read) first, then the shipped set; an unknown name fails that unit and names the generation route (the Personality Authoring Reference's datasheet-in → driver-out flow).

Units sharing one host bus behind a multi-link deserializer all answer the fixed register-map address `0x30`. The bus layer must present each at a distinct host-side address via the serializer's I²C address translation — link A's `0x30` becomes `0x31` and link B's `0x32`, the convention `generate` seeds and probes on every leaf bus; the camera heads behind the same hub are presented the same way, at the address of their capture node. The manifest is held to it: with more than one unit behind a hub, every `unit` needs an `alias` that differs from its strapped address, no two may share one, and the load refuses the manifest otherwise, naming the aliases that separate them. A unit alone on its hub may keep its strapped address. Mux parent adapters are excluded, since a trunk only duplicates a child's unit, and any address the manifest declares is swept too. The platform owns the translation, whether in devicetree, the camera stack, or a boot service, and it is programmed before first contact. Two un-aliased units answering one address return merged reads: probe succeeds while the serial belongs to neither board, and writes reach both units at once.

Bus and port values accept any path that resolves to the device. Prefer stable names over enumeration order on multi-connector hosts: the stock `/dev/serial/by-id/...` aliases for serial links, and a udev alias per carrier connector for I²C (`bus: /dev/i2c-cam1`). Link matching resolves aliases, and `generate` reports buses and serial ports by their stable alias when one exists, so transcribed manifests carry connector names.

The optional `egress` section declares the decimation intent — the device-wide gate and the per-SI-subject factors. A declared section is enforced: switch retunes differing factors over the management link and persists them, drift reports them as `egress`, and freeze adopts the live values back into the section. An absent section leaves the factors unmanaged, exactly like an absent `sensors` key.

One board is one unit, however many routes reach it: a board on I²C behind a deserializer *and* on CAN-FD is one entry whose `links` list both. Link order is management priority — every verb uses the first link that answers, so a dropped route degrades instead of failing the unit (reported by `switch` as `edge …: down` and by `status` as `degraded`). Before writing anything, `switch` verifies every other answering link serves the management link's serial, and fails the unit on a mismatch (miswiring, or two un-aliased boards merged on one address). `generate` groups same-serial hits into one unit automatically, with the links ordered I²C first, then CAN, then serial. The wired-local route manages, and the network and debug routes are fallbacks. Reorder them freely, since manifest order is authoritative. The parser rejects one route or one pinned serial declared by two units, and `switch` fails a unit whose observed serial another unit already claimed.

### 5.2 Converge

```sh
nxs switch --dry-run
nxs switch
```

```
✓ imu-mast (i2c /dev/i2c-9@0x30)
    recorded serial 2f004b0032510f0011223344
    deploy panel: Iam20680
    active: Iam20680 (running)
✓ fl-knee (can can0 node 10)
    commission node-id 10 (now 125; adopts on next power-cycle)
    deploy panel: Iam20680
    active: Iam20680 (running)
```

Per unit, switch works in a fixed order: it opens the management link (the first of `links` that answers), checks the serial, verifies cross-link identity, flashes firmware where pinned (§5.4), commissions the node-ID on every CAN link, and converges the personality panel. Switch is idempotent and repairs proportionately. A unit that already matches reports `converged` and is not written to. A parameter tuned away from the manifest (`retune sample_rate 250→100`) is fixed in place with no store wipe and no sample gap. Only a wrong personality or a changed sensor list redeploys the panel. A pod's store holds its camera personality beside the panel, and switch counts and clears the panel's own slots alone, so the camera personality stays. Units fail independently, the exit code is non-zero when any unit failed, and `--unit NAME` restricts a run to one unit.

### 5.3 Identity: role names, serial as the guard

A unit is one board, named by its role, and its `links` are the routes that reach it. A replaced board inherits the role's configuration with no manifest edit. The serial is the guard against miscabling: an explicit `serial:` pin fails switch on mismatch, and without a pin the serial recorded on first contact is verified on every later switch — over the management link, and against every other declared link that answers. A deliberate board swap on an unpinned unit is accepted with:

```sh
nxs switch --accept-new-serial
```

The flag never overrides a manifest pin — a pinned swap is a manifest edit.

On a shared CAN trunk, factory-fresh units all boot at node-ID 125, so bring them up one at a time: power one on, `nxs switch` — it is found at 125, commissioned to its declared `node_id`, its serial recorded — then power the next and re-run. Each run converges one more unit, and the finished ones report `converged`.

### 5.4 Firmware pinning

`firmware: "X.Y[.Z]"` pins a unit to a version held in `/opt/aliensense/firmware/`. The pin matches the version in each image's MCUboot header — filenames are irrelevant. Switch flashes on any provable mismatch, up **or down**. A release image carries its build identity, and a unit runs it exactly when it reports that identity, a release candidate's (`v1.1.0-rc1`) included, as `push-fw` judges a push. A push the unit does not boot into fails the unit with `push-fw`'s line, `rejected or reverted: the device still reports <old>; the pushed image is <new>`. For an image without an identity, a release build identity proves its full version and decides alone, while a device serving a prerelease or untagged identity proves no version and converges through the tool's own flash records. A unit without a pin takes the tool's own release: where the images of two release candidates carry the same header version, the one whose identity is the tool's own build: the tag for a release wheel, the `git describe` of a build between tags. When every image of that version carries another tag, the unit fails with `no image of <tag> for firmware <version>`, the images it found and `nxs assets install`, and nothing is flashed. Rollback is editing the pin and re-applying.

The release's image is `firmware/nxs-v1.1.0-firmware.bin` inside its assets tarball, which `nxs assets install` places in the store.

```sh
nxs switch
```

A unit whose running version differs from the pin is flashed — up or down.

The device reports its full build identity on every transport (the `aliensense.nxs.fw.describe` register over Cyphal, the build-info transfer over I²C; Interface Description §6.10), with firmware that lacks the build-info transfer serving a bare MAJOR.MINOR. A MAJOR.MINOR mismatch always flashes, and the state file refines convergence to the exact pin: a recorded patch different from the pin flashes, while a proven MAJOR.MINOR match with no record is left alone, so a correctly-pinned unit is not reflashed on its first switch. On firmware old enough to predate the `FW_VERSION` registers, I²C serves no version, so the first pinned switch flashes once and later applies trust the record.

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
`nxs switch`; keep it with `nxs tune --freeze --unit imu-mast`
```

Both resolutions are one command. `switch` makes the manifest win (the device is retuned back). `freeze` makes the device win — it adopts the active personality's full live parameter set into that unit's `config:` in suite.yaml, editing only those values (comments and layout survive):

```sh
nxs tune --freeze --unit imu-mast --dry-run
nxs tune --freeze --unit imu-mast
```

```
✓ imu-mast: froze
    accel_fs: 8→16
```

```sh
nxs switch
```

The switch recompiles the stored image so the tuning survives power-cycles.

Bare, `nxs tune --freeze` freezes every declared unit; `--dry-run` prints the block it would write. Freeze updates declared units and personalities only — a tuning session on an undeclared personality needs its one-line manifest entry first. A firmware pin is a manifest edit (§5.4).

`nxs tune` without flags opens the panel. It draws the rig as a tree, one line per node with its live figures: each camera port with its hub, each link with its pod or its bare head, each pod's personalities under it, and the units on a port's own bus under that port. `absent` marks a declared node that does not answer, `new` an answering node the file does not name; nothing else is annotated. The node under the cursor opens its knobs beneath it, and the keys are `↑↓` move, `←→` step a knob through its offered values, `s` save (a timestamped `.bak` beside the manifest, then `saved · … · next: nxs switch`), `f` freeze the node under the cursor (`--ports` on a port or a link, `--unit` on a unit), `i` strobe a unit's LED, `r` read the buses again, `q` quit. A save the laws refuse shows the fact and its alternatives under the tree and keeps the edits. The panel signals no daemon: `nxs switch` realizes what it saved.

### 5.6 Decommissioning

A unit leaves the suite in two explicit steps: blank it while it is still declared, then delete its manifest entry. Deleting the entry alone deprovisions nothing — the tool never touches devices the manifest does not claim.

```sh
nxs --unit imu-mast store clear
```

```
Personality store cleared.
```

A blank store keeps the board addressable: node-id, subject remaps, and decimation factors survive, so the unit is one switch away from service. To hand the board on factory-fresh, revert its identity in the same session:

```sh
nxs --unit imu-mast commission --node-id 0xFFFF --save
```

On a shared CAN trunk that returns the unit to node 125, so revert one board at a time.

The panel alone can be decommissioned declaratively: an explicit `sensors: []` means "enforce an empty store" — the next switch stops the personality and clears the store of sensor personalities, a pod's camera personality staying, and a personality appearing later reads as `driver` drift. An absent `sensors` key means the panel is unmanaged and switch leaves it alone.

State entries for units no longer in the manifest are never deleted automatically: the TOFU serial is a trust anchor, and dropping one silently would re-open the trust-on-first-use window. Switch logs a line naming the entries the manifest no longer declares; drop them by editing `state.yaml`.

### 5.7 Time discipline

A converged switch seeds each unit with the host's clock offset, so the suite shares one timescale — synced units render their status LEDs in phase, and the Cyphal SI subjects carry comparable timestamps. The operating posture is a resident pusher that keeps every unit disciplined continuously (the ROS 2 bridge refreshes on the same cadence while it runs):

```sh
nxs timesync
```

```
disciplining 2 units every 1 s
✓ unit-imu-mast  ±180 µs
✓ unit-fl-knee  ±140 µs
```

Pushes repeat every second; the loop prints state changes only, so a healthy installation stays quiet after the first round. `--unit <name>` (repeatable) disciplines a subset, `--once` runs a single round printing every unit, and the addressed form `nxs --unit <name> timesync` pushes to one unit. Each push carries the estimator's offset, error bound, fitted clock rate, and a validity window sized at ten push cycles, so units hold synchronization to well under a millisecond between pushes. Every push is verified against the unit's reported discipline record; a push the unit does not apply reports as a failed round. The discipline expires when ten consecutive pushes are lost — a stale unit reports unsynced rather than serving a bound nobody maintains, and the expiry scales with the configured cadence. For unattended operation, emit the pusher as a systemd service and enable it; the emitted unit runs as the invoking user with the installed tool's path:

```sh
nxs timesync --systemd | sudo tee /etc/systemd/system/nxs-timesync.service
sudo systemctl daemon-reload
sudo systemctl enable --now nxs-timesync
```

`nxs status` reports each unit's discipline as a `! sync:` line when it deviates. The full mechanism — surfaces, record layout, semantics — is [Interface Description §6.8](../nxs-host-interface/).

### 5.8 Drift and health

```sh
nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 0 installed)
units:
  imu-mast  i2c /dev/i2c-9@0x30  ok  serial 2f004b0032510f0011223344  fw 1.0.0  sensor personality Iam20680
    outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
    ! drift: config
  fl-knee  can can0 node 10  ok  serial 20313447504650150034005c  fw 1.1.0  sensor personality Iam20680
    outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
```

One line per declared unit: its name, the route that answered, `ok`, its serial, its firmware and the sensor personality it measures with, then the outputs it serves. A unit is one node and prints once. `units:` lists the units on their own buses. A unit that rides a camera link (the link names it under `unit:`) prints under its port, after the link rows, and the link's NXS rows list the personalities the unit holds, the sensor personality and the camera personality alike:

```
ports:
  cam0  /dev/i2c-cam0  hub maxim,max96792a
    HUB: id 0xB6 ok
    CSI: 2-lane (port and booted overlay agree)
    link A SER: present
    link A SEN: framos,imx900 (declared; no identity register)
    link A NXS@0x31: present
    link A NXS@0x31: sensor personality Iam20680
    link A NXS@0x31: camera personality Imx900 (framos,imx900), 3 modes, slot 1, last run DONE
    imu-a  i2c /dev/i2c-cam0@0x31  ok  serial 20313447504650150034005c  fw 1.0.0
      outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
```

A personality the unit does not hold is not listed. A unit prints a further `   !` line for each way it deviates and nothing where it agrees — `! drift: config` (parameters, resolved with `switch` or `tune --freeze`), `driver` (the personality), `shape` (the stored panel), `fw`, `orientation` (§5.1); `! cal: STALE` for the calibration guard (§4.9); `! vm: no-probe`; `! serial: MISMATCH`; `! link: degraded …`. A unit that answers and does not run its declared personality, its VM idle, in error or past a failed probe, is a finding under the unit beside its `! vm:` line, `! units.<name>: its declared personality does not run` with `nxs switch` to redeploy it, and the declaration reads `OUT OF TUNE`; `nxs switch` fails such a unit on the redeploy's verdict, `no sensor answered the deployed driver` for a Click that is not the declared sensor. A unit that does not answer at all is a `NO ANSWER` row. A unit on a camera port's bus is read under the port's bus lock: when another run holds that bus past a 20 s wait, as `nxsd` does while it brings the ports up after boot, the unit's row and the port's `HUB` line name that run, `another nxs run holds the bus after 20 s of waiting (nxsd brings the ports up after boot)`, and `--json` marks the unit `held`. The command is read-only on the bus and exits non-zero while any finding stands or any declared node is absent, so a deployment script gates on it. `nxs status --json` serves the same tree as data, with the verdict under `declaration.in_tune` and the list under `declaration.findings`. Each finding is an object: `where` (the manifest path it names), `fact`, `alternatives`, and `text` (the line the command prints). A unit that rides a camera link carries `rides: "<port>/<link>"`, and a link's unit lists what it holds under `personalities`.

### 5.9 Serving compiled personalities over Cyphal

The manifest flow uploads per unit. For mass distribution over the Cyphal file protocol instead, compile once and serve to many nodes:

```sh
nxs upload iam20680 -o ./drivers/iam20680.nxs
yakut file-server ./personalities &
```

`-o` produces the artifact with no device attached from a source personality (a name that resolves to a compiled store image is refused, that image being the artifact already); the file server serves the directory. Per node, command a `LOAD_FROM_FILE` with the artifact name ([Interface Description §6.1](../nxs-host-interface/)).

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

With camera ports declared, `cameras:=true` adds one capture node per camera link the host has brought up (`nxs cam0 on`), publishing `/nxs/<port>/<link>/image_raw` and `camera_info` at the link's declared rate. The node is the GStreamer camera node (`ros-<distro>-gscam`) on the capture source the tool's viewers use, one per link, started one at a time; it publishes `yuv422` frames with the source's own stamp, or `mono8` or `rgb8` under `camera_encoding:=`, where the RGB conversion costs a core per 1080p camera, or `jpeg`, where the host's hardware encoder writes `image_raw/compressed` at the link's rate. The topics publish reliable; `camera_info` and the JPEG stream ride at the link's rate, and a raw 1080p stream's delivered rate is the middleware's. `camera_source:=argus` composes the Isaac ROS Argus node instead where that package is installed. The same frames reach a program without ROS: in Python through `nxs.cam.frames(port, link)`, an iterator of HxWx3 uint8 arrays with the frame's presentation stamp (numpy and the GStreamer Python bindings on the host); in C++ through `nxs::cam::Frames(port, link)` from `libnxs`, each frame as the platform's device buffer (on Jetson a dmabuf of an NV12 buffer, mapped into CUDA or the GPU without a copy) with the sensor's timestamp, exposure and gain for that frame; on a synced pair's link the session runs the link's part as the other consumers do, a follower's or a locked link's loop held at its gain, the ISP's digital gain at unity and its filters off. `nxs::cam::Frames` reads the link's record through `nxs_capture_pair_of` and opens the session through `nxs_frames_open_pair`, which reads a follower's gain from the port's follower heartbeat as the session opens. `nxs_capture_of` and `nxs_frames_open` read and open a link that runs the capture stack's own loop; on a synced pair's link `nxs_capture_of` returns `ENOTSUP`, so a program on those two fails at the read and never opens a session with the loop free there. Such a program moves to `nxs_capture_pair_of` and `nxs_frames_open_pair`. On JetPack 7.2.1 the capture stack serves frames to its GStreamer element only, so a frame session there opens and reports `EIO` on the first frame; the ROS 2 topics and `nxs.cam.frames` are the frame paths on that release. The library and its headers ride the wheel under the package's `_lib` directory:

```cpp
#include <redbrain/nxs/Frames.h>

nxs::cam::Frames frames("cam0", "A");
if (frames.error() != 0) {
    return frames.error();   // ENOENT: the link is not up; ENOTSUP: no capture stack here
}
nxs_frame f{};
while (frames.next(f) == 0) {
    use(f.fd, f.width, f.height, f.pitch, f.timestamp_ns, f.exposure_ns, f.gain);
}
```

```sh
NXS_LIB="$(python3 -c 'import os, nxs._libnxs as l; print(os.path.dirname(l.library_path()))')"
g++ -std=c++20 -I"$NXS_LIB/include" main.cpp -L"$NXS_LIB" -lnxs -Wl,-rpath,"$NXS_LIB" -o main
```

The buffer handed out stays valid until the next frame or the session's end; a session opens on the facts `on` recorded for the link (the capture node, the mode, the geometry, the rate, the exposure window and, on a synced pair's link, its part in the pair's exposure and gain), so the link must be up.

On a frame-synced pair of one camera kind with a pod on each link, link A's capture session decides the pair's gain and link B's runs with its exposure loop locked, so the two cameras run one exposure and one gain. `nxsd` copies A's analog gain to B's head every frame under the sensor's register hold while the port runs frame sync with both links up; its journal reads `cam0: B follows A at 30 fps`, and `cam0: B stops following A (the port runs free)` when the port runs free, parks or changes its rate. `nxs <port> status --json` names each link's part under `sync_live.ae`, and `nxs <port> status` whether `nxsd` copies the gain (§5.11). The camera nodes, `nxs.cam.frames` and the tool's own viewers open each link that way, without ISP digital gain, noise reduction or edge enhancement and with each link's own white balance. Link B's session starts locked at the gain `nxsd` last copied from A, the `gain_db` line of `/var/lib/aliensense/cam/follow/<port>`, so B's first frame runs that gain. A pipeline of your own on link B locks its loop the same way, `aelock=true gainrange="G G" ispdigitalgainrange="1 1" tnr-mode=0 ee-mode=0` on `nvarguscamerasrc` with G = 10^(gain\_db/20), or its loop moves B's gain away from the pair's; where the file names no gain, G is 1 and B's head runs 0 dB until `nxsd` copies A's gain a frame later. `camera_source:=argus` is refused on a pair's links, since the Argus node takes no exposure or gain setting; the launch names `camera_source:=gstreamer`.

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

* **Timestamps.** By default (`--stamp synced`) `header.stamp` is the sample's acquisition time projected into host time via the device's two-way sync surface (Interface Description §6.8) — the launch banner prints each unit's measured bound (~0.1 ms I²C, ~0.3–0.5 ms CAN, ~1–2 ms serial). `--stamp device` publishes the raw device clock (µs since boot — not host time); `--stamp arrival` stamps on receipt. Before the first sync observation the bridge stamps on arrival and warns once. `--stamp itow` builds `header.stamp` from a GNSS unit's own solution epoch — its time-of-week field resolved to UTC against the host clock — on units whose descriptors carry the GNSS epoch semantics (Interface Description §6.6); `nxs ros2 --plan` marks those units epoch-capable. A message without a time-solved fix falls back to the synced projection with one warning. This mode requires an NTP- or PTP-disciplined host clock: the host resolves the GPS week, every non-GNSS topic still carries host-projected stamps, and a fallback transition steps `header.stamp` by the host-to-GNSS clock offset.
* **Camera stamps.** A camera topic's `header.stamp` is the frame's delivery to the capture source mapped onto host time, about one frame period after the start of exposure, not the sensor's start of frame; the C++ frame API's `timestamp_ns` is the sensor's start of frame on the host's monotonic clock. The unit stamps above land on the same host time, so a frame and the samples around it compare on one axis, with the unit's sync bound as the alignment error.
* **QoS.** Sensor-data profile (best-effort). Subscribe with matching QoS; `ros2 topic echo` adapts automatically.
* **GNSS validity.** No `NavSatFix` publishes until latitude, longitude, and altitude are all present; a fix-type below fix threshold publishes `status: -1` (NO\_FIX) with NaN position — never zeros — and suppresses `vel`. Covariance is the accuracy fields squared (`COVARIANCE_TYPE_DIAGONAL_KNOWN`); altitude is MSL, with any ellipsoidal height on its own `<field>` topic.
* **Frames.** Vectors are in the sensor's own frame; mounting rotation is the consumer's static TF (`viz:=true` seeds a nominal per-unit transform for the bench). `frame_id` is the sanitized unit name (suite/`--unit`) or personality name (ad-hoc); `--frame-id` overrides it for a single device.

`--hz N` thins each unit's stream as in §4.2; `--topic-base` moves the namespace root; `--map FILE` replaces the auto-map with explicit `{message, topic, mapping, constants}` blocks for the rare custom contract (single device only).

### 5.11 Camera ports: declare, switch

The model follows NixOS: you declare, the tool realizes, nothing is configured by hand. `suite.yaml` is the declaration (`configuration.nix`), `nxs generate` writes a report of what answered and seeds a first declaration (`nixos-generate-config`), `nxs switch` realizes the declaration idempotently and prints what it changed (`nixos-rebuild switch`; `--dry-run` is `dry-activate`), the assets' images are derivations the pod and the host executor run with parameters, and a saved declaration reproduces the rig on another host with the same wheel and assets. No verb writes the declaration behind your back: `upload`, `set` and `on` never touch it, `nxs tune` edits it for you.

A camera port is declared in three lines and realized in one command. The port names its Hub, each link its sensor and the pod that runs it; the serializer, the deserializer window and the virtual channel follow the pack's rules for the link's name (A rides channel 1, B channel 0) unless the link names them. The bus is the host's fact for the port's name.

```yaml
ports:
  cam0:
    hub: maxim,max96792a
    links:
      A:
        camera: {sensor: 'framos,imx900', mode: mode6_1920x1080_raw10}
        unit: {name: unit-cam0-a, alias: 0x31}
```

`nxs switch` judges the declared ports it brings up first, by the laws `nxs status` runs (§5.8) without the findings against the booted tree, which its boot table step writes; a port whose hub the kernel drives is not one of them, and `nxs status` names its findings. A finding ends the run before any step brings a pod, the boot table or a port to the declaration: it prints as `nxs status` prints it, the key and the fact on one line and each alternative under it, and the run exits 1. `nxs switch` then runs the camera steps in order before the units of §5.2, one line per thing it changed: the host (the bus rules, the capture daemon's quiet, the `nxsd` service, the shared state store `/var/lib/aliensense`, the declaration's directory `/etc/aliensense`; a running `nxsd` of another build than the installed wheel is restarted onto it, `host: nxsd restarted (<old> -> <new>)`, and the step waits for the restarted daemon to construct the ports before the pods are reached through them), the camera buses on a host that boots none (`host: camera bus mux installed under aliensense_gen (FDT <dtb>)`, then `REBOOT NEEDED` and exit 3, §3.2), each declared pod's personality (`cam0/A: pod unit-cam0-a holds imx335, uploading imx900 ... ok`, the declaration is the truth and the pod is brought to it; after an assets update `holds an earlier imx900, uploading imx900`, a slot holding an image of another format version is uploaded over, `holds Imx900 of another format version, uploading imx900` (the name the link's cache recorded for the slot, else `a personality image`), and a port whose pod took a new build comes up again; a pod that refuses the upload ends the run with `cam0/A: the upload of imx900 was refused`; a pod silent at its alias, as after a power cycle of the hub, brings its port up again, which maps the aliases: `cam0/A: pod unit-cam0-a does not answer at its alias 0x31; the port comes up to map it`, or, for a pod alone behind its hub, `answers at 0x30, not at its alias 0x31; the port comes up to map it`, and a pod that answers at neither address ends the run with `cam0/A: no pod answers at 0x31 or at 0x30 (unit-cam0-a)`), the port's boot table (`cam0: boot table installed` and the files the install wrote, then `REBOOT NEEDED` and exit 3, because the ports come up on the booted table), and the ports themselves through `nxsd` when it runs (a reload, or a bring-up the daemon started on its own after a hub power cycle, `cam0: nxsd is bringing the port up; waiting for it`; `switch` waits to see the daemon's `on` of each port end before it reads the units, two minutes at most) or here: a port up under its declaration on a configured capture stack is left as it runs, and one whose declaration changed in any key (a rate, the exposure, the gain, the sync, the lanes, a link's sensor or mode) comes up again, as does one whose booted table has no capture-stack configuration (`cam0: the capture stack's configuration is built when the port comes up`). `switch` ends its wait on `nxsd` at once when the daemon's `on` of a port stops short: a port that needs a reboot ends the run with the daemon's lines and `REBOOT NEEDED`, exit 3, and a refused port ends it with the refusal, exit 1. Every step asks for root through `sudo` when it needs it, at a terminal, and says which file it writes; the tool refuses to run under `sudo`. After the reboot `nxsd` brings every declared port up; on JetPack 7.2.1 the first `on` on a new table builds the capture stack's configuration once the port's heads stream, before the delivery check (about two minutes; `status` reads `preparing the capture stack` meanwhile). A bench without `nxsd` runs `nxs switch` again after the reboot, which brings the port up through `on`, and `on` builds the configuration on JetPack 7.2.1.

`nxs cam0 status` is the verdict: `cam0: hub maxim,max96792a ok, capture stack ready` for the port and `cam0/A: framos,imx900 1920x1080 RAW10 59.9 fps, up, pod unit-cam0-a (imx900, head ok)` per declared link, a synced link at the frame-sync generator's rate, exit 0 when every declared link is up on a ready capture stack and 1 on any gap; the diagnosis (the Hub's identity, the lanes, each link's chain and unit) follows, with the last delivery check that passed under the port's sync line (`cam0: verified 30.0 fps 12 s ago (A 30.0, B 30.0)`, then `, line 766` where a pair runs a longer line than the datasheet's, and `--json` carries it as `verified`). When another run holds the port's bus, as `nxsd` does while it brings the ports up after boot, `status` waits up to 20 s for it. Past the wait it prints `cam0: another nxs run holds the bus after 20 s of waiting (nxsd brings the ports up after boot)`, reads nothing more and exits 1. A pod silent at its alias is sought at the address it straps: `cam0/A: pod unit-cam0-a does not answer at its alias 0x31; a pod answers at 0x30`, with `  - nxs switch` under it, says the hub lost its aliases, as after a power cycle, and `cam0/A: no pod answers at 0x31 or at 0x30 (unit-cam0-a)` says the pod answers at neither. On a port with two camera links a line under the sync line names who decides the pair's gain: `cam0 ae: A leads, B follows (nxsd copies the gain each frame: 21.4 dB on both)` while `nxsd` copies link A's gain to B's head, `cam0 ae: locked, exposure the trigger pulse's low time, gain 20.0 dB on A and B` under a declared `camera.gain_db` (in free run the declared exposure, `exposure 4.0 ms`), and `cam0 ae: per link (the port runs free)` where each link's capture session runs its own loop. A followed pair with both links up whose gain `nxsd` does not copy is a gap: the follower's heartbeat is missing or older than 3 s, or its faults stopped it. `status` then prints `cam0/B: does not follow A (nxsd copies no gain for cam0)` (a stopped follower's reason after the port's name) with `sudo systemctl restart nxsd` under it, and exits 1; `--json` carries the same facts as `ae` (`following`, `heartbeat_age_s`), and a bare `nxs status` names the gap under the port. `nxs cam0 capture --frames 60` proves delivery at the declared rate through the capture stack, one verdict line per up link (`nxs cam0 A capture --frames 60` for one link, or with `--snapshot <dir>` for its frames as JPEG files). A bare `nxs status` judges the whole declaration against the installed packs and personalities: modes must exist for the declared sensor and be one its personality's program carries, fps must sit within the mode's range on the port, the sync source must be one the chain offers, lane counts must carry the mode's rate and, for a pair, both heads' lines together, and every unit parameter must be one of its personality's declared values. Each finding prints under the node it names and the command exits nonzero.

`nxs <port> caps` lists what a link may run at the camera count the selection makes: `nxs <port> <link> caps` is that link alone, `nxs <port> caps` the port's links together (the pair). Each mode follows as a resolution and bit depth with its fps range at that camera count, on a pair with the line it runs, and a mark on the rates whose frame is longer than the datasheet's recommended one (`below 80.13 fps: beyond the datasheet's guaranteed frame (20.7.1)`); then the sync pairs a two-camera port runs under frame sync, and the knobs. A mode the unit's program does not carry is listed too, marked `[no unit program]`, and `on --mode` refuses it; on a pair a mode the pair's program does not carry reads `[runs alone on the port]`, and a mode the port's table boots no row for `[no capture row]`, each without a range (`--json`: `runs_alone`, `capture_row`). `nxs --experimental` reads a descriptor pack root and its overlays and takes a development personality store; nothing under the flag is part of the product.

On a Jetson host the capture stack takes its modes from the booted device tree. `switch` keeps the tree in step with the declaration: when the tree lacks a declared link's mode, a capture channel for a link, or the lane count, it generates the port's overlay from the descriptor pack and the installed personalities, installs it under the `aliensense_gen` boot label as the default and stops with `REBOOT NEEDED`. The rows follow the declaration too: a row's default rate is the declared rate, 30 fps when none, and the table carries the one bit depth the declared modes run, so a change of the declared rate, or a declared mode of another bit depth, installs the overlay again and asks for a reboot. The label carries the overlays of the declared ports alone. When a port leaves the declaration, as when a Hub moves from cam0 to cam1, `switch` drops that port's overlays from the label with one line per file, `cam1: dropped <file> from aliensense_gen: port cam0 is not declared`, and stops with `REBOOT NEEDED`. The `on` of a declared port stops on the same finding, `the boot entry names the overlays of cam0, a port the manifest does not declare`. A mode of another pixel format than the table's, asked of `on --mode` without declaring it, is refused before any write, `cam0/A: 2064x1552 RAW12 boots on no row of this port's table (the table carries one pixel format, RAW10, chosen by the declaration)`, naming the declaration that carries the mode and the modes the table carries. One overlay per port carries both virtual channels, so a second camera on a port needs no further overlay. The boot launcher applies overlays only under an `FDT` line, so the generated label names the module's base DTB: the `kernel_*.dtb` under `/boot/dtb`, and where several are there the one whose first root `compatible` equals the booted tree's; without one, as on a JetPack 7.2.1 image, the vendor DTB in `/boot` that declares it. The install refuses rather than guesses when no file or several files qualify, and `nxs switch --fdt <dtb>` names the file by hand. The launcher applies the label's overlays as a whole and boots none of them when one file is missing, so the label names only files on disk: the install drops an entry for a missing file and prints `dropped <path> from aliensense_gen: no such file …`. `nxs host info` shows the host, its capture stack, its boot entry and what each port booted, and `nxs host modes <port>` prints a port's booted mode table. On JetPack 7.2.1 the capture stack also opens no session without a configuration object for the booted table: the port's `on` derives it from the table once its bring-up has the heads streaming and before the delivery check (one short capture session per mode, each opening a head through the kernel driver, then the daemon restarts), keeps it in the state store under the port and the table's digest and installs it; a table seen before on the same port is installed from the store without a build. The build folds in the vendor's ISP override for each sensor whose descriptor names one (`capture.tuning`: the file's URL and digest), fetched once into the state store; an offline host copies the file where the refusal names it, then runs `switch` again. On JetPack 7.2.1 the build needs NVIDIA's camera hotfix ([NVIDIA Jetson deployment guide](https://aliensense.github.io/nxs-docs/guides/deploy-jetson/), step 3); without it `switch` and `status` name the absent file and the step. Installing the object, built or stored, restarts the capture daemon, which ends any session open on the host's other port; at boot `nxsd` brings every declared port up, each building what its table lacks, before it opens a session. The object lets the capture stack open the booted table; it is not a characterised tuning of the sensor, so colour and noise are the stack's default knob set. On JetPack 6.2.1 the capture stack streams on its built-in tuning, and the tool builds nothing.

`nxs cam0 on` and `nxs cam0 off` are the manual per-port form of what `nxsd` does at boot: `on` composes the declared mode, fps and sync, brings the pod to the declaration too, refuses a link whose head does not answer as the declared sensor, builds the capture stack's configuration the booted table lacks once the heads stream, and ends on the delivery check. `off` stops the port's viewers, gates the capture output off and stands the sensors by, then each pod whose head is up runs its personality's park action and prints `pod B: park (imx900, slot 1)`. A pod it cannot park prints one line, such as `pod B: no park run (no answer)`, and the port still parks. An `on` whose walk stops under way parks what it started before it ends on the step's line with `nxs cam0 status` under it: a pod run still live is aborted (`pod A: its live run aborted`), and for the whole port the park program stands the heads by and each pod whose run ended parks its own (`cam0: parked after the stopped bring-up`). The links stay unknown, so the next `on` and `nxsd` bring them up again. A running `nxsd` reconverges every port whose declaration changed on `sudo systemctl kill -s HUP nxsd`, which is what `switch` sends it, and every port brought up by hand away from it (`on` with `--mode`, `--fps` or `--sensor`, or one link alone): the declaration is the truth. The reload also brings up again a port whose last bring-up in `nxsd` stopped short, and a port `nxs switch` names to come up again (a pod that took a new build, or `the port comes up to map it`), which `switch` records down before it sends the reload. `nxsd` also watches the ports it brought up. Every 5 s it reads each pod at its alias, and a pod silent there on three reads in a row, as after a power cycle of the hub, brings its port up again through `on`, which maps the aliases, and the journal reads `port cam0: a pod stopped answering at its alias; reconverging`. A bring-up that fails runs again every 5 s until the port comes up or one of its links is parked, and one that stops at `REBOOT NEEDED` is left to the next reload, which `nxs switch` sends after the reboot. At start, a port whose hub does not answer yet, as a hub powered after the Jetson, is brought up again every 5 s for 60 s at most (`port cam0: the hub does not answer; constructing again in 5 s`). A bring-up that fails logs the line its `on` ended on beside its status, `port cam0: construction rc=1, refused: cam0/A: no pod answers at 0x31 or at 0x30 (unit-cam0-a)`, after the verb's own lines. At construction and at a reload `nxsd` waits up to 20 s for a bus another run holds, and a wait it outlasts fails that port's bring-up with `port cam0: another nxs cam run holds <lock> — wait for it`, which the next reload brings up again. The watch waits the same 20 s for each look, and past it the look ends with `port watch: another run holds the bus; the next tick reads again`, logged once for a stretch of held looks, and the next look 5 s later reads again. The follower that keeps a synced pair at one gain runs in `nxsd` alone: a bench without it declares `camera.gain_db`. On a host without a ROS 2 environment `nxsd` brings the ports up and holds them; the units are bridged once `aliensense-nxs[ros2]` is installed in a sourced ROS 2 environment and the service restarted. `nxsd` runs the host's declaration, `/etc/aliensense/suite.yaml`; with none there yet it waits for one and logs `no manifest at <path>; holding for SIGHUP` (`journalctl -u nxsd`), and the reload `switch` sends then starts it on the declaration. `switch` hands the ports to the daemon only for that file: `nxs switch -c <file>` brings the ports up itself from the file it names, and the daemon does not run that file at boot. Behind a Hub a link runs the sensor's personality on its pod when it declares one, and on the host at the head's address when it does not, by the same steps; on a port that serves the head on its own bus a link declares a pod, and one without is refused (`cam1/A: link A declares no pod`). A hub link that declares a pod and no camera (`links.A.unit` alone, the unboxing kit) comes up as the link alone: the pod answers at its alias and holds its driver personality, no camera program, boot table or tuning is composed for it, and `status` reads `cam0/A: pod unit-cam0-a (fxos8700), up`. A pod-only link beside a camera link on one Hub is refused as one port: the Hub brings two links up together only as a pair, and a pair is two camera programs, so the pod's link declares its head or comes up alone.

Live adjustments (`nxs cam0 A set fps 25`) are parameters staged on the pod's personality, bounded by the same laws, and never written to the declaration; `nxs status` shows the divergence, and `nxs tune` adopts them (`f` on the port, or `--freeze --ports`) or edits the declaration from lawful options only: modes from the descriptor table, fps from the menu of the selected preset under the selected sync (its detents, 30 and 60 fps and the menu's ceiling, read `· shipped`, and a step toward one that lands within 2 fps of it pulls onto it), unit parameters from their declared value sets. `s` writes the manifest with a timestamped backup and names `nxs switch` as the next command, and `i` strobes a unit's LED to match names to hardware (§5.5).

Same rig on another robot: install the tool, the kernel package and the assets, copy `suite.yaml`, and run `nxs switch` until it exits 0, rebooting each time it prints `REBOOT NEEDED`. A stock image reboots once for the camera buses and, with a camera declared, once more for the port's table. `generate` is for hardware you do not know. Reproducibility is the wheel version plus the assets version plus the declaration; `switch` refuses assets of another release.

## 6. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `probe` times out (serial) | wrong port or baud | port from §3.1; the link is 460800 8N1 |
| `probe` times out (CAN) | host timing ≠ the module's active profile, or wrong MTU | read the module's profile over serial/I²C (`nxs get can-bitrate`); bring the interface up per §3.3 with matching rates and `--mtu` |
| a scripted `nxs` command reports the module absent on Cyphal/CAN, seconds after one that worked | each run is a new Cyphal node reusing the host node-ID with its transfer-IDs restarting at zero, and the module discards a repeat of one it saw in the last 2 s as a duplicate. CAN only — the serial link keeps no such state | leave more than 2 s between commands, or give each run its own host node-ID: `--local-node-id` / `$NXS_LOCAL_NODE_ID` |
| any CAN verb fails naming `No buffer space available` | the interface is not getting frames onto the bus, its transmissions unacknowledged | `ip -details -statistics link show <iface>` confirms it as `ERROR-PASSIVE`: terminate the bus (§4.3) and set explicit `sjw` and `dsjw` (§3.3) |
| CAN link unstable, error frames under load | bus not terminated — the module's termination is off by default | terminate both physical ends: `nxs set can-term on` at the end modules (§4.3) or external 120 Ω |
| module absent from `i2cdetect` | wiring, wrong bus number | check §3.2; the module answers at `0x30` |
| `image format X.Y, this tool builds ...` on upload | stale compiled artifact | run the printed command: `nxs upload <name>` |
| `device speaks register-map vN; this nxs speaks vM only` | the `nxs` tool and the module firmware are different releases | install the matching `nxs` (§1), or bring the module to this tool's release with `push-fw` (§4.5). The tool refuses a mismatched contract before it can misread the device, but `probe`, `push-fw`, and `recover` stay available so a mismatched module can still be identified and updated in place |
| `Uploaded, but the personality did not come up` | sensor missing / wrong bus wiring | check mikroBUS wiring and the sensor's address in [Device Reference §4](../nxs-device-reference/); the LED blinks fast while the probe fails |
| status LED static (dark or solid) | module not executing | check power and reset; reflash via recovery (§4.5) — no firmware or bootloader state renders a static LED |
| status LED mostly lit, dark winks | stalled in the bootloader | two winks: held in recovery, upload an image (§4.5); three winks: an update is applying, wait; one wink: the image check is not completing, reflash |
| status LED single slow pulse per second | no valid firmware image | upload via recovery (§4.5) — the module holds in this state and needs no window |
| personality refuses a parameter value | outside the allowed set | `caps` lists allowed values per parameter |
| `status` prints `Session: held`, or a store verb answers `the device is busy` | a `calibrate` run or a firmware push holds the device until it ends. The boot-time gyro pass is not one of these: it runs for up to 15 s after every power-up but yields to every command, so it never answers busy | wait it out, or end the procedure (Ctrl-C in `calibrate` releases it); see §4.9 |
| unexpected behavior on a deployed unit | device-side fault visible only in its logs | subscribe to the log stream (§4.8): `yakut sub 8184:uavcan.diagnostic.record.1.1`, and lower `uavcan.diagnostic.severity` for more detail |
| node absent from `yakut monitor` | environment not loaded | export `CYPHAL_PATH`, `CYPHAL_ALLOW_UNREGULATED_FIXED_PORT_ID` and `UAVCAN__NODE__ID` in this shell (§3.4) |
| yakut errors after installing nxs (`ruamel.yaml` conflict) | both tools pip-installed into one site — yakut pins `ruamel.yaml<0.18`, nxs uses a newer one | install yakut isolated, per §3.4: `pipx install yakut` / `uv tool install yakut` |
| repeated reboots after an update | new image failed self-confirm | the module rolled back automatically; re-push a good image |
| `serial changed: recorded ...` on switch | board swapped on that link, or miscabled | intended swap: `nxs switch --accept-new-serial`; otherwise fix the wiring |
| both SerDes-shared units refuse switch after aliasing | first contact ran un-aliased; the recorded or pinned serial is a merged read of two boards | re-pin from a fresh `nxs generate`, then `nxs switch --accept-new-serial` (§5.1) |
| `no image for firmware X.Y.Z` on switch | pin has no matching image in the store | copy the signed image into `/opt/aliensense/firmware/` (§5.4) |
| `nxs ros2 needs: pip install 'aliensense-nxs[ros2]'` | nxs not installed into the ROS environment's Python | source the ROS 2 environment and install the wheel into it (§3.5) |
| `ros2: <unit>: serves no output descriptors` | no personality loaded and running on that unit | `nxs switch`, or `upload` + `run` on the unit, then relaunch |
| no SI subject traffic while `stream` works | subject decimated or ID 0 | `nxs get decimation.<name>`; `commission --show` |
| a camera verb refuses with a fact line and ` -` lines under it | the configuration is outside the pack's laws, or the link is not up; the lines under the fact are the alternatives | run one of the alternatives; the mechanisms are in the camera triage runbook |
| `cam0/A: video did not lock` from `on` | a head holding stale state through a byte-perfect program, or a link that never trained; `on` already recovered the links once and ran the plan again | power-cycle the hub, then `nxs <port> status`; `nxs <port> <link> on --sensor <name>` if the head is not the declared part; a head that stays dark is unpowered or miscabled |
| `capture FAILED after N attempts` | the consumer did not see the stream start, or the capture daemon is wedged | `nxs cam0 A on` again; restart the capture daemon |
| `slot N holds a camera personality this nxs cannot read (…)` from `status` or `on` | the slot's image was compiled by another release of the tool | `nxs <port> <link> store rm N`, then upload the store's image (§4.1) |
| `<sequence>: the device did not answer; already off` from `off` | a head the port never brought up answers no standby write | none: the line is a note and the port is parked |
| `nxs: no descriptor pack covers …` on a camera port | the wheel's pack does not cover the hub (another carrier's deserializer), or a source checkout run from the wrong place | reinstall the wheel; a development host names its own pack with `nxs --experimental` and `$NXS_CAM_DESCRIPTORS` |
| `… fps is outside <mode>'s <range>` from `on` or `status` | the declared rate is outside the mode's range on the port: the datasheet frame and the lanes at its line | declare a rate inside it; `caps` prints the range |
| `<port>: 60 fps asked, 58.1 delivered on A, 57.9 on B` from `on`, `set sync` or `set fps` | the rig delivers less than the laws admit at that rate; `set` puts back what ran before | the whole rate the line under it names |
| `<port>: 30 fps asked, 30.0 delivered on A with 2 capture-stack errors, …` with `nxs <port> status` under it | the capture stack reported errors on the stream; they fail it at any rate, so the line names no rate | `nxs <port> status` |
| `<port>: the line memory overflows up to 1458 clocks` from `on` | the Hub's line memory overflows at every pair line up to twice the datasheet's | `csi_lanes: 4` |
| `<port>: under frame sync the exposure is the trigger pulse's low time at 30 fps; …` from `set exposure` or `set sync fsync --exposure`, or the same fact under `ports.<port>.camera.exposure_us` from `on` or `status` | under frame sync the pulse sets the exposure at the rate; in free run without `camera.gain_db` the finding names the capture stack's exposure loop | a higher rate (`nxs <port> set sync fsync --fps 50`) or less light for a shorter exposure; drop `camera.exposure_us` from the declaration |
| `ports.<port>.camera.gain_db: 48.1 is past framos,imx900's 48 dB` from `on` or `status` | the declared gain is past the sensor's ceiling or between two of its steps, or the port is no synced pair of one sensor kind (under frame sync) or declares no `camera.exposure_us` (in free run) | the gain or the key the line under it names |
| `<port>: camera.gain_db locks links A and B at 20.0 dB` or `<port>: link A's capture session decides the pair's gain and nxsd copies it to link B` from `set gain` | the port's links run one gain | declare `camera.gain_db`, then `nxs switch` |
| `no manifest at /etc/aliensense/suite.yaml` | nothing is declared | `nxs generate`, or copy a rig profile there |
| `the declaration on this host is /etc/aliensense/suite.yaml, and <home>/.config/aliensense/suite.yaml is not read here` from `switch` or `status` | a declaration written under `~/.config/aliensense/` on a Jetson, which reads `/etc/aliensense/suite.yaml` alone | the command the line under it names, which moves the file and its `hardware.yaml` to `/etc/aliensense/`, making the directory first as `nxs switch` does where it does not exist yet (`sudo install -d -m 2775 -g i2c /etc/aliensense && mv …`) |
| `assets 1.0.3 at /opt/aliensense, tool 1.1.0` | the assets are another release's | `nxs assets install` |
| `the assets are build <a>, this nxs is build <b>` from `assets install`, `upload` or `on` | the assets were packed by another build of the same version, a development build | install the assets packed with this nxs, or the nxs packed with them |
| `no camera kernel package for <kernel>` | the kernel package is missing or built for another kernel | install the package for this Jetson Linux release |
| `<port>: the hub does not answer at 0x29` | the Hub is unpowered or the coax is off | check power and the coax on the port |
| `<port>/<link>: no head answers at 0x1a` | the head is unpowered or its cable is off | check the cable and power on the link |
| `<port>/<link>: no unit answers at 0x31 on <bus>, and the port is not up` from a verb addressed at the unit (`store ls`, `upload`, `push-fw`, `--unit <name> stream`) | the unit rides a link of a port that is not up, so no alias reaches it | `nxs switch`, which brings the port up and maps the aliases |
| `<port>/<link>: no unit answers at 0x31 on <bus>` with `nxs <port> status` under it | the port is up and the unit does not answer at its alias | `nxs <port> status` names the link's pod and what answers |
| `<port>/<link>: no pod answers at 0x31 or at 0x30 (<name>)` from `switch` and `status` | the declared pod answers at neither its alias nor the address it straps | check the pod |
| `<port>/<link>: pod <name> does not answer at its alias 0x31; a pod answers at 0x30` from `status` | the hub lost its aliases, as after a power cycle | `nxs switch`, which brings the port up and maps the aliases |
| `<port>/<link>: pod <name> does not answer at its alias 0x31; the port comes up to map it` from `switch` | the hub lost the aliases, as after a power cycle; `switch` brings the port up, which maps them | none: the line is a note |
| `<port>: pod A: timing: the unit's run did not end within the walk's wait` with `nxs <port> status` under it, from `on` | the pod took the run and reported no end within the walk's 30 s wait; `on` aborted the run and parked what the walk started | `nxs <port> status` names the pod's last run |
| `<port>/<link>: no pod answers at 0x32 or at 0x30 (peek slot 0: Remote I/O error)` from `on` | no unit answers at the link's alias or at the address it straps when its store is read | check the pod |
| `<port>/<link>: no pod answers at 0x32, a unit answers at 0x30 (…)` from `on` | the hub lost the link's alias, as after a power cycle | `nxs switch`, which brings the port up and maps the aliases |
| `link <link>: no lock at 6 or 12 Gbps: serializer absent, or programmed on a link that does not carry 12 Gbps` from `on` | the link locked at neither rate the hub listens at | check the coax and the head's power on that link |
| `<port>/<link>: link <link> declares no pod` | a link without a pod on a port that serves the head on its own bus | add `links.<link>.unit` |
| `<port>: no link <link> in the declaration (declared: <links>)` | the verb names a link the port does not declare | add `links.<link>`, then `nxs switch` |
| `<port>/<link>: declared <sensor>, the head does not answer as one` | the head behind the pod is not the declared sensor | check the head, or set `links.<link>.camera` |
| `REBOOT NEEDED` after `<port>: boot table installed` | the boot table lacked a declared mode or lane count, or a change of the declared rate or bit depth moved its rows; `switch` installed the overlay | reboot, then the same command |
| `REBOOT NEEDED` after `host: camera bus mux installed under aliensense_gen (FDT …)` | the host boots no camera bus; `switch` installed the boot entry that starts them | reboot |
| `host: the boot entry aliensense_gen booted without its overlays` from `switch` | the entry booted (`aliensense_label=aliensense_gen` is on the kernel command line) and the launcher applied none of its overlays; the `fdtoverlay` line under it says why | `nxs switch --fdt <dtb>` |
| `not opened (Permission denied): /dev/i2c-0 /dev/i2c-1 …` from `probe` | your user is not in the `i2c` group, or has not logged in again since joining it, so `probe` could not open those buses and did not sweep them | the `usermod` line under it, then log in again |
| `no camera bus is booted` from `probe`, or `ports.<port>: no bus on this host answers to that name (the host's ports: none)` | the boot entry that starts the camera buses has not booted | `nxs switch`, then reboot when it prints `REBOOT NEEDED` |
| `the boot entry names no FDT and …` from `switch` or `on` | no base device tree declares the booted module's compatible, or several do | `nxs switch --fdt <dtb>` with the file the line lists for your module |
| `--fdt <path>: no such file …` from `switch` or `on` | the path names no file on the host; nothing was written | `ls /boot/dtb /boot/*.dtb`, then `nxs switch --fdt <dtb>` with a file it lists |
| `dropped <path> from aliensense_gen: no such file …` from `switch` or `on` | the boot label named an overlay file that is not on disk; the install wrote the label without it | none: the line is a note |
| `writing /boot needs root, and sudo refused: …` | sudo could not ask for the password, because the command ran without a terminal | run the command in a terminal |
| `<port>: dropped <file> from aliensense_gen: port cam0 is not declared` from `switch`, or `the boot entry names the overlays of cam0, a port the manifest does not declare` from `on` | the boot label carried the overlays of a port the declaration does not name, such as the port a Hub moved away from, and the tool dropped them | reboot, then the same command |
| `<port>/<link>: <mode> boots on no row of this port's table (the table carries one pixel format, …)` from `on --mode` | the table carries the pixel format the declaration runs, and the mode asked is of another | `camera.mode` on the port, then `nxs switch` and the reboot; or a mode the lines under it name |
| `<port>: preparing the capture stack` | the port's `on` (`nxsd`'s after a reboot) is building the capture stack's configuration for the booted table (JetPack 7.2.1), after its bring-up | wait, then `nxs <port> status` |
| `<port>: the capture stack's configuration was not built (<reason>)` from `on` | the build after the port's bring-up failed; the reason names the capture daemon's journal or the refused `sudo` | `nxs <port> on` |
| `<port>: another nxs run holds the bus after 20 s of waiting (nxsd brings the ports up after boot)` from `status` | another run held the port's bus past the 20 s wait, as `nxsd` does while it brings the ports up after boot | `journalctl -u nxsd` for the run, then `status` once it ends |
| `<port>: another nxs run holds the bus after 20 s of waiting (nxsd brings a port up after boot and after a hub power cycle)` from `switch` | another run held the port's bus past the wait while `switch` read its pods; a bring-up the daemon had recorded is waited out before this step, so the holder started after that check | `nxs <port> status`, then `nxs switch` again |
| `<port>: link <link> carries a pod and no camera, link <other> a camera; one hub brings them up together only as a pair` | a hub link declares a pod alone beside a camera link | declare `links.<link>.camera`, or bring the camera link up alone |
| `the capture daemon's configuration mode on L4T 39.2.1 needs NVIDIA's camera hotfix (<file> is absent)` | JetPack 7.2.1 without the hotfix | install the hotfix (the NVIDIA Jetson deployment guide, step 3), then `nxs switch` |
| `cannot fetch <url> (<reason>)` from `switch` | the vendor's tuning override could not be downloaded | copy the file where the line names it (its sha256 follows), then `nxs switch` |
| `the capture daemon is not running` | the capture daemon is down | `nxs switch` |
| `<port>: <chip> <phase>: poll 0x0013 timed out (lock)` | an image faulted on the bus: the link never locked | check the coax on the link |
| `<port>/<link>: video did not lock` | the head holds stale state, and one recovery did not clear it | power-cycle the Hub |
| `<port>: A's pod and B's pod both answer at 0x31` | two devices behind the port share a host address | set distinct `unit.alias` values |
| `nxs: do not run under sudo; it asks when it needs root` | the tool was run under `sudo` | run it as yourself |
| `suite.yaml names hub … and its pack serves no …` in the declaration's findings | a link declares a camera the hub's pack does not serve | declare a sensor the pack serves (the finding lists them) |
| `suite.yaml names hub … at 0x6a and nothing answers there` under a port in `status` | the declared hub does not answer: it is unpowered or the coax is off | check the hub's power and cabling |
| `generate` names no personality for a unit on a bare bus that runs nothing | the Click is not seated, or the sensor's personality is not among the tool's | seat the Click and retry; the trial's `no answer` lines name the candidates it tried, and the [Personality Authoring Reference](../nxs-personality-authoring/) covers a new one |

Error codes served by the device (`CMD_ERROR`, `ERROR_CODE`) are enumerated in [Interface Description §12](../nxs-host-interface/).
