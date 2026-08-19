---
title: "NXS — Smart Sensor Co-Processor — Device Reference"
sidebar:
  order: 2
# Mirrored from the firmware repository (docs/specs/nxs-device-reference.md) at pre-release v1.0.0-rc1-193-g3e0ac604d (3e0ac604d).
# Do not edit here — changes flow through the next release.
---

Applies to: NXS v1.0 · product version 1.0.x

| Document set | |
|---|---|
| **Device Reference** (this document) | interfaces, performance and limits, supported sensors, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Driver Development Guide](../nxs-driver-development/) | authoring drivers for unsupported sensors |
| [FAQ](../nxs-faq/) | frequently asked questions |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

## 1. Product overview

NXS is a sensor co-processor module: it runs sensor drivers as sandboxed bytecode on an on-device virtual machine and serves calibrated, SI-unit samples to a host over I²C, UART (Cyphal/serial), or CAN-FD (Cyphal/CAN). Samples are scaled with the sensor's datasheet-nominal sensitivities — including the part's own compensation math where its datasheet defines it (e.g. a barometer's temperature polynomial over its factory coefficients, run on-device). Calibration is per unit: a stored affine (M·v + b) per vector sensor plus a mounting-orientation code, applied in the SI tier — the raw sample stream carries unmodified sensor counts (§3.1). A driver is uploaded at runtime — no firmware rebuild per sensor — and every output field is self-described (name, type, scale/offset, canonical SI unit, semantic), so a host decodes any sensor without sensor-specific code. Sensors attach on a mikroBUS socket (I²C, SPI, or UART).

- Compute: 32-bit Arm Cortex-M4F @ 160 MHz
- Flash: 512 KB — 48 KB bootloader, 2 × 220 KB firmware slots (A/B update), 24 KB configuration storage
- SRAM: 112 KB
- Firmware update: dual-slot with automatic rollback (watchdog 3 s, self-confirm ≈ 1 s); recovery path independent of the application
- Persistent state: driver store (8 slots), node identity and subject configuration, per-subject decimation, per-unit calibration record

## 2. Interfaces

| Interface | Role | Electrical / framing | Defaults |
|---|---|---|---|
| I²C target | Host control + sample window | address `0x30`, ≤ 400 kHz, 32-byte write window | see [Interface Description §3](../nxs-host-interface/) |
| UART host link | Cyphal/serial: full node surface (registers, services, subjects, DFU) | 460800 8N1 | also carries the update protocol in serial recovery, at 115200 |
| CAN-FD | Cyphal/CAN: full node surface | default CAN FD 1 Mbps arbitration / 4 Mbps data, MTU 64; sample points 0.875 / 0.750 on every profile; external transceiver on the carrier | selectable via `uavcan.can.bitrate` (persisted, applies at reboot): FD 1M/4M or 1M/2M; Classic CAN 1M / 500k / 250k / 125k, MTU 8 |
| mikroBUS socket | Sensor attachment | I²C (400 kHz), SPI, UART, RST, INT, PWM, AN | one sensor driver active at a time |

On-board CAN split termination (v2 hardware) is software-switched and **off by default** — a module joins an already-terminated bus without loading it. Commission `aliensense.nxs.can_term` on the two modules at the physical bus ends, or terminate externally; v1.0 hardware always needs external 120 Ω termination. See [Interface Description §8.2](../nxs-host-interface/).

Physical connector assignment, absolute maximum ratings, electrical characteristics, and mechanical data are in the NXS product datasheet.

### 2.1 Cyphal identity and ports

| Item | Default |
|---|---|
| Node-ID | 125 (commissionable 0–125; 255 = anonymous, node stays silent on subjects; 0xFFFF = revert to compiled default) |
| Host convention | 127 |
| `RawSample` subject | 6144 |
| Status subject | 6145 |
| SI subjects: acceleration / angular velocity / temperature / pressure / GNSS / magnetic field | 6146 / 6147 / 6148 / 6149 / 6150 / 6151 |
| Scalar SI block base (11 subjects) | 6152 (block 6152–6162) |
| Vendor services: GetOutputInfo / GetParamInfo / GetDriverInfo | 256 / 257 / 258 |

All subject-IDs are commissionable registers persisted on the device; the values above are the compiled defaults. See [Interface Description §8.2](../nxs-host-interface/).

### 2.2 mikroBUS sensor socket

Sensors attach on a standard mikroBUS socket. One sensor driver is active at a time; the loaded driver selects which of the socket's buses it drives.

| mikroBUS pin | Function |
|---|---|
| AN | Analog input |
| RST | Sensor reset, polarity driven per loaded driver |
| CS | SPI chip select, active low |
| SCK | SPI clock |
| MISO | SPI data, sensor → host |
| MOSI | SPI data, host → sensor |
| PWM | PWM output; high-impedance while no loaded driver drives it |
| INT | Sensor interrupt / data-ready |
| RX | UART receive |
| TX | UART transmit |
| SCL | I²C clock, Fast-mode 400 kHz |
| SDA | I²C data |
| 3V3 | Sensor rail, firmware-switched |

Above 400 kHz on the sensor I²C bus, pull-ups of ≤ 2.2 kΩ are required.

The bootloader tests `RST` and `CS` for continuity at every reset and enters serial recovery when the two are connected. A carrier must not tie them together, and `RST` must not be strapped to a fixed level. A seated sensor board does not trigger the test, which requires both pins to follow a driven level through a high phase and a low phase.

### 2.3 Status LED

A green LED, active high. Every firmware and bootloader state drives a moving pattern; a static LED (dark or solid) always means the module is not executing (unpowered, held in reset, or a fault before the bootloader starts).

Application patterns are short pulses on a dark background. Bootloader patterns invert that — a lit LED notched by dark winks — so the two are distinguished at a glance without counting.

| LED pattern | Meaning |
|---|---|
| one short flash per second | idle — powered, no driver loaded |
| double pulse ("heartbeat", second pulse longer) | driver measuring |
| heartbeat + three fast ticks | driver measuring, bus I/O errors occurred since boot or the last host-commanded driver restart |
| fast blink (~5 Hz) | driver loaded, sensor not answering |
| three-flash burst | driver fault (error code readable over any transport) |
| rapid strobe (~10 s) | identify — host-triggered locate (`IDENTIFY` command / `nxs identify`) |
| lit, one dark wink per second | bootloader verifying the firmware image |
| lit, two dark winks per second | bootloader held in serial recovery, awaiting an upload |
| lit, three dark winks per second | firmware update applying — do not remove power |
| single 300 ms pulse per second | no valid firmware image; awaiting an upload |
| static — dark or solid | module not executing |

## 3. Performance and limits

| Quantity | Value |
|---|---|
| Register-map contract version | 1 |
| NXS image format version (major.minor) | 1.0 |
| Sample size | ≤ 128 bytes (≤ 110 through the I²C sample record — [Interface Description §6.3](../nxs-host-interface/)) |
| Output fields per driver | 16 |
| Driver bytecode | ≤ 4096 bytes |
| Serialized driver image | ≤ 6144 bytes |
| Driver / parameter / output-field name | 16 bytes |
| Unit string | 8 bytes |
| Parameter value set | ≤ 16 values |
| Patch sites per parameter | ≤ 2 |
| Communication profiles per image | 3 |
| Driver store slots | 8 |
| I²C write window / chunk | 32 bytes |
| Serial DFU chunk | 192 bytes |
| Firmware rollback watchdog | 3 s |
| CAN bit-timing profiles | FD 1M/4M (default), 1M/2M; Classic 1M, 500k, 250k, 125k |
| CAN termination | on-board split termination (v2 hardware), software-selected, off by default |
| Multi-unit time synchronization (unit-to-unit) | typical 0.1 ms, max 0.5 ms on I²C and CAN-FD host links; millisecond-class on serial. Host-disciplined at the default 10 s push cadence ([Interface Description §6.8](../nxs-host-interface/)); each unit serves its live error bound |

Sample-rate ceilings are sensor- and transport-bound: the supported-sensor table below lists each driver's configurable rate range; per-subject decimation thins the SI subjects independently of the raw stream (see [Integration & Operation Manual](../nxs-integration-manual/)).

Classic-CAN profiles cap every frame at 8 bytes, so a 128-byte `RawSample` spans ~21 frames and the 250 Hz raw stream does not sustain on a 1 Mbps Classic bus. Classic and low-bitrate profiles serve control, telemetry, and low-rate or decimated sensor streams; full-rate raw capture needs an FD profile.

### 3.1 Calibration

| Quantity | Correction | Solve |
|---|---|---|
| Gyro bias | offset (b) | on-device still-average; also runs once at every boot |
| Accelerometer scale, misalignment, bias | full affine (M, b) | host six-pose wizard (`nxs calibrate accel`) |
| Magnetometer hard and soft iron | full affine (M, b) | on-device in-situ ellipsoid fit |
| Encoder zero | scalar offset on the `angle` output | declared from the current angle |
| Mounting orientation | one of 24 axis-aligned rotations, composed onto every vector bucket | declared at installation |

The correction applies in the SI tier only: the Cyphal `uavcan.si.sample.*` subjects carry calibrated values, while the `RawSample` stream and the I²C sample window carry raw counts. The served record lets a host reproduce the calibrated values from the raw counts exactly. Magnetometer calibration runs mounted in the vehicle, because the iron the fit removes belongs to the installation. Every on-device solve is fail-safe. A refused fit — insufficient coverage, degenerate geometry, or a failed self-check — reports its errno and leaves the stored calibration unchanged. A per-bucket driver guard ties each solved calibration to the driver it was solved against, and under a different driver the stale affine is not applied. Wire surface and record layout: [Interface Description §6.9](../nxs-host-interface/). Operator procedures: [Integration & Operation Manual §4.8](../nxs-integration-manual/).

## 4. Supported sensors

Drivers ship with the product and are uploaded by name (`nxs upload <name>`). Every output with a recognized SI semantic is in its canonical SI unit; fields outside that vocabulary carry their explicitly declared unit (`%RH`, NMEA text). Scale-tracked parameters (full-scale ranges) retune the output scale live, without re-upload.

| Driver | Sensor | Bus | Parameters (default) | Outputs |
|---|---|---|---|---|
| `iam20680` | TDK IAM-20680, 6-axis IMU | SPI or I²C `0x68`/`0x69` | `sample_rate` 10–1000 Hz (100), `accel_fs` 2/4/8/16 g (8), `gyro_fs` 250–2000 dps (2000), `accel_bw` 5–420 Hz (420), `gyro_bw` 5–176 Hz (176) | accel x/y/z `m/s^2`, temp `kelvin`, gyro x/y/z `rad/s` |
| `iim20670` | TDK IIM-20670, industrial 6-axis IMU | SPI (CRC- and status-verified per response) | `accel_fs` 2/4/16/32 g (16), `gyro_fs` 41–1966 dps (655), `filter_hz` 10/46/60 Hz (60), `sample_rate` 10–250 Hz (100; exact 8 kHz-sync divisions); compile-time `trigger` drdy/poll (drdy) | gyro x/y/z `rad/s`, temp `kelvin`, accel x/y/z `m/s^2` |
| `fxos8700` | NXP FXOS8700, accel + magnetometer | I²C `0x1E`/`0x1D`/`0x1C`/`0x1F` or SPI | `sample_rate` 25–400 Hz (100), `accel_fs` 2/4/8 g (4) | accel x/y/z `m/s^2`, mag x/y/z `tesla`, temp `kelvin` |
| `mc6470` | mCube MC6470, 6-axis eCompass (two-die: accel + mag) | I²C — accel `0x4C`/`0x6C`, mag `0x0C` (one driver, fused sample) | `sample_rate` 1–256 Hz (64), `accel_fs` 2/4/8/16 g (8), `mag_odr` 10/20/100 Hz (100), `mag_res` 14/15 bit (15); compile-time `accel_res` 6–14 bit (14) | accel x/y/z `m/s^2`, mag x/y/z `tesla` |
| `ms5611` | TE MS5611, barometric pressure | I²C `0x76`/`0x77` (command protocol) | `sample_rate` 1–25 Hz (10); compile-time `osr` 256/512/1024/2048/4096 (4096) | pressure `pascal`, temperature `kelvin` |
| `neo_m9n` | u-blox NEO-M9N, multi-GNSS receiver | UART 38400 8N1 | `rate` 1/5/10/25 Hz (1); compile-time `protocol` binary/nmea (binary) | binary: latitude/longitude `rad`, altitude `m` (MSL), `alt_ellipsoid` `m`, vel N/E/D `m/s`, speed `m/s`, heading `rad`, position/speed accuracy `m`/`m/s`, fix type, satellites, pdop — nmea: sentence string |
| `zed_f9p` | u-blox ZED-F9P, RTK multi-band GNSS | UART 38400 8N1 | `rate` 1/2/5/10 Hz (1); compile-time `protocol` binary/nmea (binary) | same output set as `neo_m9n`, RTK-grade precision |
| `as5047d` | ams AS5047D, 14-bit magnetic rotary encoder | SPI | `sample_rate` 10–1000 Hz (500) | angle `rad` |

Sensors outside this table: see the [Driver Development Guide](../nxs-driver-development/) — drivers are authored against a public DSL, with AI-assisted generation from the sensor datasheet as the primary flow.

## 5. Versioning

The product version is `MAJOR.MINOR.PATCH`: MAJOR — the host-facing contract (register map, served Cyphal types) changed incompatibly, requalify the integration; MINOR — the driver image format moved, rebuild driver images with the matching `nxs` tool; PATCH — drop-in, always. The device self-reports all contract versions at runtime (register `0x19`, the `.nxs` header, `GetInfo`). Full model: [Interface Description §2/§10.1](../nxs-host-interface/).
