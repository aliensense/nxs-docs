---
title: NXS Smart Sensor Co-Processor — Device Reference
sidebar:
  order: 2
slug: v1.2.0/reference/nxs-device-reference
---

Applies to: NXS v1.1 · product version 1.1.x

| Document set | |
|---|---|
| **Device Reference** (this document) | interfaces, performance and limits, shipped personalities, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Click Personality Reference](../nxs-click-personalities/) | authoring personalities for unsupported sensors |
| [Cam Personality Reference](../nxs-cam-personalities/) | describing camera chains for `nxs cam` |
| [MCP Tool Reference](../nxs-mcp/) | operating and configuring through an AI agent |
| [FAQ](https://aliensense.github.io/nxs-docs/hardware/faq/) | frequently asked questions |
| [Glossary](../nxs-glossary/) | one word for each thing |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

## 1. Product overview

NXS is a sensor co-processor unit. It runs click personalities as sandboxed bytecode on an on-device virtual machine and serves calibrated samples in SI units to a host. The host link is I²C, Cyphal/serial over UART, or Cyphal/CAN over CAN-FD. Samples are scaled with the sensor's datasheet-nominal sensitivities. Where the datasheet defines the part's own compensation math, for example a barometer's temperature polynomial over its factory coefficients, it runs on the unit.

Calibration is per unit. A stored affine (M·v + b) per vector sensor applies in the SI tier, composed with the mount rotation the running personality's `orientation` row names. The raw sample stream carries unmodified sensor counts (§3.1). A personality is uploaded at runtime, so no firmware rebuild is needed per sensor. Every output field is self-described by name, type, scale/offset, canonical SI unit and semantic, so a host decodes any sensor without sensor-specific code. Sensors attach on a mikroBUS socket over I²C, SPI or UART.

* Compute: 32-bit Arm Cortex-M4F @ 160 MHz
* Flash: 512 KB, as a 48 KB bootloader, 2 × 220 KB firmware slots (A/B update) and 24 KB configuration storage
* SRAM: 112 KB
* Firmware update: dual-slot with automatic rollback (watchdog 3 s, self-confirm ≈ 1 s), and a recovery path independent of the application
* Persistent state: personality store (8 slots, click and cam personalities alike), subject-IDs, per-unit calibration record
* Persistent device rows: node-ID, CAN bit timing, CAN termination, the decimation gate, per-subject decimation and sample FIFO depth ([Interface Description §6.4](../nxs-host-interface/))

## 2. Interfaces

| Interface | Role | Electrical / framing | Defaults |
|---|---|---|---|
| I²C target | One map at two doors: host control and samples at the unit door, the capture stack's per-frame controls at the camera door | the unit door at `0x30` and the camera door at `0x31`, a 16-bit register pointer, ≤ 400 kHz. A smart camera serves the camera door alone | see [Interface Description §3 and §4](../nxs-host-interface/) |
| UART host link | Cyphal/serial: full node surface (registers, services, subjects, DFU) | 460800 8N1 | also carries the update protocol in serial recovery, at 115200 |
| CAN-FD | Cyphal/CAN: full node surface | default CAN FD 1 Mbps arbitration / 4 Mbps data, MTU 64. Sample points 0.875 / 0.750 on every profile. External transceiver on the carrier | selectable via `uavcan.can.bitrate` or the `can_bitrate` and `can_data_rate` rows, persisted and applied at reboot. The profiles are FD 1M/4M or 1M/2M, or Classic CAN 1M / 500k / 250k / 125k with MTU 8 |
| mikroBUS socket | Sensor attachment | I²C (Fast-mode, 330 kHz on the wire), SPI, UART, RST, INT, PWM, AN | one click personality active at a time |

On-board CAN split termination (v2 hardware) is software-switched and **off by default**, so a unit joins an already-terminated bus without loading it. Commission `aliensense.nxs.can_term` or the `can_term` row on the two units at the physical bus ends, or terminate externally. The v1.0 hardware always needs external 120 Ω termination. See [Interface Description §8.2](../nxs-host-interface/).

Physical connector assignment, absolute maximum ratings, electrical characteristics, and mechanical data are in the NXS product datasheet.

### 2.1 Cyphal identity and ports

| Item | Default |
|---|---|
| Node-ID | 125. Commissionable 0–125. 255 is anonymous: the node boots silent on CAN and stays reachable over serial and I²C. 0xFFFF reverts to the compiled default |
| Host convention | 127 |
| `RawSample` subject | 6144 |
| Status subject | 6145 |
| SI subjects: acceleration / angular velocity / temperature / pressure / GNSS / magnetic field | 6146 / 6147 / 6148 / 6149 / 6150 / 6151 |
| Scalar SI block base (11 subjects) | 6152 (block 6152–6162) |
| Vendor services: GetOutputInfo / GetParamInfo / GetDriverInfo | 256 / 257 / 258 |

All subject-IDs are commissionable Cyphal registers persisted on the device, set over a Cyphal transport, and the values above are the compiled defaults. The node-ID is a device row on every transport. See [Interface Description §6.7 and §8.2](../nxs-host-interface/).

### 2.2 mikroBUS sensor socket

Sensors attach on a standard mikroBUS socket. One click personality is active at a time, and the loaded personality selects which of the socket's buses it drives. A cam personality is a second kind of image in the same store. It programs the image sensor on the unit's own pod bus once per host request and never occupies the socket ([Interface Description §6.11](../nxs-host-interface/)).

| mikroBUS pin | Function |
|---|---|
| AN | Analog input |
| RST | Sensor reset, polarity driven per loaded personality |
| CS | SPI chip select, active low |
| SCK | SPI clock |
| MISO | SPI data, sensor → host |
| MOSI | SPI data, host → sensor |
| PWM | PWM output, high-impedance while no loaded personality drives it |
| INT | Sensor interrupt / data-ready |
| RX | UART receive |
| TX | UART transmit |
| SCL | I²C clock, Fast-mode at 330 kHz |
| SDA | I²C data |
| 3V3 | Sensor rail, firmware-switched |

Above 400 kHz on the sensor I²C bus, pull-ups of ≤ 2.2 kΩ are required.

The bootloader tests `RST` and `CS` for continuity at every reset and enters serial recovery when the two are connected. A carrier must not tie them together, and `RST` must not be strapped to a fixed level. A seated Click does not trigger the test. The test requires both pins to follow a driven level through a high phase and a low phase.

### 2.3 Status LED

A green LED, active high. Every firmware and bootloader state drives a moving pattern. A static LED, dark or solid, always means the unit is not executing: unpowered, held in reset, or a fault before the bootloader starts.

Application patterns are short pulses on a dark background. Bootloader patterns invert that, a lit LED notched by dark winks, so the two are distinguished at a glance without counting.

| LED pattern | Meaning |
|---|---|
| one short flash per second | idle — powered, no personality running |
| double pulse ("heartbeat", second pulse longer), one per running job | one job running: a click personality measuring, or a cam personality whose last run left its sensor streaming |
| two heartbeats back to back | two jobs running: a click personality measuring and a cam personality whose last run left its sensor streaming |
| heartbeat + three fast ticks | samples were lost since boot or the last host-commanded personality restart. With two jobs running, the ticks follow two heartbeats |
| fast blink (~5 Hz) | a sensor or a camera head not answering |
| three-flash burst | personality fault (error code readable over any transport), or a camera run that faulted |
| rapid strobe (~10 s) | identify — host-triggered locate (`IDENTIFY` command / `nxs identify`) |
| lit, one dark wink per second | bootloader verifying the firmware image |
| lit, two dark winks per second | bootloader held in serial recovery, awaiting an upload |
| lit, three dark winks per second | firmware update applying — do not remove power |
| single 300 ms pulse per second | no valid firmware image, awaiting an upload |
| static — dark or solid | unit not executing |

## 3. Performance and limits

| Quantity | Value |
|---|---|
| Supported hosts | NVIDIA Jetson Orin Nano Developer Kit, p3768 carrier, on Jetson Linux 36.4.4, which is JetPack 6.2.1, and 39.2.1, which is JetPack 7.2.1. Other carriers and releases on request |
| Camera ports | the Hub on CAM0 or CAM1 with links A and B, or one camera on a connector without a Hub. That camera is a head whose personality the host runs, or a smart camera. 2 or 4 CSI lanes per port |
| Host interface version (`PROTO_VERSION`) | 2 |
| Map layout version (`MAP_VERSION`) | 1 |
| NXS image format version (major.minor) | 1.1, the product's major and minor |
| Sample size | ≤ 128 bytes (≤ 110 through the I²C sample record — [Interface Description §6.3](../nxs-host-interface/)) |
| Output fields per personality | 16 |
| Parameters per personality | 16 |
| Personality bytecode | ≤ 4096 bytes |
| Serialized personality image | ≤ 6144 bytes |
| Descriptor trailer | ≤ 4096 bytes |
| Map | 64 parameter rows, 16 output rows and 16 modes in the layout, 16 parameter rows per personality ([Interface Description §4](../nxs-host-interface/)) |
| Register pointer | 2 bytes, the high byte first ([Interface Description §3.1](../nxs-host-interface/)) |
| Sensor register address in a personality | 8 bits, or 16 bits under a 2-byte I²C profile ([Interface Description §10.2](../nxs-host-interface/)) |
| Host I²C link through the Hub (GMSL2 control channel) | about 33 µs per byte and 0.19 ms per transaction. One pod at 200 Hz drained every 40 ms, the tool's period, takes about 18 % of the channel |
| Personality / parameter / output-field name | 15 characters, in a 16-byte field |
| Unit string | 6 characters, in a row's 6-byte `UNIT` field |
| Value name | 31 characters ([Interface Description §10.1](../nxs-host-interface/)) |
| Port rows per image | 16 ([Interface Description §10.1](../nxs-host-interface/)) |
| Parameter value set | ≤ 16 values, ≤ 8 when a value passes 16 bits |
| Patch sites per parameter | ≤ 2 |
| Communication profiles per image | 3 |
| Personality store slots | 8 |
| I²C upload and firmware chunk | 128 bytes of data after a 4-byte cursor ([Interface Description §6.1](../nxs-host-interface/)) |
| Cyphal file-pull chunk | 256 bytes |
| Firmware image (update slot capacity) | ≤ 221,184 bytes ([Interface Description §11](../nxs-host-interface/)) |
| Firmware rollback watchdog | 3 s |
| CAN bit-timing profiles | FD 1M/4M (default) and 1M/2M, Classic 1M, 500k, 250k and 125k |
| CAN termination | on-board split termination (v2 hardware), software-selected, off by default |
| Multi-unit time synchronization (unit-to-unit) | typical 0.1 ms, max 0.5 ms on I²C and CAN-FD host links, millisecond-class on serial. Host-disciplined. Each push carries its own validity window. The `nxs` tools set it to ten times their push cadence, so ten consecutive lost pushes end the discipline ([Interface Description §6.8](../nxs-host-interface/)). Each unit serves its live error bound |

Sample-rate ceilings are sensor- and transport-bound. The supported-sensor table below lists each personality's configurable rate range. Per-subject decimation thins the SI subjects independently of the raw stream (see [Integration & Operation Manual](../nxs-integration-manual/)).

Classic-CAN profiles cap every frame at 8 bytes, so a 128-byte `RawSample` spans ~21 frames. The 250 Hz raw stream does not sustain on a 1 Mbps Classic bus. Classic and low-bitrate profiles serve control, telemetry, and low-rate or decimated sensor streams. Full-rate raw capture needs an FD profile.

### 3.1 Calibration

| Quantity | Correction | Solve |
|---|---|---|
| Gyro bias | offset (b) | on-device still-average, and it also runs once at every boot |
| Accelerometer scale and bias | per-axis scale and offset (diagonal M, b) | host wizard, six poses plus two check poses (`nxs calibrate accel`) |
| Magnetometer hard and soft iron | full affine (M, b) | on-device in-situ ellipsoid fit |
| Encoder zero | scalar offset on the `angle` output | declared from the current angle |
| Mount rotation | one of 24 axis-aligned rotations, composed onto every vector bucket | declared at installation, as the IMU or magnetometer personality's `orientation` row |

The correction applies in the SI tier only. The Cyphal `uavcan.si.sample.*` subjects carry calibrated values, while the `RawSample` stream and the I²C sample window carry raw counts. The served record lets a host reproduce the calibrated values from the raw counts exactly. Magnetometer calibration runs mounted in the vehicle, because the iron the fit removes belongs to the installation.

Every on-device solve is fail-safe. A refused fit, from insufficient coverage, degenerate geometry or a failed self-check, reports its errno and leaves the stored calibration unchanged. A per-bucket personality guard ties each solved calibration to the personality it was solved against. Under a different personality the stale affine is not applied. Wire surface and record layout: [Interface Description §6.9](../nxs-host-interface/). Operator procedures: [Integration & Operation Manual §4.9](../nxs-integration-manual/).

## 4. Shipped personalities

Click personalities ship with the product and are uploaded by name (`nxs upload <name>`). Every output with a recognized SI semantic is in its canonical SI unit. Fields outside that vocabulary carry their explicitly declared unit (`%RH`, NMEA text). Scale-tracked parameters (full-scale ranges) retune the output scale live, without re-upload.

| Personality | Sensor | Bus | Parameters (default) | Outputs |
|---|---|---|---|---|
| `iam20680` | TDK IAM-20680, 6-axis IMU | SPI or I²C `0x68`/`0x69` | `sample_rate` 10–500 Hz, default 100. `accel_fs` 2/4/8/16 g, default 8. `gyro_fs` 250–2000 dps, default 2000. `accel_bw` 5–420 Hz, default 420. `gyro_bw` 5–176 Hz, default 176. `orientation` the 24 mount rotations, default `NONE` | accel x/y/z `m/s^2`, temp `kelvin`, gyro x/y/z `rad/s` |
| `iim20670` | TDK IIM-20670, industrial 6-axis IMU | SPI (CRC- and status-verified per response) | `accel_fs` 2/4/16/32 g, default 16. `gyro_fs` 41–1966 dps, default 655. `filter_hz` 10/46/60 Hz, default 60. `sample_rate` 10–250 Hz, default 100, exact 8 kHz-sync divisions. `orientation` the 24 mount rotations, default `NONE`. Compile-time `trigger` drdy/poll, default drdy | gyro x/y/z `rad/s`, temp `kelvin`, accel x/y/z `m/s^2` |
| `fxos8700` | NXP FXOS8700, accel + magnetometer | I²C `0x1E`/`0x1D`/`0x1C`/`0x1F` or SPI | `sample_rate` 25–400 Hz, default 100. `accel_fs` 2/4/8 g, default 4. `orientation` the 24 mount rotations, default `NONE` | accel x/y/z `m/s^2`, mag x/y/z `tesla`, temp `kelvin` |
| `mc6470` | mCube MC6470, 6-axis eCompass (two-die: accel + mag) | I²C — accel `0x4C`/`0x6C`, mag `0x0C` (one personality, fused sample) | `sample_rate` 1–256 Hz, default 64. `accel_fs` 2/4/8/16 g, default 8. `mag_odr` 10/20/100 Hz, default 100. `mag_res` 14/15 bit, default 15. `orientation` the 24 mount rotations, default `NONE`. Compile-time `accel_res` 6–14 bit, default 14 | accel x/y/z `m/s^2`, mag x/y/z `tesla` |
| `ms5611` | TE MS5611, barometric pressure | I²C `0x76`/`0x77` (command protocol) | `sample_rate` 1–25 Hz, default 10. Compile-time `osr` 256/512/1024/2048/4096, default 4096 | pressure `pascal`, temperature `kelvin` |
| `neo_m9n` | u-blox NEO-M9N, multi-GNSS receiver | UART 38400 8N1 | `rate` 1/5/10/25 Hz, default 1. Compile-time `protocol` binary/nmea, default binary | In binary mode: latitude/longitude `rad`, altitude `m` (MSL), `alt_ellipsoid` `m`, vel N/E/D `m/s`, speed `m/s`, heading `rad`, position/speed accuracy `m`/`m/s`, fix type, satellites, pdop. In NMEA mode: sentence string |
| `zed_f9p` | u-blox ZED-F9P, RTK multi-band GNSS | UART 38400 8N1 | `rate` 1/2/5/10 Hz, default 1. Compile-time `protocol` binary/nmea, default binary | same output set as `neo_m9n`, RTK-grade precision |
| `as5047d` | ams AS5047D, 14-bit magnetic rotary encoder | SPI | `sample_rate` 10–1000 Hz, default 500 | angle `rad` |

For sensors outside this table, see the [Click Personality Reference](../nxs-click-personalities/). Personalities are authored against a public DSL, with AI-assisted generation from the sensor datasheet as the primary flow.

Cam personalities ship in the personalities package and land in a store slot per link (`nxs cam1 A upload <name>`, [Integration & Operation Manual](../nxs-integration-manual/)). Each runs every mode its program carries that the port's capture table takes, one bit depth and one Bayer phase per port. The rates run from the kernel driver's minimum to a ceiling. The sensor datasheet's recommended frame and the Hub's CSI lanes give that ceiling at the line the port runs. A pair runs the deserializer datasheet's line, or the longer one `on` finds on the rig. `nxs <port> caps` lists the ranges per port, and `on` verifies the rate the rig delivers ([Cam Personality Reference](../nxs-cam-personalities/)).

| Personality | Sensor | Mode | Rates on 2 CSI lanes |
|---|---|---|---|
| `imx900` | Sony IMX900, global shutter | 1920x1080 RAW10 | 1 camera, 1.50–160.49 fps. 2 cameras, 1.50–80.13 fps |
| `imx900` | Sony IMX900, global shutter | 2064x1552 RAW12 | 1 camera, 1.50–72.06 fps |
| `imx900` | Sony IMX900, global shutter | 2064x1552 RAW10 | 1 camera, 1.50–117.03 fps. 2 cameras, 1.50–54.75 fps |
| `imx335` | Sony IMX335, rolling shutter | 1920x1080 RAW10 | 1 camera, 1.50–59.84 fps |

On 2 CSI lanes the frame-synced IMX900 1920x1080 pair runs at 30 and 50 fps, and on 4 CSI lanes at 60 fps.

A smart camera serves the capture cells of the map alone, at `0x31` on its port's own bus, with no unit door. Its cam personality, of the `native` law family, describes the rows and the modes it serves, and the host never uploads it. The host drives it through the camera door, as it drives a pod's ([Interface Description §6.12](../nxs-host-interface/)).

## 5. Versioning

The product version is `MAJOR.MINOR.PATCH`.

* MAJOR: the host-facing contract (the map, served Cyphal types, image format) changed incompatibly. Requalify the integration. One exception: a unit's interface version moves inside a MINOR when the released tool upgrades every shipped unit in the field.
* MINOR: the personality image format grew by a new opcode, image kind or trailer record. Rebuild personality images with the matching `nxs` tool.
* PATCH: drop-in, always.

The device self-reports all contract versions at runtime (`PROTO_VERSION` at `0x0019`, `MAP_VERSION` at `0x0001`, the `.nxs` header, `GetInfo`). Full model: [Interface Description §2/§10.1](../nxs-host-interface/).
