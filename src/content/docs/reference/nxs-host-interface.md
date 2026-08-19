---
title: "NXS host interface specification"
sidebar:
  order: 4
# Mirrored from the firmware repository (docs/specs/nxs-host-interface.md) at pre-release v1.0.0-rc1-193-g3e0ac604d (3e0ac604d).
# Do not edit here — changes flow through the next release.
---

Applies to: NXS v1.0 · interface version 1 (`PROTO_VERSION` = 1)

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, supported sensors, versioning |
| **Interface Description** (this document) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Driver Development Guide](../nxs-driver-development/) | authoring drivers for unsupported sensors |
| [FAQ](../nxs-faq/) | frequently asked questions |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

This document is the contract between an NXS device and any host that drives it. It specifies the two host-facing transports, the I²C register map, the command set, the firmware-update procedures, and the driver lifecycle. It ships with the product; firmware and host tools conform to it.

---

## 1. Device model

NXS is a sensor co-processor. It runs sensor drivers as bytecode in an on-device virtual machine: a driver is compiled on the host, uploaded as an NXS image (bytecode and capability descriptors), and executed by the VM, which probes the sensor, configures it, and produces fixed-size samples. The host reads samples, sets parameters, manages a persistent driver store, and updates the firmware — over either transport, with identical semantics.

| Interface | Role | Parameters |
|---|---|---|
| I²C | I²C target, register map | 7-bit address `0x30`; Standard-mode and Fast-mode (≤ 400 kHz); clock driven by the master |
| UART | Cyphal/serial host link | 460800 baud, 8N1, no flow control (§8) |

Both transports converge on the same internals. Anything written below for one transport about device behaviour (states, store, DFU model) holds for the other.

### 1.1 Capability matrix

The management surface is transport-symmetric: every configure, observe, and provision operation works over any single link, so swapping the transport is invisible above the SDK's transport layer. The table is normative — each row names the mechanism per transport, and the exceptions below it are the complete list of wire-inherent differences.

| Surface | I²C | Cyphal (serial / CAN-FD) |
|---|---|---|
| Presence and identity (probe, serial, firmware version) | `WHO_AM_I`, `SERIAL`, `FW_VERSION_*` registers | `GetInfo` |
| Driver upload / run / stop / store | `PROGRAM_*` window + `CMD` | file pull + `ExecuteCommand` |
| Stored-slot peek | `Cmd::PEEK_SLOT` + SEL peek view | `GetDriverInfo(slot)` |
| Parameters (descriptors, get, set) | SEL param view + `PARAM_*` | `GetParamInfo` + `register.Access` |
| Output descriptors | SEL output view | `GetOutputInfo` |
| Device-wide decimation | `DECIMATION` register | `aliensense.nxs.decimation` |
| Per-subject decimation knobs | `DECIMATION_SELECT`/`DECIMATION_VALUE` | `aliensense.nxs.decimation.<subject>` |
| Commissioning (node-ID, subject-IDs) | config record + `Cmd::STORE_PERSIST` | `uavcan.*.id` registers + Save |
| CAN bit timing | config record + `Cmd::STORE_PERSIST` | `uavcan.can.bitrate` + Save |
| CAN termination | `CAN_TERM` register | `aliensense.nxs.can_term` |
| Time discipline (push and state) | time-sync record via `PROGRAM_DATA` (§6.8) | `aliensense.nxs.time_sync` |
| Firmware update | register-map DFU (§7) | file pull (§7) |
| Recovery trigger | `Cmd::ENTER_RECOVERY` | `ExecuteCommand ENTER_RECOVERY` |
| Identify (LED strobe) | `Cmd::IDENTIFY` | `ExecuteCommand IDENTIFY` |
| Samples | poll the `SAMPLE_DATA` window | subscribe to the sample and SI subjects |
| Diagnostics (log stream) | — | subscribe to `uavcan.diagnostic.Record` (8184) |

Wire-inherent exceptions, complete list: SI pub/sub delivery exists only on Cyphal (I²C polls, and the per-subject knobs configure the Cyphal egress from any link). The diagnostic log stream is likewise Cyphal-only — an asynchronous push has no I²C equivalent. A rejected parameter write signals in `ERROR_CODE` on I²C, while Cyphal's `register.Access` echoes the accepted value and the host confirms by read-back. A `uavcan.node.id` read is per-link (§8.2.8). DFU mechanism and speed differ (host-paced 32-byte chunks vs a device pull). I²C descriptor scale/offset are f32, while Cyphal serves f64. Recovery can be triggered from either transport, but MCUboot itself speaks only mcumgr over the host UART, so completing a recovery upload always needs that UART — an I²C-only integration can put a module into recovery and cannot get it out again.

## 2. Interface version

Register `PROTO_VERSION` (`0x19`, read-only) identifies the register-map contract. This document describes version `1`. Additions in reserved space do not change the version; any relayout or semantic change to an existing register does. A `PROTO_VERSION` bump accompanies a product-MAJOR firmware release; reserved-space additions keep the version and ride a PATCH release.

---

## 3. I²C transport

### 3.1 Transactions

- **Write**: `[register address] [data …]` in one transaction. Up to 32 data bytes (SMBus block-write limit; all multi-byte windows are sized accordingly).
- **Read**: write `[register address]`, then read N bytes. The address pointer auto-increments on each byte read, so a block read returns a contiguous register range.

### 3.2 Write semantics

Control writes (`CMD`, the selectors `PARAM_SELECT` / `OUTPUT_SELECT` / `DRIVER_SELECT` / `SEL_VALUE_INDEX`, `PARAM_SET_VALUE`, `PROGRAM_SIZE`, `PROGRAM_DATA`, `XFER_TYPE`, `DECIMATION`) are queued on the device and applied by its communication thread. A transaction ACK means *accepted*, not *applied*. Completion is observed through the status register named by each procedure in §6 (for example `XFER_ACK` for DFU chunks, `RUNNER_STATE` for driver loads). The queue is 8 entries deep; a host that paces on the named status register cannot overflow it. A write dropped at a full queue is counted (§12), and a dropped command that had armed `CMD_ERROR` resolves it to `EAGAIN` — the poll fails immediately instead of timing out.

### 3.3 Read consistency

Registers are served byte-by-byte while the device runs, so a multi-byte read is not atomic. The map is designed around this:

- **Pacing registers are one byte wide** (`XFER_PHASE`, `XFER_ACK`, `STATUS`, `RUNNER_STATE`, …). A one-byte read is served in a single transaction and cannot tear.
- **The sample window is latched per transaction.** The device snapshots the whole `SAMPLE_DATA` record when a read transaction first touches the window base and serves every byte — across chunked continuations — from that snapshot, so one read returns one coherent record (§6.3). Re-addressing the window base starts a fresh snapshot.

---

## 4. Register map

All multi-byte integer registers are little-endian. Access: RO = read-only, RW = read/write, WO = write-effective (reads back last value). Unlisted addresses are reserved; reserved registers read 0 and ignore writes.

Allocation follows a fixed policy. A flat cell is granted only to live single-byte state; feature groups scale through the `SEL` window's views (§6) and the config-record transfer (§6.7) rather than by consuming cells. `0xEE`-`0xEF` are the last unallocated flat cells and are held in reserve. `0xFE` is reserved for a future `FW_VERSION_PATCH`. `0xFF` is never allocated, so a bus readback of all `0xFF` remains distinguishable from any real register — a wiring diagnostic, not data.

| Addr | Name | Access | Size | Description |
|---|---|---|---|---|
| `0x00` | `WHO_AM_I` | RO | 1 | Constant `0xAB` |
| `0x01` | `STATUS` | RO | 1 | Bit 0 `SAMPLE_READY`, bit 1 `ERROR`, bit 7 `RUNNING` |
| `0x02` | `VM_STATE` | RO | 1 | 0 IDLE, 1 RUNNING, 2 ERROR |
| `0x03` | `ERROR_CODE` | RO | 1 | VM error code, synced from `vm_status`: 0 when healthy, otherwise the positive errno of the most recent VM fault. Command and DFU results report in `CMD_ERROR` |
| `0x04` | `SAMPLE_COUNT` | RO | 2 | Free-running counter of produced samples (liveness/status; the readout sequence rides inside the record, §6.3) |
| `0x06` | `SAMPLE_SIZE` | RO | 1 | Bytes per sample, as declared by the loaded driver |
| `0x07` | `NUM_PARAMS` | RO | 1 | Number of driver parameters |
| `0x08` | `NUM_OUTPUTS` | RO | 1 | Number of output fields per sample |
| `0x09` | `DRIVER_NAME_LEN` | RO | 1 | Valid length of the driver name (served via the driver view, `DRIVER_SELECT`) |
| `0x0A` | `STORE_COUNT` | RO | 1 | Populated driver-store slots |
| `0x0B` | `ACTIVE_SLOT` | RO | 1 | Store slot the running driver came from; `0xFF` = transient (RAM upload) |
| `0x0C` | `RUNNER_STATE` | RO | 1 | 0 NO_DRIVER, 1 LOADING, 2 PROBING, 3 MEASURING, 5 PROBE_FAILED |
| `0x0D` | `PROBE_RETRIES` | RO | 1 | Current probe retry counter |
| `0x0E` | `DECIMATION` | RW | 2 | Device-output decimation gate: `0` = output off, `1` = every sample, `N` = every Nth. Live on write; committed to NVS by `STORE_PERSIST` (§5), like all savable config |
| `0x10` | `CMD` | WO | 1 | Command opcode (§5); bit 7 is the optional doorbell |
| `0x11` | `PROGRAM_SIZE` | RW | 2 | Total NXS image size for the next upload. The 2-byte write is the upload announce: it opens the transfer session and reports its verdict in `CMD_ERROR` (§6.1) |
| `0x13` | `PARAM_SELECT` | RW | 1 | Selects which parameter the `0xC0` descriptor block exposes |
| `0x14` | `PARAM_SET_VALUE` | WO | 4 | New value (u32) for the selected parameter; applies immediately (§6.4) |
| `0x18` | `STORE_SELECT` | RW | 1 | Slot index for `SAVE` / `DELETE_SLOT`. Under `XFER_TYPE` = 4 (CALIB) or 5 (BUILD_INFO) it is the read-back page index (§6.9, §6.10) |
| `0x19` | `PROTO_VERSION` | RO | 1 | Register-map contract version (= 1) |
| `0x1A` | `XFER_TYPE` | RW | 1 | `PROGRAM_DATA` consumer: 0 = VM bytecode (default), 1 = DFU firmware image, 2 = identity-config record (§6.7), 3 = time-sync record (§6.8), 4 = calibration record (§6.9), 5 = build identity, read-only (§6.10). Writing any non-DFU value aborts an open DFU staging session (§7). In modes 2 and 3 the `PROGRAM_DATA` window mirrors the current record for read-back; modes 4 and 5 serve their record page-by-page via `STORE_SELECT` (§6.9, §6.10) |
| `0x1B` | `XFER_PHASE` | RO | 1 | DFU phase: 0 IDLE, 1 ERASING, 2 READY, 3 WRITING, 4 FINISHING, 5 ERROR. While a calibration procedure runs it carries the procedure state instead: 0 IDLE, 1 GYRO_WAIT_STILL, 2 GYRO_AVERAGING, 3 MAG_COLLECT (§6.9) |
| `0x1C` | `XFER_ACK` | RO | 1 | DFU accepted-chunk counter, modulo 256; 0 after `DFU_BEGIN`, +1 per committed chunk. While a calibration procedure runs it carries the procedure detail instead: gyro percent averaged, or mag rotation coverage of 14, 12 being the stopping point at which a host asks the solve (§6.9) |
| `0x1D` | `CMD_ERROR` | RO | 1 | Result of the most recent host command op — a DFU operation, a store `SAVE`/`DELETE_SLOT`/`CLEAR_STORE`, `STORE_PERSIST`, or a calibration command (§6.9): 0 = OK, otherwise the positive errno (`EINVAL` for an out-of-range identity record). Reads `CMD_ERR_PENDING` (`0xFF`) while an async command is in flight. Cleared by `DFU_BEGIN`, a successful chunk, or `XFER_TYPE` = 0 |
| `0x1E` | `DESCRIPTOR_EPOCH` | RO | 1 | Descriptor-set generation: 0 = no descriptors readable; advances on every driver (re)load (§6.6) |
| `0x1F` | `OUTPUT_SELECT` | RW | 1 | Selects which output descriptor the `0xC0` window exposes, and switches the window to its output view (§6.6) |
| `0x20` | `PROGRAM_DATA` | WO | ≤32 | Upload window; consumer selected by `XFER_TYPE` |
| `0x40` | `SAMPLE_DATA` | RO | 128 | Latest-sample record: `latch_time_us` u64 at +0, `timestamp_us` u64 at +8, `seq` u16 at +16, sample data at +18 for `SAMPLE_SIZE` bytes (all LE, §6.3; data capped at 110 bytes) |
| `0xC0` | `SEL_NAME_LEN` | RO | 1 | Selected-descriptor window (§6.4, §6.6): name length, any view |
| `0xC1` | `SEL_NAME` | RO | 16 | Descriptor name, ASCII, any view (driver view: the loaded driver's name) |
| `0xD1` | `SEL_TYPE` | RO | 1 | Param view: bits[3:0] = 0 enumerated value set / 1 range; bit[4] = kind (0 = reload, 1 = live, §6.4). Output view: field type code (§6.6) |
| `0xD2` | `SEL_PARAM_DEFAULT` | RO | 4 | Param view: default value (u32) |
| `0xD3` | `SEL_DRIVER_NUM_PARAMS` | RO | 1 | Driver/peek view: declared parameter count |
| `0xD4` | `SEL_DRIVER_NUM_OUTPUTS` | RO | 1 | Driver/peek view: declared output count |
| `0xD5` | `SEL_DRIVER_SLOT` | RO | 1 | Peek view: the peeked slot; `0xFF` in the live driver view |
| `0xD7` | `SEL_DRIVER_I2C_ADDR` | RO | 1 | Peek view: latched mikroBUS I²C address of the active driver (`0` for stored slots) |
| `0xD2` | `SEL_OUTPUT_SCALE` | RO | 4 | Output view: effective scale (f32; full-precision f64 via Cyphal `GetOutputInfo`, §8.2.8) |
| `0xD6` | `SEL_PARAM_CURRENT` | RO | 4 | Param view: current value (u32) |
| `0xD6` | `SEL_OUTPUT_OFFSET` | RO | 4 | Output view: offset (f32) |
| `0xDA` | `SEL_PARAM_NUM_VALS` | RO | 1 | Param view: declared values (≤ 8), paged via `SEL_VALUE_INDEX` |
| `0xDA` | `SEL_OUTPUT_BYTE_ORDER` | RO | 1 | Output view: sample byte order, 0 = big-endian, 1 = little-endian |
| `0xDB` | `SEL_UNIT_LEN` | RO | 1 | Valid length of `SEL_UNIT`, param/output views |
| `0xDC` | `SEL_UNIT` | RO | 8 | Unit string, ASCII, param/output views |
| `0xE4` | `SEL_VALUE_INDEX` | RW | 1 | Param view: which declared value `SEL_VALUE` exposes; echoes when the page is served; resets to 0 on `PARAM_SELECT`. Diag view: which fault counter `SEL_VALUE` exposes (§12); resets to 0 on entering the view |
| `0xE4` | `SEL_OUTPUT_SEMANTIC` | RO | 1 | Output view: semantic category code (§6.6) |
| `0xE5` | `SEL_VALUE` | RO | 4 | Param view: `values[SEL_VALUE_INDEX]` (u32; a range param pages `[min, max]` at indexes 0, 1). Diag view: the selected fault counter, u16 zero-extended to u32. An out-of-range index reads 0 in both views |
| `0xE5` | `SEL_OUTPUT_COUNT` | RO | 2 | Output view: string payload width in bytes; 0 for numeric fields |
| `0xE7` | `SEL_OUTPUT_AT` | RO | 1 | Output view: the field's byte position within the sample (offsets may gap) |
| `0xE9` | `DRIVER_SELECT` | RW | 1 | Writing `3` switches the window to the diag view (§12); any other write switches it to the driver view. Echoes 1 in the driver view, 2 in the peek view, 3 in the diag view |
| `0xEA` | `DECIMATION_SELECT` | RW | 1 | Per-subject decimation selector: a SubjectBucket value. Deferred echo — poll until it reads back; out-of-range echoes `0xFF`. Selecting repaints `DECIMATION_VALUE` |
| `0xEB` | `DECIMATION_VALUE` | RW | 2 | The selected subject's decimation factor (u16 LE, one-transaction write) — the register mirror of `aliensense.nxs.decimation.<subject>`. Volatile until the config Save persists the live factors |
| `0xED` | `CAN_TERM` | RW | 1 | CAN split-termination selection: `0` = off (default), `1` = on, `0xFF` = revert to the default. Applies live; persisted by `STORE_PERSIST` / a Cyphal Save. Reads mirror the effective state; an out-of-vocabulary write is ignored |
| `0xF0` | `SERIAL` | RO | 12 | 96-bit factory-programmed unique ID, MSB-first; reads `0` until set. Unique per unit |
| `0xFC` | `FW_VERSION_MAJOR` | RO | 1 | Running firmware version major — the same value `GetInfo.software_version` serves over Cyphal. Reads `0` on firmware that predates the register |
| `0xFD` | `FW_VERSION_MINOR` | RO | 1 | Running firmware version minor. `0xFE` is reserved for a future patch byte |

The window at `0xC0`–`0xE8` is shared between a parameter view, an output view, a driver view, a peek view, and a diag view; the selector written last (`PARAM_SELECT`, `OUTPUT_SELECT`, or `DRIVER_SELECT`) decides which one it shows, `Cmd::PEEK_SLOT` switches it to the peek view, and `DRIVER_SELECT = 3` to the diag view (`DRIVER_SELECT` echoes `1` in the live driver view, `2` in the peek view, `3` in the diag view). `SEL_NAME*`, `SEL_TYPE`, and `SEL_UNIT*` occupy the same addresses in the param and output views; the remaining addresses are view-specific. A parameter's value set is paged, not windowed: write an index to `SEL_VALUE_INDEX`, poll its echo, read the u32 at `SEL_VALUE`.

## 5. Commands

Written as a single byte to `CMD` (`0x10`). Bit 7 (`0x80`) is an optional doorbell: a host may write `opcode | 0x80` so that opcode 0 (`LOAD`) is distinguishable from an idle register; the device masks bit 7 before dispatch. `RUN` / `STOP` / `RESET` / `CYCLE` / `IDENTIFY` are fire-and-forget — observe their effect through `RUNNER_STATE` / `STATUS` (§4) and `STORE_COUNT` — and `REBOOT` / `ENTER_RECOVERY` / `DFU_FINISH` answer with the reset itself (a failed `DFU_FINISH` latches its errno in `CMD_ERROR` and does not reboot, §7.3). The commands with a polled result — `LOAD`, the store commands `SAVE` / `DELETE_SLOT` / `CLEAR_STORE` / `STORE_PERSIST` / `PEEK_SLOT`, `DFU_BEGIN`, `XFER_ABORT` — report in `CMD_ERROR` (0 = success, else a positive errno, §12), owned by the command-dispatch path so a VM status update cannot overwrite it. These dispatch asynchronously: `CMD_ERROR` reads `CMD_ERR_PENDING` (`0xFF`) from enqueue until the result lands, and the host polls that edge. The `PROGRAM_SIZE` upload announce (§6.1) reports through the same protocol.

| Opcode | Name | Action |
|---|---|---|
| 0 | `LOAD` | Parse the staged NXS image and load it into the VM (does not run it); ends the upload session. `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` (the device confirmed the parse) or an errno — `ENODATA` staged bytes short of the announce (a transport loss: re-upload; the loaded driver stays), `ENOEXEC` not a valid driver image (detail in the device log; the failed parse leaves the no-driver state) |
| 1 | `RUN` | Start the VM (probe → configure → measure) |
| 2 | `STOP` | Halt the VM; driver stays loaded |
| 3 | `RESET` | Unload the driver entirely |
| 4 | `SAVE` | Persist the staged image into store slot `STORE_SELECT` |
| 5 | `DELETE_SLOT` | Delete store slot `STORE_SELECT` |
| 6 | `CLEAR_STORE` | Wipe every store slot |
| 7 | `CYCLE` | Advance to the next populated store slot |
| 8 | `DFU_BEGIN` | Open a firmware-update session; erases the staging flash slot (§7.3) |
| 9 | `DFU_FINISH` | Close the open DFU session, arm the swap, reboot to apply. A finish with no DFU session open is refused `ENOENT` and does not reboot |
| 10 | `REBOOT` | Reboot the device (a pending swap applies on boot) |
| 11 | `STORE_PERSIST` | Validate and commit the staged identity record (§6.7) — together with the live decimation state (the device-wide factor and the per-subject SI factors) and the running calibration record (§6.9) — to NVS. Refuses `EPROTO` with no live stage. Identity applies at the next reboot |
| 12 | `IDENTIFY` | Strobe the status LED (~10 s) so an operator can physically locate the unit; a repeat re-arms the window |
| 13 | `PEEK_SLOT` | Peek `store[STORE_SELECT]` without loading it (`STORE_SELECT` = `0xFF` peeks the active driver). Async like SAVE: `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` (peek view valid) or an errno — `ENOENT` empty slot, `EBADF` corrupt image, `ENOTSUP` foreign image version. On success the SEL window switches to the peek view (below); the view is a snapshot — re-issue after store mutations |
| 14 | `ENTER_RECOVERY` | Arm MCUboot serial recovery and cold-reset into it; the device then holds in the bootloader until an upload completes (§7.4). Dispatched independently of the driver runner, so it reaches a device whose driver never loaded. The reset drops the bus mid-transaction, so the write is its own acknowledgement |
| 15 | `XFER_ABORT` | Release the transfer session and the `PROGRAM_DATA` mux, from any host — the lock stops accidents, not intent. Resets `XFER_TYPE` to 0 and every staging cursor. `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` (a session was closed) or `ENOENT` (none was open), so a cleanup can tell "released" from "nothing to do" |
| 16 | `CALIB_APPLY` | Validate the staged calibration record and apply it to the running state (§6.9); `CMD_ERROR` reads 0 (applied), `EBUSY` while a firmware update or a running procedure holds the status registers, or `EINVAL` (malformed or incomplete record) |
| 17 | `CAL_GYRO` | Start the on-device gyro still-average (§6.9); `CMD_ERROR` reports acceptance (0; `EBUSY` during a mag collection; `EOPNOTSUPP` when the active driver has no gyro vector) — the completion verdict lands in `CMD_ERROR` when the phase returns to idle |
| 18 | `CAL_MAG_START` | Begin the on-device mag collection (§6.9); `CMD_ERROR` reports acceptance (0; `EBUSY` during a gyro procedure; `EOPNOTSUPP` when the active driver has no mag vector) |
| 19 | `CAL_MAG_STOP` | Close the mag collection — coverage-gate, solve, self-check, apply (§6.9); `CMD_ERROR` carries the fit verdict |
| 20 | `CALIB_PERSIST` | Commit the running calibration record to NVS, leaving identity untouched — the save a host performs after a solve (§6.9), when it has no identity record to stage. Snapshots the same live state a full Save does. Async like SAVE: `CMD_ERROR` reads `0` (committed), `EBUSY` while a firmware update or a running procedure holds the status registers, `ENODEV` with no calibration bank, else an errno |

## 6. Procedures (I²C)

### 6.1 Driver upload

An upload is a transfer session: from the size announce to `LOAD`, the device reserves the `PROGRAM_DATA` mux for the uploader, and every step reports its verdict before the next may proceed. Nothing streams on a refusal — a chunk can never land in another transfer's sink.

1. Claim the bytecode consumer: write `XFER_TYPE = 0` and read it back. A live session on any mode refuses the write silently; a readback that does not echo 0 means another transfer owns the mux — retry later, or release it deliberately with `CMD = XFER_ABORT`.
2. Announce the image: write the total size to `PROGRAM_SIZE` (u16, one 2-byte write). The announce arms `CMD_ERROR` with `CMD_ERR_PENDING`; poll it out. `0` opens the session. `EBUSY` — a session is live (another upload or a firmware push); `EPROTO` — `XFER_TYPE` is not 0; `EFBIG` — the size exceeds the staging buffer (§11).
3. Stream the image to `PROGRAM_DATA` in chunks of up to 32 bytes.
4. Write `CMD = LOAD` and poll `CMD_ERROR` out of `CMD_ERR_PENDING`. `0` means the device validated the NXS header (magic and format version, §10.1) and parsed the image — only then has the upload happened. `ENODATA` — the stage is short of the announce, refused before the parse, so a previously loaded driver stays; `ENOEXEC` — the bytes are not a valid driver image, and the failed parse leaves the device in the no-driver state. `LOAD` ends the session either way, and a failure does not enter LOADING.
5. Poll `RUNNER_STATE` until LOADING; write `CMD = RUN`; poll until MEASURING (or PROBE_FAILED). `ERROR_CODE` holds the failure detail.

A session abandoned mid-stream (a crashed host) releases itself after 2 s of holder silence; the partial stage is discarded when the next contender takes over. `XFER_ABORT` releases it immediately.

### 6.2 Run state

`RUNNER_STATE` is the driver lifecycle: NO_DRIVER → LOADING → PROBING → MEASURING. A sensor that fails its probe `PROBE_RETRIES` times enters PROBE_FAILED; if other store slots are populated, the device advances to the next slot autonomously. A host that caches anything derived from the loaded driver (sample layout, parameters) must validate the cache against `DESCRIPTOR_EPOCH` (§6.6), which advances on every driver (re)load — including autonomous slot changes.

On the LOADING → PROBING transition the device cold-resets the sensor before reading WHO_AM_I: it pulses the shared mikroBUS reset line — assert, hold, release, settle — so every bind, including an autonomous slot advance, probes a freshly-reset part. Reset polarity is per-driver. A driver for an active-high-reset part exposes a `reset_active` parameter (enum; `1` active-high, `0` active-low; RAM-backed, reverts to its compiled default on reset) that the device reads at bind to drive the correct physical level; its absence selects the active-low default. The parameter is discoverable through the normal parameter path (§6.4); it reflects the part's fixed datasheet polarity rather than a per-deployment override.

### 6.3 Sample readout

The `SAMPLE_DATA` window (`0x40`, 128 bytes) holds one record, little-endian throughout:

| Offset | Field | Size | Content |
|---|---|---|---|
| 0 | `latch_time_us` | 8 | Device µs clock at the moment this read transaction latched the window (§6.8) |
| 8 | `timestamp_us` | 8 | The sample's acquisition instant, device µs clock — the delivered DRDY edge (or declared frame bound) behind its measure pass, or the commit instant where the pacing carries no event |
| 16 | `seq` | 2 | Sample sequence number, wraps at 2^16 |
| 18 | data | `SAMPLE_SIZE` | Raw sample bytes, ≤ 110 |

Readout is a single (optionally chunked) read of `18 + SAMPLE_SIZE` bytes from `0x40`: the device latches the whole record when the transaction first touches the window base and serves every byte from that snapshot, so `seq`, `timestamp_us`, and data are coherent by construction — no guard counter, no retry. Compare `seq` against the previous read to detect a new sample (or pre-check `STATUS` bit 0 with a one-byte read when polling faster than the sample rate); a `seq` moving backward signals a driver restart — re-read `SAMPLE_SIZE` and the descriptors (§6.6). Between a driver unload and the next load `SAMPLE_SIZE` serves 0 and the descriptor set is empty (`DESCRIPTOR_EPOCH` = 0, §6.6); a host must treat a 0 size, like a backward `seq`, as transitional — re-read rather than cache it.

Sample content is defined by the driver's output-field descriptors (name, type, byte order, scale, offset, unit, semantic per field), which travel inside the NXS image and are readable on device (§6.6) — decoding a sample requires no driver file on the host. `nxs outputs` prints the descriptor set.

The window always holds the latest sample, so the host can decimate further by polling slower than the device produces. `DECIMATION` (`0x0E`) is the device-output gate: at the default `1` the window and `SAMPLE_READY` advance on every sample, `N` advances them only every Nth sample, and `0` stops output entirely. The gate is device-wide — it applies identically to the I²C window and to the Cyphal sample and SI subjects — and the value is persisted across power cycles. Per-subject SI decimation is a separate refinement thinning only the Cyphal SI fan-out (§8.2.7); its factors are configurable over any transport — the `aliensense.nxs.decimation.<subject>` registers over Cyphal, the `DECIMATION_SELECT`/`DECIMATION_VALUE` window over I²C.

### 6.4 Parameters

Each parameter has a **kind** — `reload` or `live` — packed into `SEL_TYPE` bit 4 (§3), that selects how a write is applied.

Read: write the parameter index to `PARAM_SELECT`, then read the descriptor window at `0xC0`–`0xE8` in its parameter view (name, type, kind, default, current, unit), then page the allowed values through `SEL_VALUE_INDEX`/`SEL_VALUE`. A range parameter (`SEL_TYPE` low bits = 1) reports its bounds as `[min, max]` at value indexes 0 and 1.

Write: select the index, then write the new value as u32 to `PARAM_SET_VALUE`. Values outside the allowed set — or, for a range parameter, outside `[min, max]` — are rejected with `ERROR_CODE`. How an accepted value is applied depends on the kind:

- **reload** — the device patches the driver's bytecode and reloads the VM (re-running probe + configure). The parameter takes effect without a host-visible restart.
- **live** — the device updates the value in place; a runtime consumer re-reads it on its next cycle. The VM is **not** reloaded, so sampling continues uninterrupted.

Range parameters are always **live** — they carry no bytecode patch site, so a reload range would only fire a useless reload on every set. The device enforces the parameter contract at `LOAD`: an image is rejected (`ERROR_CODE` set, the staged image left unchanged) if it declares a reload range, a range with other than two `[min, max]` bounds, a `default`/`current` outside those bounds, or an unrecognized parameter type. A host that uploads a well-formed image never sees these. The PWM helper auto-declares two live range parameters — `pwm_freq` ∈ `[500, 25000]` Hz and `pwm_duty` ∈ `[0, 100]` % — that a host retunes at runtime via `PARAM_SET_VALUE` to drive the mikroBUS PWM pin.

Some parameters are injected by the compiler from a driver's hardware declarations rather than an explicit declaration: `bus` selects the active communication profile among the buses the driver supports (I²C `0`, SPI `1`; §10.2), `i2c_addr` overrides the strap scan, and `reset_active` sets the mikroBUS reset polarity. They are read and written through the same window and value path as any other parameter; `bus` reloads the driver so the new profile is applied at the next bind.

### 6.5 Driver store

The store persists up to 8 driver images in flash. `SAVE` writes the *staged* image (the most recent upload) to the selected slot; the result is reported in `CMD_ERROR` (§12) — 0 on success, else a positive errno (no driver staged, a duplicate already stored, or the store is full). A store command (`SAVE`, `DELETE_SLOT`, `CLEAR_STORE`, `PEEK_SLOT`) issued while a transfer session is live — an upload or a firmware push — is refused with `EBUSY`: persisting a half-streamed stage would surface as a corrupt slot at some later boot, and a store landing mid-firmware-push would overwrite the push's latched error detail. A stale session's partial stage is discarded rather than saved. On boot the device auto-loads the first populated slot. `STORE_COUNT`, `ACTIVE_SLOT`, and `CYCLE` (§5) manage rotation; PROBE_FAILED auto-advance (§6.2) makes a multi-sensor store self-selecting: the device settles on the first driver whose sensor answers.

### 6.6 Output descriptors

Each loaded driver declares how its sample bytes decode: per field a name, type, byte order, scale, offset, unit, semantic category, and — for string fields — a byte count. Fields are packed in declaration order; their widths sum to `SAMPLE_SIZE`. A numeric field's width follows its type; a string field's width is `SEL_OUTPUT_COUNT`. With no driver loaded the set is empty — `NUM_OUTPUTS` and `DESCRIPTOR_EPOCH` read 0, and `SAMPLE_SIZE` serves 0 until the next load (§6.3).

Read: write the field index (0 … `NUM_OUTPUTS`−1) to `OUTPUT_SELECT`, then read the descriptor window at `0xC0`–`0xE8` in its output view. The field decodes at its declared byte position (`SEL_OUTPUT_AT`; offsets may gap — binary-record drivers map fields onto scattered offsets). Physical value = raw × scale + offset, in the unit string's unit. The `scale` the window serves is the *effective* scale — the driver's base factor already multiplied by any linked parameter's live `current_value` (an IMU's full-scale range, say) — so `raw × scale` decodes to correct SI at the current range with no re-read of the driver image. The same effective scale backs the Cyphal `GetOutputInfo` service and the `si.sample.*` projection (§8.2.8).

Field type codes:

| Code | Type | Width |
|---|---|---|
| 0 | int8 | 1 |
| 1 | uint8 | 1 |
| 2 | int16 | 2 |
| 3 | uint16 | 2 |
| 4 | int32 | 4 |
| 5 | uint32 | 4 |
| 6 | float32 | 4 |
| 7 | float64 | 8 |
| 8 | string | `SEL_OUTPUT_COUNT` |

Semantic category codes (0 when no category applies; codes are append-only):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 0 | generic | 7 | mag_x |
| 1 | accel_x | 8 | mag_y |
| 2 | accel_y | 9 | mag_z |
| 3 | accel_z | 10 | temperature |
| 4 | gyro_x | 11 | pressure |
| 5 | gyro_y | 12 | humidity |
| 6 | gyro_z | 13 | nmea |

Geodetic semantic codes (the structured-GNSS group, projected onto the standard `reg.udral…geodetic.PointStateVarTs` subject):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 14 | latitude | 19 | vel_down |
| 15 | longitude | 20 | pos_h_acc |
| 16 | altitude | 21 | pos_v_acc |
| 17 | vel_north | 22 | vel_s_acc |
| 18 | vel_east | | |

Scalar SI semantic codes (each projected onto the matching `uavcan.si.sample.<quantity>.Scalar` subject, §8.2.8):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 23 | angle | 29 | luminance |
| 24 | voltage | 30 | mass |
| 25 | current | 31 | torque |
| 26 | distance | 32 | speed |
| 27 | force | 33 | flow |
| 28 | frequency | | |

GNSS epoch semantic codes (no standard-subject projection; they identify a receiver's time solution for epoch-aware consumers — the ROS 2 bridge's receiver-epoch stamp mode keys on the pair):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 34 | time_of_week | 35 | fix_type |

Descriptor reads race the device's autonomous driver changes (§6.2), so a host validates a descriptor set with `DESCRIPTOR_EPOCH`:

1. Read `DESCRIPTOR_EPOCH` (e₀). 0 means no descriptors are readable — no driver is loaded, or the firmware predates this register (which then always reads 0).
2. Read `NUM_OUTPUTS`, then each descriptor via `OUTPUT_SELECT`.
3. Read `DESCRIPTOR_EPOCH` again (e₁). If e₁ = e₀ the set is coherent; cache it keyed by e₀. Otherwise restart from step 1.

A cached set remains valid exactly while `DESCRIPTOR_EPOCH` still reads e₀; re-check it before trusting a cached sample layout. The epoch advances on every driver (re)load — a re-upload under the same driver name may carry different fields, so equality of the driver name guarantees nothing.

### 6.7 Commissioning (identity)

Node-ID, subject-IDs, and the CAN bit-timing profile are committed through the `PROGRAM_DATA` window under a config transfer mode — no extra fixed registers in the full map. The record is 28 bytes, packed little-endian: the u16 node address, nine u16 subject addresses in order — `sample`, `status`, `acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`, `gnss`, `scalar` — then the u32 CAN arbitration and data-phase bitrates in bit/s. A valid node address is `0`–`125` (126 and 127 are reserved for diagnostic and host tooling), `255` (anonymous), or `0xFFFF`; a valid subject address is `0`–`8191` — the `scalar` base at most `8181`, keeping its 11-subject block in range. An address of `0xFFFF` reverts the field to the compiled default; a subject address of `0` disables that topic. The bitrate pair must be a supported profile (§8.2.7): equal rates select Classic CAN, and `{0, 0}` reverts to the compiled default profile — a host that changes only identity reads the record first and echoes the current pair back.

| Step | Register / command | Effect |
|---|---|---|
| 1 | write `XFER_TYPE = 2`, read it back | enter config mode; a live transfer session refuses the write silently, so the readback is the claim check. The `PROGRAM_DATA` window mirrors the current record for read-back |
| 2 | read `PROGRAM_DATA` (28 B) | the current identity record |
| 3 | write `PROGRAM_DATA` (28 B) | stage a new record |
| 4 | write `CMD = STORE_PERSIST` | validate + commit; poll `CMD_ERROR` until it leaves `CMD_ERR_PENDING` (`0` = OK, `EINVAL` = out of range, `EPROTO` = the staged record was trampled by an interleaved mode write, §12 — re-stage from step 2). Consuming the record resets the staging cursor, so a corrected record may be staged and committed without re-entering config mode |
| 5 | write `CMD = REBOOT` | the new node-ID / subject-IDs / CAN profile take effect on boot |

Identity is fixed when the Cyphal node is constructed, so steps 1–4 persist the record and step 5 applies it. The same `STORE_PERSIST` snapshots the live decimation state — the device-wide `decimation` (§4) and the per-subject SI factors — so the running rates persist alongside the identity, exactly as a Cyphal Save does. A record staged in step 3 holds the window until step 4 consumes it (or config mode is left): the device's own identity refresh never overwrites pending staged bytes. Staging is last-writer-wins between masters — commissioning is a provisioning operation, one master at a time. A factory-fresh device needs none of this: it is plug-and-play at the compiled defaults.

### 6.8 Time synchronization

All device timestamps — `timestamp_us` in the sample record (§6.3), in `RawSample` (§8.2), and in the SI subjects (§8.2.8) — are one monotonic µs clock counting from device boot. The device additionally serves that clock's *current* value on every wire, so a host can measure the device→host clock offset with a bounded error and translate acquisition timestamps into its own time domain:

- **I²C**: `latch_time_us` in the sample record is stamped when the read transaction latches the window — the host's clock readings immediately before and after that transaction bracket it, so every sample poll doubles as one sync observation.
- **Cyphal (serial and CAN)**: the read-only `aliensense.nxs.time_us` register (natural64, §8.2.7) returns the clock at request service time; the host brackets the `register.Access` round trip.

The estimation recipe is the standard two-way method (RFC 5905): for each exchange with host clock readings `t0`/`t1` around a device reading `d`, the host−device offset candidate is `(t0 + t1)/2 − d` with error bounded by `(t1 − t0)/2`; keep the minimum-round-trip exchange over a sliding window (~30 s) and fit drift across the window (the device clock is oscillator-driven, tens of ppm). Repeating an exchange at ~1 Hz holds the projection error near the per-wire floor: ~100 µs on I²C (the host masters a ~200 µs transaction), a few hundred µs on CAN-FD, and 1–2 ms on serial (the exchange shares a half-duplex link with the sample stream). `nxs ros2 --stamp synced` implements exactly this; the surfaces are standard reads, so any host can.

The host can additionally push its estimate down, giving the device a synced timescale — mesh time — beside its untouched local clock. The push is volatile and expires: each record carries its own validity window, the discipline decays that long after the push applies, and every consumer falls back to local behavior. The window is the pusher's receipt timeout expressed as a duration — the `nxs` tools push ten times their refresh cadence, so ten consecutive lost pushes end the discipline. A zero window is malformed and the device rejects the record.

- **I²C**: write `XFER_TYPE = 3` and read it back — a live transfer session (a driver upload or firmware push) refuses the write silently, and a periodic pusher skips the cycle rather than streaming into the wrong sink — then stream the 20-byte record — offset (i64 LE, µs), bound (u32 LE, µs), rate (i32 LE, parts per billion), then validity window (u32 LE, µs) — into `PROGRAM_DATA`. The record applies as its last byte lands and the window re-arms for the next push. A read of the window in this mode serves the live state: offset, bound, rate, validity window, a source byte (0 none or stale, 1 host), and a validity byte.
- **Cyphal**: write `aliensense.nxs.time_sync` (`integer64[4]` — offset µs, bound µs, rate ppb, validity window µs) in one `register.Access`; a read serves `integer64[5]` — offset, bound, rate, validity window, source.

While a discipline is fresh, the SI subjects' `SynchronizedTimestamp` fields carry mesh time (the local clock mapped through the pushed offset and rate); undisciplined, they carry the local clock. `RawSample.timestamp_us` and the sample record stay the local clock always. The rate term extrapolates the estimator's fitted clock skew between pushes, so the mesh error no longer grows at the oscillator differential over the push interval. While a discipline stays valid, mesh time is continuous and monotonic across pushes: a correction of 1 ms or less is absorbed by slewing at 500 ppm, never by stepping. The first discipline, a re-acquire after staleness, and a correction beyond 1 ms apply as a step. The status LED renders its pattern from the synced second while disciplined, so synced units blink in phase. `nxs suite switch` seeds the discipline at converge, and a resident pusher — `nxs suite timesync`, per-unit `nxs timesync`, or the ROS 2 bridge — keeps it fresh.

### 6.9 Calibration

The device stores one per-unit calibration record: an affine correction `v_out = M·v + b` (M 3×3 row-major, b 3×1) per vector bucket — acceleration, angular velocity, magnetic field — a mounting-orientation code, and a scalar encoder zero-offset added to the `angle` output, the sum wrapped into [0, 2π). The correction applies in the SI tier only: the `uavcan.si.sample.*` subjects (§8.2.8) carry calibrated values, while the `RawSample` stream and the I²C sample window (§6.3) carry raw counts. A host that applies the served record to its own raw decode reproduces the SI subjects exactly.

The orientation code composes a mount rotation on top of each bucket's affine (effective affine = R·M, R·b): one of the 24 axis-aligned proper rotations, named by their composition R = Rz(yaw)·Ry(pitch)·Rx(roll) with each angle in {0, 90, 180, 270} — `NONE` (0), `YAW_90` (1), … `ROLL_270_YAW_270` (23). The code names the board's physical mounting rotation relative to the vehicle frame; the device applies that same rotation to measured vectors, so a board mounted with the named rotation reports vehicle-frame values. Verification anchor: a level board with `ROLL_90` set reads gravity on −Y; the physically rolled board (+Y up) reads +Z.

Each solved bucket carries a driver tag — the FNV-1a 32-bit hash of the driver it was solved against, taken over the driver name, the bus kind, and the latched device address, 0 = unguarded. Two identical Clicks on one panel therefore hash to different tags, so a swap between them is refused rather than silently accepted. A tagged bucket whose tag mismatches the running driver contributes only the mount rotation, never the stale affine. The encoder zero carries its own tag.

**Record layout** — 168 bytes, packed little-endian, one layout on flash and the wire:

| Offset | Field | Type | Content |
|---|---|---|---|
| 0 | `version` | u8 | record-layout version, 1. A persisted record whose version or size mismatches the firmware's layout is discarded at boot in favour of identity defaults |
| 1 | `orientation` | u8 | rotation code 0–23 |
| 2 | `reserved` | u8[2] | 0 |
| 4 | `m` | f32[3][9] | per-bucket M, row-major; buckets in order acceleration, angular velocity, magnetic field |
| 112 | `b` | f32[3][3] | per-bucket b, same order |
| 148 | `encoder_zero` | f32 | radians added to the `angle` output, the sum wrapped into [0, 2π) |
| 152 | `driver_tag` | u32[3] | per-bucket driver guard, 0 = unguarded |
| 164 | `encoder_tag` | u32 | encoder-zero driver guard |

**Record write.** The record travels through the `PROGRAM_DATA` window under a calibration transfer mode, mirroring the identity flow (§6.7):

| Step | Register / command | Effect |
|---|---|---|
| 1 | write `XFER_TYPE = 4` | enter calibration mode; resets the staging cursor |
| 2 | write `PROGRAM_DATA` (168 B, chunks of ≤ 32 bytes) | stage the record |
| 3 | write `CMD = CALIB_APPLY` | validate + apply to the running state; poll `CMD_ERROR` until it leaves `CMD_ERR_PENDING` (`0` = applied, `EBUSY` = a firmware update or a running procedure holds the status registers, `EINVAL` = malformed or incomplete record) |
| 4 | write `CMD = CALIB_PERSIST` | persist the running record to NVS; poll `CMD_ERROR` (`0` = committed, `ENODEV` with no calibration bank). This save carries no identity record, so it is a distinct command from `STORE_PERSIST` (§5) rather than the same one in a different ambient state |

Step 3 changes the running state immediately — no reboot. Step 4 is the unified Save of the running/startup model (§8.2.7). An applied record that is not persisted reverts at power-cycle.

Over Cyphal the same two phases are the calibration registers and `aliensense.nxs.calibration.commit` (§8.2.7): field writes stage, the commit applies the staged record whole, and Save persists it. Staging is what keeps the SI subjects from publishing under a partly-updated record — a host changing both the coefficients and the mount would otherwise emit the new coefficients under the old rotation for the remaining round trips. `aliensense.nxs.calibration.dirty` reads `1` while staged and running differ. Writing `0` to `calibration.commit` discards the staged edit and re-seeds the stage from the running record — the reset for an abandoned or failed edit. A commit refused `ECANCELED` (an on-device solve landed mid-edit) also discards the stage, so the host re-reads and re-stages on a fresh copy; a validation refusal keeps the stage for a single-field correction.

**Record read-back.** Under `XFER_TYPE = 4` the `PROGRAM_DATA` window mirrors the running record, paged by `STORE_SELECT`: write the page index, then read the window — it serves record bytes `[page·32 .. page·32+31]` (the 168-byte record spans six pages). Byte 168 is the record's change counter, the same value the `aliensense.nxs.calibration.epoch` register serves over Cyphal. A host brackets the paged read on it — read the counter, the record, the counter again, and retry when it moved — the `DESCRIPTOR_EPOCH` idiom (§6.6), identical on both transports.

**On-device procedures.** Two solves run on the device itself, so a Cyphal autopilot or any I²C master drives them with no host tool. They report on the same registers the DFU path uses, and the device refuses the overlap: a procedure start while an update or upload session is live answers `EBUSY`, on either transport, as does starting an update while a procedure runs. That rule includes the boot-automatic gyro pass, which arms at the first driver load. `XFER_PHASE` carries the state (0 idle, 1 gyro-wait-still, 2 gyro-averaging, 3 mag-collect), `XFER_ACK` the detail (gyro percent averaged, or mag rotation coverage of 14, of which 12 is the stopping point at which a host asks the solve — the answer can still be `EAGAIN`), and `CMD_ERROR` the completion verdict. A procedure has finished when `XFER_PHASE` returns to idle. Read the verdict in the same poll that observes the idle phase. `CMD_ERROR` is shared with the store and DFU results, the next command op replaces it, and an `XFER_TYPE` = 0 write clears it.

- **Gyro still-average** (`CAL_GYRO`). The device waits for stillness (a per-axis peak-to-peak gate), averages 400 samples, and writes `b = −mean` into the running record. The command result is acceptance only. The completion verdict lands in `CMD_ERROR` on the idle edge: it reads 0 while the average runs, then the errno when `XFER_PHASE` returns to idle. A commanded run times out after 60 s. The same procedure also runs once automatically at boot, on the first driver load — it completes on a still boot and gives up with `ETIMEDOUT` after ~15 s of motion, leaving the stored bias untouched.
- **Mag in-situ ellipsoid** (`CAL_MAG_START` / `CAL_MAG_STOP`). `CAL_MAG_START` begins collection: the vehicle is rotated through all attitudes while the device accumulates float64 normal-equation sums, and no sample cloud is stored. `CAL_MAG_STOP` coverage-gates, solves, self-checks, and applies. Its `CMD_ERROR` is the fit verdict — 0 = applied; `EAGAIN` = insufficient coverage; `ERANGE` = degenerate, non-ellipsoid fit; `EBADMSG` = failed the sphere self-check (the calibrated |B|² spread over the accumulated cloud exceeds the gate). Every failure keeps the previous calibration. `EAGAIN` alone leaves the collection open and restarts its give-up window, so a host that reaches the progress byte's stopping point and is told "not yet" keeps rotating and stops again rather than starting over (a stop after the window finally expires answers `EINVAL` — no collection open) — coverage is only decided once the fit has divided the mount's own distortion out, so the progress byte is an estimate. `Cmd::XFER_ABORT` drops a procedure without solving, for a host that wants to cancel rather than commit; over Cyphal the same release is `CAL_ABORT` (0xA00D). The solve preserves the RMS field radius, and the procedure runs mounted in the vehicle — the iron the fit removes belongs to the installation, not the module.

Accelerometer calibration is a host-side procedure: a six-pose least-squares solved by the `nxs` tool and uploaded through the ordinary record write (Integration Manual §4.8). There is no dedicated reset command. Writing the identity record with the orientation field kept, then persisting it, is the reset, and `nxs calibrate reset` performs exactly that.

### 6.10 Build identity

The firmware's exact build is served as its `git describe` string — `vMAJOR.MINOR.PATCH-N-gSHA`, where `N` counts commits above the release tag and `SHA` is the short commit hash, with `-dirty` appended when the image was built from an uncommitted tree. The record is 64 bytes, NUL-padded, read-only.

1. Save `XFER_TYPE` and `STORE_SELECT`, then write `XFER_TYPE` = 5.
2. Read page 0 through the `PROGRAM_DATA` window; if no NUL byte appeared, select page 1 via `STORE_SELECT` and read the remainder.
3. Restore both registers. Restore `XFER_TYPE` to its prior value rather than 0 — writing 0 clears `CMD_ERROR`, which may hold an unread command verdict.

The string is the same value the Cyphal `aliensense.nxs.fw.describe` register serves, and the SDK's `read_fw_version()` returns it verbatim on every transport. Firmware whose `PROGRAM_DATA` window does not answer the mode serves the numeric pair through `FW_VERSION_MAJOR`/`FW_VERSION_MINOR` (§3) instead.

## 7. Firmware update

### 7.1 Model

The device keeps two firmware slots (A/B). An update stages the new image into the inactive slot; `DFU_FINISH` marks the swap pending and reboots. The new image boots in a probationary TEST state and self-confirms after ~1 second of healthy main-loop execution. An image that faults, hangs (3-second hardware watchdog), or otherwise fails to confirm is automatically reverted on the next reset — the previous firmware returns without host intervention. A power loss mid-swap resumes or reverts cleanly; no sequence in this section can brick the device.

Firmware images are signed; the bootloader only swaps to an image whose signature verifies (build-gated; development builds may run unsigned).

While a session is open the device halts sensor sampling and refuses the VM-control claim to any other transport (§7.5); a command from another transport is silently dropped and must be retried. Sampling resumes after an abort, after the reboot that ends a successful update, or once the claim is released (§7.5).

### 7.2 Update over Cyphal (file pull)

Over Cyphal the device is the *client*: a host command names a path, and the device pulls the image from a file server with standard `uavcan.file.Read` (fixed port 408) requests. The host serves the file; it issues no per-chunk writes. The same pull engine delivers both a firmware image and a driver image — only the trigger, the server selection, and the completion action differ.

#### Trigger and server selection

| Trigger | Image | Sink | File server |
|---|---|---|---|
| `ExecuteCommand` `BEGIN_SOFTWARE_UPDATE` (65533) | firmware | DFU slot | the commanding node (request's source node-ID) |
| `ExecuteCommand` `LOAD_FROM_FILE` (`0xA000`) | driver (NXS) | staging buffer | `aliensense.nxs.file_server_id` register if non-zero, else the commanding node |

Both commands carry the server-side path in the ExecuteCommand `parameter` field (`uavcan.file.Path`, ≤ 255 bytes). For `BEGIN_SOFTWARE_UPDATE` the server is always the node that sent the command, the contract `yakut --update-software` relies on. For `LOAD_FROM_FILE` the server defaults to the commanding node so a single-node tool works with no configuration; writing a non-zero node-ID to `aliensense.nxs.file_server_id` (natural16, range 0–127) redirects the driver pull to a dedicated server. A value of 0 (the default) selects the commanding-node fallback. The resolved server must be a valid node-ID (0–127); a fallback to an anonymous or out-of-range commanding node — possible on the serial link, where a service request is not gated to a valid source node-ID — is rejected with `STATUS_FAILURE` rather than issuing a Read to a bad node.

The ExecuteCommand reply is sent before the pull does any work: a trigger that starts a pull returns `STATUS_SUCCESS` (0) immediately; the transfer then proceeds in the background, driven from the device's 1 Hz tick and its receive path. Pull progress and failure are observed through the node Heartbeat (mode `SOFTWARE_UPDATE` while a pull is active; see §7.1's session model), not through the ExecuteCommand reply.

#### Pull loop

The device requests the file as offset-addressed chunks of at most 256 bytes (the `uavcan.primitive.Unstructured` array capacity that carries `uavcan.file.Read.Response.data`). Exactly one Read is in flight at a time. On each in-order response the chunk is written to the sink at the request's offset, the offset advances by the byte count returned, and the next Read is issued at the new offset. A response whose `data` array is shorter than 256 bytes marks end-of-file: the device commits the sink and the pull ends. A full 256-byte response is never the last chunk; a file that is an exact multiple of 256 bytes terminates with a final zero-length read.

Chunks are required to arrive strictly in ascending order. A write whose offset does not equal the running received-byte count is refused rather than assembled into a holed image, which fails the pull.

#### Timing and retry

| Parameter | Value |
|---|---|
| Read timeout | 500 ms |
| Max retries per offset | 5 |

If no matching response arrives within 500 ms of issuing a Read, the device re-issues the Read at the **same** offset. A `uavcan.file.Read` at a given offset is idempotent, so a lost request or a lost response recovers without disturbing the sink or the host-side server. The retry counter resets to zero each time a chunk lands and advances the offset. Six consecutive timeouts at one offset (the initial Read plus five retries) exhaust the budget and abort the pull.

#### Failure conditions

Any of the following fails the pull. On failure the sink is aborted (the staged image is discarded) and the internal state becomes `FAILED`; the device resumes sensor sampling. None of these conditions reboots the device or alters the running firmware/driver.

| Condition | Cause |
|---|---|
| Path too long | command `parameter` exceeds 255 bytes (`-ENAMETOOLONG`) |
| Sink rejected the open | firmware/driver staging declined `begin` (staging unavailable — e.g. an update already in progress) |
| Request TX failed | the Read could not be enqueued or sent on the transport |
| Server Read error | the response's `error` field is non-zero (path not found, I/O error, …) |
| Malformed response | the `uavcan.file.Read.Response` failed to deserialize |
| Write failed | the sink rejected a chunk (flash program error, out-of-order offset, overflow) |
| No response | the retry budget for one offset was exhausted |

#### Completion

The completion action is fixed by which trigger started the pull:

- **Firmware** (`BEGIN_SOFTWARE_UPDATE`): end-of-file arms the MCUboot swap (the staged image becomes swap-pending) and the device reboots into §7.1's probationary TEST flow. The reboot arrives seconds after the ExecuteCommand reply has drained, so it is not observable as a failed command.
- **Driver** (`LOAD_FROM_FILE`): end-of-file loads the assembled NXS driver — the driver structure is activated but **not** started, and the device does not reboot. Starting it is a separate `RUN` (`0xA001`) command (§6), mirroring the upload-then-run split of the I²C driver path.

#### One pull at a time

The device holds the state of a single transfer. A second provisioning trigger — firmware or driver — received while a pull is active is rejected with `STATUS_FAILURE` (1) and leaves the in-flight pull untouched. The host waits for the active pull to finish (Heartbeat mode returns to `OPERATIONAL`) before starting another.

#### No image-size ceiling

The pull places no upper bound on image length. The service transfer-ID that tags each Read is 5 bits on Cyphal/CAN (wraps every 32 transfers, ~8 KiB) and an 8-bit counter on Cyphal/serial (wraps every 256 transfers, ~64 KiB); the device matches each response against the in-flight request modulo that field, so a pull continues correctly across every wrap. The only size limit is the capacity of the target slot or staging buffer: the pull opens the sink with the total size unknown, so an oversize image is not declined at `begin` — it fails at the first write past the capacity, aborting the pull.

### 7.3 Update over I²C

1. Write `XFER_TYPE = 1` and read it back — a live transfer session refuses the write silently, and the readback is the claim check.
2. Write `CMD = DFU_BEGIN` and poll `CMD_ERROR` out of `CMD_ERR_PENDING`, straight through the erase: an accepted begin bulk-erases the staging slot first, stalling the device ~2.5 s with the bus held off (stretched or failed transactions — keep polling). The verdict lands after the erase: `0` with `XFER_PHASE` already READY; `EPROTO` — `XFER_TYPE` is not 1; `EBUSY` — a session is live (a second `BEGIN` never restarts a running push; release deliberately with `XFER_ABORT`).
3. `XFER_PHASE` reads ERROR instead: the erase failed — read `CMD_ERROR`, abort.
4. For each chunk k = 0, 1, 2 …: write up to 32 image bytes to `PROGRAM_DATA`, then poll `XFER_ACK` until it reads (k+1) mod 256. The chunk carries no offset — the device appends at its own cursor, exactly one chunk may be in flight, and the counter is the acknowledgement. If the counter stalls past a timeout, re-read it: still k means the chunk was dropped — resend the same bytes; k+1 means it landed. Resending a landed chunk is impossible to confuse with a lost one, and out-of-order delivery cannot occur.
5. `XFER_PHASE` = ERROR at any point: the failed chunk did not commit. `CMD_ERROR` holds the reason, and the session stays latched so the detail survives until it is read — release with `XFER_ABORT`, then restart with `DFU_BEGIN`.
6. Write `CMD = DFU_FINISH`. Confirm success by the reboot, not the write's ACK: the device publishes `XFER_PHASE = FINISHING` and then the reset drops the bus (a NACK on the tail of this transaction is that reset, not an error). A finish dropped before dispatch at a full command queue instead leaves the bus alive with `XFER_PHASE` unchanged — resend it. `XFER_PHASE = ERROR` is a failed finish: read `CMD_ERROR`, then release the session with `XFER_ABORT`.
7. To abort a session, write `CMD = XFER_ABORT` (§5). The device resumes sensor sampling, progress registers reset to IDLE/0, `XFER_TYPE` resets to 0, and `PROGRAM_DATA` reverts to the driver-upload path. An abandoned session (host crash) releases itself after 2 s of silence.

### 7.4 Recovery

A device whose application firmware is damaged beyond the revert path recovers through MCUboot serial recovery (mcumgr / SMP over UART). A device in recovery **holds there** until an upload completes, so no host has to catch a boot-time window: run `mcumgr` / `smpmgr image upload`, then `smpmgr os reset`. The status LED shows two dark winks per second throughout ([Device Reference §2.3](../nxs-device-reference/)).

Recovery runs the host UART at **115200 8N1**, not the 460800 the application uses (§8.1). That is the default rate of every mcumgr client, so the upload command needs no baud option. A client pinned to 460800 sees no response at all, because the bootloader is not listening at that rate.

The bootloader answers the SMP commands recovery needs — image upload, image state, slot info, echo, console echo control, and reset — and returns `MGMT_ERR_ENOTSUP` (8) for anything else. The optional `MCUMGR_PARAMETERS` query falls in that second group, so a client that issues it at connect time logs one warning and proceeds. The values it would have returned are a 128-byte line length and 8 line buffers, giving a 1024-byte maximum frame. A client that defaults to fewer buffers uploads correctly but slower, and passing the buffer count explicitly (`--line-buffers 8` on `smpmgr`) restores the intended frame size.

Three entrances reach that state, covering successively worse failures.

| Entrance | Applies when |
|---|---|
| `ENTER_RECOVERY` — I²C `Cmd` 14 (§3), or the vendor ExecuteCommand `0xA008` on Cyphal | the application still answers on a host transport. `nxs recover` on either transport arms the flag, acknowledges, then cold-resets |
| Bridging mikroBUS `RST` to `CS` in place of a Click board, then resetting | the application boots but stops answering. The bridge is read once at reset; remove it and the module boots normally |
| Resetting a module whose slot 0 holds no valid image | the image is erased, unsigned, or corrupt. No action beyond power is needed — the module cannot leave recovery until an image is uploaded |

The command dispatches independently of the driver runner, so it reaches a device whose driver never loaded. Recovery is a last resort; the validated update path is §7.2/§7.3.

### 7.5 Transport arbitration (cross-transport)

The device accepts host commands on three transports — the UART host link, I²C (§3), and Cyphal/CAN-FD — and arbitrates VM-control authority so that at most one transport drives control or a staged update at any instant. Egress is not arbitrated: liveness, status, and the sample stream emit on their transport unconditionally, independent of which transport holds the control claim.

**Claim.** The arbiter is idle at boot. The first host command on an idle arbiter claims control for its transport. A command on the transport that already holds control refreshes the claim. A command on a different transport takes over control only if the current holder has no session in flight; otherwise it is rejected.

**Reject.** A command rejected because another transport holds an in-flight session is **dropped without a reply**. On I²C the register file still tells the truth: a rejected op that had armed `CMD_ERROR` resolves to `EBUSY`, so a polling host fails immediately and by name; a rejected plain write is simply lost. On the reply-carrying transports the host distinguishes the drop only as a timeout and must retry. Every reject is counted — the `INGRESS_REJECTS` fault counter (§12) is the wire-visible evidence, and because I²C register reads and the diagnostic-view selectors (§12.1) both bypass the arbiter claim, the losing I²C host can select the diag view and read it while still being rejected. The Cyphal copy (`aliensense.nxs.ingress_reject_count`) refreshes at the ~100 ms status cadence, and Cyphal register reads do claim the arbiter, so it becomes readable there once the session ends.

**Idle release.** A held claim auto-releases after **5 s** of holder silence. Release is evaluated on the next command from another transport; a holder that keeps issuing commands (or, for a file pull, keeps receiving responses) holds control indefinitely. The cross-transport lock is therefore time-bounded — a holder that goes silent for 5 s is preempted on the next competing command, even mid-session.

**Session.** A session is the in-flight state the device must not let a competing transport interrupt:

| Transport | A session is in flight while |
|---|---|
| I²C | a DFU staging session is open (§7.3), or a chunked driver-image upload is in progress (§6.1) |
| Cyphal (serial / CAN-FD) | a DFU session is active, or a `uavcan.file` pull (firmware or driver) is active |

While any session is in flight on one transport, host commands on the other transports are rejected per *Reject* above. This is the cross-transport counterpart to the same-transport rule in §7.1. A long file pull keeps its claim alive through per-response progress, so it is not preempted mid-transfer; if the pull stalls, control is released within 5 s.

## 8. UART transport

The UART carries the Cyphal/serial host link (§8.2). The electrical link is described in §8.1, the protocol framing in §8.2.

### 8.1 Link

8 data bits, no parity, 1 stop bit, no flow control. 460800 baud, with the UART hardware FIFO enabled so the link sustains a full 250 Hz sample stream without dropped frames.

### 8.2 Cyphal/serial host link

On the UART the NXS is a Cyphal node, decodable by yakut / pycyphal without proprietary tooling. The electrical link is §8.1 (460800 baud, 8N1). I²C (§3) is unaffected. Firmware update and driver delivery run over this link via a standard `uavcan.file.Read` pull (§7.2); I²C update and recovery (§7.3, §7.4) remain available.

Node identity is name `com.aliensense.nxs`, node-ID `125` by default (register `uavcan.node.id`; commissioned to deconflict a CAN mesh — §8.2.7). Device behaviour — VM states, driver store, DFU model — is identical across the host transports (§1). Vendor DSDL types and registers live in the `aliensense.nxs` namespace: `axon` is the compute board's design name, fixed on the wire for compatibility, and a host that consumes only the standard `uavcan.si.sample.*` subjects never references it.

#### 8.2.1 Frame format

The host link carries one Cyphal/serial transfer per frame. A host integrator builds a frame from the constants in this section without proprietary tooling; the wire is byte-identical to pycyphal's serial transport.

Single-frame transfers only. There is no segmentation, no reassembly, and no session table on the link; every transfer fits one frame and is delivered or dropped whole.

**Frame structure.**

```
0x00 | COBS( header[24] | payload[0..512] | transfer_crc[4] ) | 0x00
```

A frame is a COBS-encoded body bracketed by `0x00` delimiters — one leading and one trailing. The body that COBS encodes is the 24-byte header, the serialized DSDL payload, and a 4-byte transfer CRC, in that order. Maximum payload is 512 bytes.

**COBS framing.** Consistent Overhead Byte Stuffing removes every `0x00` from the body so the `0x00` delimiter is unambiguous. The encoder emits the trailing delimiter; the leading delimiter is prepended, reproducing pycyphal's `0x00 | COBS | 0x00`. The decoder skips one or more leading `0x00` bytes (a delimiter may be shared with the prior frame on the wire), then requires the body to end in the trailing `0x00`. A `0x00` inside the decoded body, a zero COBS code byte, or a run length that overruns the body fails the decode.

#### 8.2.2 Header (24 bytes)

The header is a 22-byte little-endian field block followed by a 2-byte CRC-16/CCITT-FALSE. Every multi-byte field is **little-endian except the header CRC**, which is the sole big-endian field.

| Offset | Width | Endian | Field | Value / Notes |
|---|---|---|---|---|
| 0 | 1 | — | `version` | `0x01`. A frame with any other value is dropped. |
| 1 | 1 | — | `priority` | 8-bit Cyphal priority level (0 = Exceptional … 7 = Optional). The byte is carried verbatim; the codec does not validate or clamp it. |
| 2 | 2 | LE | `source_node_id` | Sender node-ID. `0xFFFF` = anonymous. |
| 4 | 2 | LE | `destination_node_id` | Target node-ID. `0xFFFF` = anonymous / broadcast (messages). |
| 6 | 2 | LE | `data_specifier` | Subject-ID or service-ID plus role bits — see §8.2.3. |
| 8 | 8 | LE | `transfer_id` | 64-bit transfer-ID. On receive only the low 8 bits are consumed (§8.2.6). |
| 16 | 4 | LE | `frame_index_eot` | Frame index with bit 31 = End-Of-Transfer. Single-frame: always `0x80000000`. |
| 20 | 2 | LE | `user_data` | Reserved, `0x0000`. A nonzero value is dropped. |
| 22 | 2 | **BE** | `header_crc` | CRC-16/CCITT-FALSE over bytes 0–21, appended **big-endian** (byte 22 = high, byte 23 = low). |

**Header CRC.** CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, non-reflected input and output, final XOR `0x0000`. Computed over header bytes 0–21 and appended big-endian. The receiver validates by computing the same CRC-16 over all 24 bytes (struct + appended CRC) and requiring the residue to equal `0`; a nonzero residue drops the frame.

#### 8.2.3 data_specifier bit layout

The 16-bit `data_specifier` encodes the transfer role and the port-ID.

| Bit(s) | Mask | Meaning |
|---|---|---|
| 15 | `0x8000` | Service-not-message. Set = service transfer; clear = message transfer. |
| 14 | `0x4000` | Request-not-response. Set = request; clear = response. Defined only when bit 15 is set. |
| 14:0 | `0x7FFF` | Subject-ID, when bit 15 is clear (message). 15-bit field. |
| 13:0 | `0x3FFF` | Service-ID, when bit 15 is set (service). 14-bit field. |

Encoded role values:

| Transfer | `data_specifier` |
|---|---|
| Message | `subject_id` |
| Request | `service_id \| 0xC000` |
| Response | `service_id \| 0x8000` |

The receiver classifies on the role bits: bit 15 set selects service (request when bit 14 set, else response) and masks the port-ID with `0x3FFF`; bit 15 clear selects message and masks with `0x7FFF`.

#### 8.2.4 Transfer CRC

Every transfer — single-frame included — appends a 4-byte transfer CRC after the payload, inside the COBS body.

CRC-32C / Castagnoli: reflected polynomial `0x82F63B78`, initial value `0xFFFFFFFF`, reflected input and output, final XOR `0xFFFFFFFF`. Computed over the payload bytes only (not the header) and appended **little-endian**. An empty payload still carries the CRC of zero bytes. The receiver recomputes the CRC-32C over the decoded payload and drops the frame on mismatch.

#### 8.2.5 Rejection conditions

A frame failing any check below is dropped silently. There is no NAK and no error reply on the wire. Failures increment internal counters (`rx_decode_errors`, `rx_overflow_errors`) that are not host-readable over this link.

| Condition | Check |
|---|---|
| COBS failure | Missing trailing delimiter, embedded `0x00`, zero code byte, or run-length overrun. |
| Undersize | Decoded body shorter than 28 bytes (24-byte header + 4-byte transfer CRC). |
| Version mismatch | Byte 0 ≠ `0x01`. |
| Bad header CRC | CRC-16/CCITT-FALSE residue over the 24-byte header ≠ `0`. |
| Multi-frame | `frame_index_eot` ≠ `0x80000000` (EOT clear or frame index nonzero). |
| Nonzero user_data | Bytes 20–21 ≠ `0x0000`. |
| Bad transfer CRC | CRC-32C over the payload ≠ the appended little-endian value. |
| Misaddressed service | Service transfer whose `destination_node_id` is not this node's ID. |
| Out-of-range source | Non-anonymous `source_node_id` > `127` (would alias the 7-bit `CanardNodeID`). |

#### 8.2.6 Node-ID mapping

The wire carries 16-bit node-IDs; a transfer maps onto libcanard's 7-bit `CanardNodeID` (`CANARD_NODE_ID_MAX` = 127).

| Wire `source_node_id` | Mapped `CanardNodeID` |
|---|---|
| `0xFFFF` | `CANARD_NODE_ID_UNSET` (255) — anonymous. |
| `0`–`127` | The value, cast to `CanardNodeID`. |
| `128`–`0xFFFE` | Frame dropped (out-of-range source, §8.2.5). |

The `transfer_id` header field is 64-bit, but only its low 8 bits are taken into the Canard transfer on receive (`CanardTransferID` is 8-bit). A transmitter populates the full 64-bit field; the upper bytes are not consumed by the receiver.

**Served ports.**

| Port | Type | Function |
|---|---|---|
| Heartbeat | `uavcan.node.Heartbeat` (subject 7509) | 1 Hz; health and mode track the VM error state and the DFU session |
| GetInfo | `uavcan.node.GetInfo` | device identity — response fields detailed under **Device identity** below |
| Registers | `uavcan.register.Access` / `.List` | read/write the registers below |
| Command | `uavcan.node.ExecuteCommand` | `COMMAND_RESTART` (65535) reboots; `COMMAND_STORE_PERSISTENT_STATES` (65530) validates and commits staged config (§8.2.7); `COMMAND_BEGIN_SOFTWARE_UPDATE` (65533) and vendor `LOAD_FROM_FILE` (0xA000) trigger a file pull (see Provisioning); vendor `RUN` (0xA001) / `STOP` (0xA002) run / halt the driver; `SAVE` (0xA003) / `DELETE_SLOT` (0xA004) / `CLEAR_STORE` (0xA005) / `CYCLE` (0xA006) manage the store (slot in `parameter[0]`); `RESET` (0xA007) unloads the driver; `ENTER_RECOVERY` (0xA008) arms MCUboot serial recovery and reboots into it, where the device holds until an upload completes (§7.4); `IDENTIFY` (0xA009) strobes the status LED (~10 s) to physically locate the unit; `CAL_GYRO` (0xA00A) starts the on-device gyro still-average, `CAL_MAG_START` / `CAL_MAG_STOP` (0xA00B / 0xA00C) bracket the mag collection, and `CAL_ABORT` (0xA00D) drops any procedure in progress without solving — the previous calibration stays; it fails with ENOENT when nothing is running (§6.9); unknown commands return `STATUS_BAD_COMMAND`. A `STATUS_FAILURE` from a store, provisioning, or config-commit command leaves its reason in `aliensense.nxs.cmd_error` |
| Output descriptors | `aliensense.nxs.GetOutputInfo` (service 256) | output-field descriptors — the same data the I²C window serves (§6.6), with full-precision `float64` scale/offset and the field byte position (`byte_off`) |
| Param descriptors | `aliensense.nxs.GetParamInfo` (service 257) | per-parameter descriptor: name, unit, allowed-value set, default, current value |
| Driver info | `aliensense.nxs.GetDriverInfo` (service 258) | full driver snapshot the host `read_*` getters poll: name, `sample_size`, `store_count`, vm / runner state, error code, probe retries, … (`slot` 0xFF = active). With no active driver the snapshot still answers — empty name, zero descriptors, live store and runner state — so store contents stay readable on a device that has not loaded anything |
| Samples | `aliensense.nxs.RawSample.0.1` (subject 6144 default) | sample stream; each message carries `timestamp_us`, `seq`, and ≤ 128 bytes of `data` |
| Status | `aliensense.nxs.Status.0.1` (subject 6145 default) | 1 Hz telemetry push: vm / runner state, active slot, error counters, sample count, free slots |
| Diagnostics | `uavcan.diagnostic.Record` (subject 8184, fixed) | firmware log lines at or above the severity floor (default WARNING), forwarded at Low transfer priority — up to four records per second, so data-plane traffic always wins arbitration. The floor is runtime-tunable via `uavcan.diagnostic.severity` |

**Type evolution.** The vendor service types and `Status` are delimited with declared extents — 48 bytes for service requests, 128 for `Status` and the `GetDriverInfo` / `GetOutputInfo` responses, 256 for the `GetParamInfo` response — so a minor version bump may append fields within the extent: an older consumer reads the prefix it knows and ignores the rest, and a newer consumer zero-fills fields an older sender does not emit. Firmware and host tooling therefore tolerate version skew in both directions across an update wave. `RawSample` is sealed: its payload is opaque bytes decoded through the `GetOutputInfo` descriptors, so sample-schema evolution happens in the descriptor, not the DSDL type.

| Register | Access | Value |
|---|---|---|
| `uavcan.node.id` | read/write, persistent | `natural16`; the node-ID, commissioned to deconflict a CAN mesh. A CAN read reports the effective ID (the compiled default `125` when uncommissioned); a serial read reports the fixed point-to-point link address `125`. Applies at the next reboot (§8.2.7) |
| `uavcan.can.bitrate` | read/write, persistent | `natural32[2]`; the CAN bit-timing profile `[arbitration, data]` in bit/s. Equal rates select Classic CAN (MTU 8, no bit-rate switch); `data > arbitration` selects CAN FD (MTU 64). Reads the staged profile, or the compiled default `[1000000, 4000000]` when uncommissioned. A single-element write `[v]` means Classic `[v, v]`; `[0, 0]` reverts to the compiled default. Applies at the next reboot (§8.2.7) |
| `uavcan.pub.<name>.id` | read/write, persistent | `natural16`; subject-ID for one published topic. `<name>` ∈ {`sample`, `status`, `acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`, `gnss`, `scalar`}. Reads the effective subject-ID (the vendor-fixed default when uncommissioned); `0` disables the topic. Applies at the next reboot |
| `aliensense.nxs.decimation` | read/write, persistent | `natural16`; device-output gate — `0` = off, `1` = every sample (default), `N` = every Nth. Live on write; committed by Save |
| `aliensense.nxs.decimation.<subject>` | read/write, persistent | `natural16`; per-subject SI refinement on top of `decimation`. `<subject>` ∈ {`acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`}; `0`/`1` = every sample, `N` = every Nth. `temperature` defaults to 25, the rest to 1. Live on write; committed by Save |
| `aliensense.nxs.file_server_id` | read/write | `natural16`; node-ID the driver pull (`LOAD_FROM_FILE`) fetches from. 0 (default) = the commanding node. RAM-only |
| `aliensense.nxs.can_term` | read/write, persistent | `natural16`; the on-board CAN split-termination selection — `0` = off (the uncommissioned default), `1` = on, `0xFFFF` = revert to the default. Applies live (§8.2.7); reads mirror the effective state. The Cyphal face of the I²C `CAN_TERM` register (§4) |
| `aliensense.nxs.time_us` | read-only | `natural64`; the device µs clock at request service time — the two-way time-sync surface (§6.8) |
| `aliensense.nxs.time_sync` | read/write, volatile | `integer64`; write `[offset µs, bound µs, rate ppb]` to discipline the synced timescale as a host source, read `[offset, bound, rate, source]` (§6.8). Source decays to 0 when the discipline goes stale |
| `aliensense.nxs.cmd_error` | read-only | `natural16`; result of the most recent vendor / store / provisioning ExecuteCommand — `0` = OK, otherwise the positive errno behind a `STATUS_FAILURE` reply (`EEXIST` 17 = duplicate image already stored, `ENOSPC` 28 = store full, `EBUSY` 16 = a file pull is already in flight, …). The Cyphal mirror of the I²C `CMD_ERROR` register (§12); the ExecuteCommand response itself carries only the stock status code. A driver pull (`LOAD_FROM_FILE`) marks this register `CMD_ERR_PENDING` (255) at accept and resolves it to the load verdict — `0`, or `ENODATA` / `ENOEXEC` — when the pull completes, so the host polls this edge rather than trusting the pull's ExecuteCommand reply |
| `aliensense.nxs.io_err_count` | read-only | `natural16`; cumulative sensor-bus I/O errors since boot, including faults the device recovered and retried without sample loss. A steady rate is health telemetry worth monitoring even while the sample stream is unaffected. Saturates at 65535 |
| `aliensense.nxs.probe_failed_count` | read-only | `natural16`; cumulative probe give-ups since boot — failures the device could not recover in place. Saturates at 65535 |
| `uavcan.diagnostic.severity` | read/write | `natural16`; capture floor for the diagnostic stream on subject 8184 — `0` TRACE … `7` ALERT, default `4` (WARNING). Out-of-range writes clamp to `7`. RAM-only |
| `aliensense.nxs.param.<name>` | read/write | `natural32`; one register per loaded-driver parameter — write sets the value, read returns the current. `register.List` enumerates them after the static registers; the descriptor (unit, allowed set) comes from GetParamInfo. RAM-only |
| `aliensense.nxs.calibration.acceleration` / `.angular_velocity` / `.magnetic_field` | read/write, persistent | `real32[12]`; the bucket's affine — M row-major (elements 0–8) then b (9–11). A write stages; `calibration.commit` applies the staged record and Save persists it (§6.9) |
| `aliensense.nxs.calibration.encoder_zero` | read/write, persistent | `real32[1]`; radians added to the `angle` output, the sum wrapped into [0, 2π) |
| `aliensense.nxs.calibration.commit` | read/write, volatile | `natural8[1]`; writing a nonzero value validates the staged record and applies it to the running state in one step; writing `0` discards the staged edit (the stage re-seeds from the running record). The response carries the **result code**, not the written value — `Access` reads after the write regardless of its outcome, so a single round trip reports acceptance (`0`) or the errno. A commit refused `ECANCELED` discards the stage; other refusals keep it |
| `aliensense.nxs.calibration.dirty` | read-only, volatile | `natural8[1]`; `1` while the staged record differs from the running one |
| `aliensense.nxs.calibration.orientation` | read/write, persistent | `natural8[1]`; mounting-rotation code 0–23 (§6.9) |
| `aliensense.nxs.calibration.driver_tags` | read/write, persistent | `natural32[4]`; the three bucket guards then the encoder guard, 0 = unguarded (§6.9) |
| `aliensense.nxs.calibration.progress` | read-only | `natural8[3]`; `[state, detail, result]` — the on-device procedure surface (§6.9) |
| `aliensense.nxs.calibration.epoch` | read-only | `natural16`; the record's change counter — brackets a multi-register record read (§6.9), the same counter byte 168 of the I²C read-back serves |
| `aliensense.nxs.descriptor.epoch` | read-only, volatile | `natural16[1]`; the descriptor-set generation — 0 until the first driver load, then 1–255 wrapping past 0, bumped on every driver (re)load. The Cyphal twin of the I²C `DESCRIPTOR_EPOCH` register: a host caches descriptors (and the calibration binding it decodes with) against it and re-reads on change; the active-slot number cannot express a RAM-to-RAM driver swap |
| `aliensense.nxs.fw.describe` | read-only | `string`; the build identity (§6.10) — the firmware's `git describe`, identical to the I²C build-info record |
| `aliensense.axon.param.<name>` | read/write | `natural32`; one register per loaded-driver parameter — write sets the value, read returns the current. `register.List` enumerates them after the static registers; the descriptor (unit, allowed set) comes from GetParamInfo. RAM-only |

**Device identity (`GetInfo`).** The stock `uavcan.node.GetInfo` response carries the fields a host uses to identify and version-gate a node:

| Field | Type | Value |
|---|---|---|
| `name` | `string` | `com.aliensense.nxs` |
| `software_version` | `{major, minor}`, `uint8` each | the running firmware MAJOR.MINOR. The full build identity, patch level included, is the `aliensense.nxs.fw.describe` register (§6.10); pin bookkeeping below the wire's proof stays with the suite tool (Integration Manual §5.4) |
| `software_vcs_revision_id` | `uint64` | firmware git commit; two builds of one version are distinguishable, and a stock auto-updater treats an equal version with a differing revision as an update (Provisioning, above) |
| `hardware_version` | `{major, minor}`, `uint8` each | board hardware revision |
| `unique_id` | `uint8[16]` | STM32 UID96 in bytes 0–11, tail zero-padded — the board's immutable identity, used as the suite TOFU serial (Integration Manual §5.3) |

The host SDK exposes `read_fw_version()` (the build identity string, §6.10; `"MAJOR.MINOR"` on firmware predating it) and `read_serial()` (bytes 0–11 of `unique_id`). Both are read-only and always reflect the running firmware, on every transport: over Cyphal via the `aliensense.nxs.fw.describe` register with `GetInfo` as the fallback, over I²C via the build-info transfer with the `FW_VERSION_MAJOR`/`FW_VERSION_MINOR` registers as the fallback (§3).

#### 8.2.7 Register persistence and the Save model

Config follows a running/startup model. A write takes effect in the running state — `decimation` and its per-subject factors apply to the next sample, a `calibration.*` write applies to the running record (§6.9); `node.id` and `pub.<name>.id` are reboot-applied, so a write stages without changing the running stream — and persists nothing until an explicit Save. `ExecuteCommand COMMAND_STORE_PERSISTENT_STATES` (65530) validates the staged record and commits it to NVS in one step. Out-of-range identity values are already rejected at the register write (the table below), so over this transport a Save fails (`STATUS_FAILURE`, nothing written) only on the commit's own validation or a flash-write error; a shared subject-ID is legal and never rejected (§8.2.8). A device that is configured but not Saved reverts on reboot.

The persistent registers report `persistent = true`: `node.id`, `can.bitrate`, `can_term`, every `pub.<name>.id`, `decimation`, each `decimation.<subject>`, and the calibration record registers (§6.9). `file_server_id`, `uavcan.diagnostic.severity`, and `param.<name>` are RAM-only (`persistent = false`) and revert to compiled defaults on reset.

Every config register reports `mutable = true` (`calibration.progress`, a status surface, is read-only); a write is range-checked per register (`natural16`-typed, except the `natural32[2]` bit-timing pair and the `real32` calibration registers):

| Register | Write effect |
|---|---|
| `uavcan.node.id` | Staged when `0`–`125` (static; 126/127 are reserved for diagnostic and host tooling), `255` (the anonymous sentinel — the node boots silent on CAN, reachable over serial/I²C), or `0xFFFF` (revert to the compiled default). An out-of-range value is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `uavcan.can.bitrate` | Staged when the pair is a supported profile: FD `[1M, 4M]`, `[1M, 2M]`; Classic `[1M, 1M]`, `[500k, 500k]`, `[250k, 250k]`, `[125k, 125k]`; or `[0, 0]` (revert to the compiled default). A single-element write `[v]` means Classic `[v, v]`. Anything else — including `data < arbitration` — is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `uavcan.pub.<name>.id` | Staged when `0`–`8191` (`0` disables the topic; `scalar` base capped at `8181` so its 11-subject block stays in range) or `0xFFFF` (revert to the compiled default). An out-of-range value is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `aliensense.nxs.decimation` | Stored verbatim, applied live; no clamp |
| `aliensense.nxs.decimation.<subject>` | Stored verbatim, applied live; no clamp |
| `aliensense.nxs.can_term` | Staged when `0`, `1`, or `0xFFFF` (revert to the default, off) and applied live to the termination pin; anything else is rejected: the response echoes the unchanged effective state |
| `aliensense.nxs.file_server_id` | Stored when `0`–`127`; a value `> 127` is dropped |
| `aliensense.nxs.param.<name>` | Forwarded to the driver; see acceptance note below |
| `aliensense.nxs.calibration.<name>` | Applied to the running calibration record when the value's type, element count, and contents fit the register; otherwise ignored — the response echoes the unchanged value, the same contract as `uavcan.node.id`. Committed by Save |

A `node.id` / `pub.<name>.id` read reports the **staged** value — the configured value, or the resolved default when uncommissioned — never a bare "unconfigured" sentinel. Identity is reboot-applied, so between a write and the reboot the read echoes the staged value while the running node keeps publishing at its boot-resolved addresses; after the reboot the two coincide. This staged echo is the write acknowledgement: a rejected write reads back unchanged.

**Node-ID is per-link.** Cyphal/serial is a point-to-point cable — no bus, nothing to deconflict — so it is a fixed management link: its node-ID is always the compiled default (`125`), and a `node.id` read over serial reports that link address regardless of any commissioned value. A `node.id` write (over any transport) stages the identity the **CAN** node adopts at the next reboot; a `node.id` read over CAN reports that staged/effective value. The split is a console port (always reachable at a known address) versus a network interface (the configured, deployment-specific address): the serial link stays reachable at `125` even when the CAN identity is unknown or misconfigured. Subject-IDs are not per-link — a subject is the same on both transports.

**`can_term` drives the on-board split termination, live.** Unlike the reboot-applied identity, a termination write reaches the pin within one second — a bench toggle needs no reboot — while persisting nothing until Save: a change that degrades the bus reverts at the next power cycle unless deliberately committed. The uncommissioned default is off; a module joins an already-terminated bus without loading it, and only the modules at the two physical bus ends are commissioned on. v1.0 hardware has no termination pin — the selection persists but drives nothing.

**`can.bitrate` selects the CAN link timing.** The pair applies to the CAN controller at boot, before the node starts: an FD profile transmits FD frames with bit-rate switch at MTU 64, a Classic profile transmits plain data frames at MTU 8. Sample points are fixed at 0.875 (arbitration) / 0.750 (data) on every profile. The register is served on both Cyphal transports, and the serial link — whose timing never changes — is the recovery path for a CAN link commissioned onto a profile the attached bus does not speak. A Save on any transport commits the staged record, so a profile staged over Cyphal persists on an I²C `STORE_PERSIST` too. The host interface must drive the module's *active* profile: a host still configured for the previous timing loses the link at the reboot that applies the new one.

**`decimation` gates the whole sample stream.** A `natural16` value `N` is stored as-is: `0` disables publication, `1` (the default) publishes every sample, `N` publishes every Nth. No clamp is applied. The gate covers both `RawSample` and every standard SI projection (the IMU `si.sample.*` and GNSS subjects fan out behind it). A freshly booted node streams at its persisted `decimation` — `1` out of the box — so no host write is needed to start the stream.

**`decimation.<subject>` refines one SI subject.** After a sample clears the device-wide gate, each SI subject is thinned again by its own factor: `0` or `1` publishes every sample that passed the gate, `N` every Nth. `temperature` ships thinned to 25 (≈ 10 Hz at a 250 Hz acquisition rate) so a slow channel does not crowd the bus; the motion subjects stream every sample. The per-subject factors do not gate `RawSample`, which always carries the full sample.

**`file_server_id` write range.** Valid values are `0`–`127` (the Cyphal node-ID range). A write with a value above `127` is discarded without effect; the Access response carries the unchanged current value, so a host detects the rejection by comparing the returned value against the value it sent.

**`param.<name>` acceptance is read-back, not response-coded.** A `natural32` value in the write request is forwarded to the driver and the validation result is discarded, so the Access response is identical whether the value was accepted or rejected: it always carries the parameter's live `current_value`. An out-of-set value is not signalled in the Access response on this transport. A host confirms acceptance by reading the parameter back — through a subsequent `register.Access` read, or through `GetParamInfo`, whose `current_value` field reflects the applied value. This differs from the I²C register-map path, where a rejected parameter write sets `ERROR_CODE` (§12) and leaves the staged bytecode unchanged.

#### 8.2.8 Standard SI projection

Alongside the proprietary `aliensense.nxs.RawSample.0.1` stream (subject 6144 default, §8.2), every sample is also projected onto stock `uavcan.si.sample.*` and `reg.udral` subjects. A consumer reads acceleration, angular velocity, temperature, pressure, and a geodetic point-state in physical SI units with stock Cyphal tooling, without the descriptor list the RawSample stream requires.

The firmware walks the active driver's output descriptors, decodes each numeric field to its SI physical value (`raw * effective_scale + offset`), applies the per-unit calibration (§6.9), and routes it by semantic code (§6.6) into the matching standard subject. The *effective* scale is the descriptor's base `scale`, multiplied by the live `current_value` of a linked parameter when the field declares one (§6.6, `scale_param_index`) — so a runtime full-scale-range change (e.g. an IMU `accel_fs` write) tracks on the wire with no image re-upload. The scalar and vector subjects narrow to their wire type (`float32`); the geodetic position is carried as `float64`.

| Source semantic(s) | Subject-ID (default) | Cyphal DSDL type | Notes / slots |
|---|---|---|---|
| `accel_x` / `accel_y` / `accel_z` (1–3) | 6146 | `uavcan.si.sample.acceleration.Vector3.1.0` | `float32[3] meter_per_second_per_second`; X→[0], Y→[1], Z→[2] |
| `gyro_x` / `gyro_y` / `gyro_z` (4–6) | 6147 | `uavcan.si.sample.angular_velocity.Vector3.1.0` | `float32[3] radian_per_second`; X→[0], Y→[1], Z→[2] |
| `mag_x` / `mag_y` / `mag_z` (7–9) | 6151 | `uavcan.si.sample.magnetic_field_strength.Vector3.1.0` | `float32[3] tesla`; X→[0], Y→[1], Z→[2] |
| `temperature` (10) | 6148 | `uavcan.si.sample.temperature.Scalar.1.0` | `float32 kelvin`; kelvin at the source, published unchanged |
| `pressure` (11) | 6149 | `uavcan.si.sample.pressure.Scalar.1.0` | `float32 pascal` |
| scalar block `angle` (23) … `flow` (33) | `base + k`, base 6152 | `uavcan.si.sample.<quantity>.Scalar.1.0` | one `float32` per quantity; see the scalar-block rule below |
| `latitude` / `longitude` / `altitude` (14–16), `vel_north` / `vel_east` / `vel_down` (17–19), `pos_h_acc` / `pos_v_acc` / `vel_s_acc` (20–22) | 6150 | `reg.udral.physics.kinematics.geodetic.PointStateVarTs.0.1` | Assembled from the structured-GNSS group into one position + velocity + covariance message; see GNSS rule below |

These are the **default** subject-IDs (vendor-fixed band); each is a `uavcan.pub.<name>.id` register a host commissions (§8.2.7). Sharing a subject-ID across nodes is legal and intended: a subscriber receives every publisher on a subject, disambiguated by source node-ID, so identical boards aggregate on the shared SI subjects with no per-board remap — only the node-ID need be distinct.

**Scalar SI block.** The single-value SI quantities form a contiguous semantic range, `angle` (23) through `flow` (33): angle, voltage, electric current, length (distance), force, frequency, luminance, mass, torque, velocity (speed), and volumetric flow rate. Quantity *k* (its semantic code minus 23) publishes on `scalar_base + k`, so the block occupies `scalar_base` through `scalar_base + 10`. Every `uavcan.si.sample.<quantity>.Scalar.1.0` shares one sealed 11-byte wire layout — a 7-byte `SynchronizedTimestamp` then a `float32` — so a single serializer covers the whole block. The compiled default base is 6152 (block 6152–6162); commissioning caps the base at `8181`, keeping the whole block inside the 13-bit subject-ID space; `0` disables the block; keep the span clear of the other subject-IDs.

**Canonical SI units.** Every field with a known SI semantic carries its semantic's canonical unit — `m/s^2`, `rad/s`, `tesla`, `kelvin`, `pascal`, and the scalar-block units — declared once in the constants registry (`constants/field_semantics.yaml`) and enforced at driver compile time: a driver inherits the unit by omitting it, and declaring a conflicting unit is a compile error. Temperature is kelvin at the source, so the raw stream, the descriptor `unit` string, and the `temperature.Scalar` subject carry one identical physical value in three framings; the mapper performs no unit conversion. Non-SI fields (humidity `%RH`, NMEA) declare their unit explicitly and have no standard subject.

**Geodetic (GNSS).** `PointStateVarTs` is published only when the sample carries the complete position triple — `latitude`, `longitude`, and `altitude` all present. A sample missing any of the three is suppressed entirely (rather than transmitting zeros that a consumer would read as a real position). Fix quality is not gated on-device: it rides in the covariance and in the driver's generic quality fields (fix type, satellite count). When published:

- Position latitude and longitude are radians as `float64`; altitude is metres as `float64` (`uavcan.si.unit.length.WideScalar.1.0 meter`), referenced to **mean sea level (MSL)** per the DSDL's altitude definition ("distance between the local mean sea level (MSL) and the focal point of the antenna"). A receiver's ellipsoidal (WGS84) height is not published on this subject; drivers expose it as the generic field `alt_ellipsoid` in the RawSample stream.
- Velocity is NED metres per second (`float32[3] meter_per_second`): `vel_north` → [0], `vel_east` → [1], `vel_down` → [2]. Components default to 0 when not supplied.
- Covariance is carried on the upper-right-triangle diagonal of each 3×3 matrix (`float16[6]`, elements [0], [3], [5]). Position covariance (m²) takes `pos_h_acc²` for the latitude and longitude diagonal entries and `pos_v_acc²` for the altitude entry. Velocity covariance ((m/s)²) takes `vel_s_acc²` on all three diagonal entries.
- A missing accuracy field — or, for velocity covariance, a fix with no velocity component supplied — yields the sentinel variance `1.0e6` rather than 0. A zero covariance reads as perfect certainty; the sentinel marks the axis as effectively unknown.

**Enable / disable.** Each subject is emitted only when both a routed field is present in the sample and its subject-ID is non-zero; an ID of `0` disables that projection. Each subject-ID is the writable, persistent `uavcan.pub.<name>.id` register (§8.2.7), defaulting to the vendor-fixed band (accel 6146, gyro 6147, magnetic field 6151, temperature 6148, pressure 6149, GNSS 6150, scalar block base 6152) and host-commissionable; `register.List` enumerates them. The compiled defaults live in the constants registry (`constants/cyphal.yaml`).

**Timestamp.** Every projected subject carries the sample's acquisition instant in its `timestamp.microsecond` field (microseconds since boot) — the delivered DRDY edge (or declared frame bound) behind the sample's measure pass, or the commit instant for event-less pacing, never the publish moment. Although the field type is a network-synchronized timestamp, the value is the local acquisition time, not a Cyphal-network-synchronized clock; consumers that need network time must not treat it as such. A host can translate these stamps into its own time domain with a bounded error via the two-way sync surface (§6.8).

**Unmapped semantics.** Humidity (12) and NMEA (13) carry descriptors (§6.6) but emit no standard subject: there is no stock humidity scalar, and NMEA is delivered only as raw bytes in the RawSample stream. The geodetic projection (6150) is populated when a loaded GNSS driver emits the structured geodetic fields (codes 14–22) — its binary output mode; the same driver in NMEA mode emits a single string field, leaving the subject silent.

**Provisioning.** `COMMAND_BEGIN_SOFTWARE_UPDATE` (stock) and vendor `LOAD_FROM_FILE` (0xA000) each carry a file path in `parameter`, and the node fetches it with `uavcan.file.Read` (offset-addressed, 256-byte chunks, EOF on a short read). Firmware update reads from the commanding node — the standard contract, so `yakut file-server --update-software` and Yukon (the OpenCyphal GUI) drive it unchanged — writing to the DFU slot, then rebooting into the swap. The auto-updater gates on `GetInfo`: it pulls a package whose name matches and whose `software_version` is higher, or equal with a differing `software_vcs_revision_id` (the firmware git revision), and skips an exact match; `nxs push-fw` commands the pull unconditionally. The driver load reads from the `aliensense.nxs.file_server_id` register (or the commanding node when it is unset), writing the NXS to staging, where it loads without running; the load verdict resolves in `aliensense.nxs.cmd_error` (`CMD_ERR_PENDING` until the pull completes, then `0` or the parse errno), and `RUN` / `STOP` (0xA001 / 0xA002) then control the loaded driver. One pull runs at a time; a trigger arriving mid-pull is rejected with `STATUS_FAILURE` and `EBUSY` in `aliensense.nxs.cmd_error`. The `STATUS_SUCCESS` reply confirms the pull is armed, not that staging is prepared: the staging erase runs when the first chunk arrives, and a fault after the reply — an unreachable server, a flash error — resolves the verdict in `aliensense.nxs.cmd_error` and returns the node to `OPERATIONAL` mode without a reboot instead of failing the command.

`RawSample.data` is opaque bytes; `GetOutputInfo` supplies the per-field name, type, byte order, scale, offset, unit, and semantic needed to decode it without a driver definition on the host. The same node and services are served on Cyphal/CAN-FD when that media is built. The bring-up procedure — yakut configuration, register and subject access — is `docs/zephyr/axon/cyphal-bringup.md`.

## 9. nxs command-line tool

Host tool for every transport, shipped as one Python wheel. Requires Python ≥ 3.10.

```
python3 -m pip install nxs-1.0.0-py3-none-any.whl
```

The wheel is built from the product source tree with `python3 -m build --wheel` in `sdk/`. Installing from the source tree directly (`pip install .`) requires setuptools ≥ 61 in the build environment; on hosts with older stock toolchains (Ubuntu 22.04 and derivatives) the build silently produces an empty `UNKNOWN-0.0.0` package — use the wheel.

Global options: `-t {i2c,cyphal-serial,cyphal-can}` (default `$NXS_TRANSPORT`, else I²C on Linux / Cyphal/serial on macOS, Windows), `-b BUS` (default `$NXS_BUS` or `/dev/i2c-2`), `-a ADDR` (default `0x30`), `-p PORT` (`$NXS_PORT`; serial device, auto-detected when omitted), `--baud` (default 460800), `--mtu {8,64}` (Cyphal/CAN frame MTU; default `$NXS_CAN_MTU` or 64 — pass 8 on a bus running a Classic profile), `--remote-node-id N` (Cyphal target node-ID; default 125, the plug-and-play factory address), `--version`.

| Command | Action |
|---|---|
| `probe` | Presence check (`WHO_AM_I`); over I²C also reports the register-map version and warns when it is newer than the tool supports |
| `status` | Device identity (`SERIAL`), VM, runner, and store status, plus the fault counters (§12) on transports that serve them |
| `upload <driver\|file> [--param K=V …] [-o FILE]` | Compile `drivers/<driver>.py` — or a local driver `.py` given by path — and upload it; a path to a compiled `.nxs` uploads verbatim; `-o` writes the compiled image to that file instead of a device (offline producer for fleet file-servers) |
| `run` / `stop` / `reset` | VM lifecycle |
| `caps` | List driver parameters |
| `outputs` | List per-sample output fields |
| `get <param>` / `set <param> <value>` | Parameter access |
| `stream [--raw]` | Print decoded (or raw) samples |
| `bench` | Wire-throughput benchmark |
| `decimation [N] [--subject NAME [N]]` | Device-output decimation — the device-wide factor, or a per-subject SI factor (§8.2.8); read with no value. Live; committed on Save |
| `can-bitrate [NOMINAL [DATA]]` | CAN bit-timing profile (§8.2.7): read with no value; one rate selects Classic CAN, two select FD, `0` reverts to the default. Staged; persist with `commission --save`, applies at the next reboot |
| `can-term [on\|off\|default]` | On-board CAN split termination (§8.2.7): read with no value. Applies live; persist with `commission --save` |
| `set-orientation [ROTATION] [--no-persist]` | Declare the module's mounting orientation — one of the 24 rotation codes (§6.9); with no argument, print the current orientation |
| `calibrate gyro\|mag [--no-persist]` | Trigger the on-device solves (§6.9) with a progress readout; `mag` auto-stops at sufficient coverage |
| `calibrate accel [--no-persist]` | Six-pose accelerometer wizard: poses auto-capture on stillness, the affine solves host-side and uploads via the record write (§6.9) |
| `calibrate encoder-zero [--no-persist]` | Declare the current angle as mechanical zero (circular mean of 50 samples) |
| `calibrate show [--full]` | Orientation, per-bucket solved/identity state with the guard verdict, encoder zero; `--full` prints M and b |
| `calibrate reset [accel\|gyro\|mag\|encoder\|all]` | Write the identity calibration (orientation kept) and persist |
| `commission [--node-id N] [--subject NAME=ID …] [--can-bitrate NOM[/DATA]] [--can-term on\|off\|default] [--save] [--show]` | Commission the Cyphal node-ID / subject-IDs / CAN link (§6.7, §8.2.7). `--show` reads the current identity; `--node-id` / `--subject` / `--can-bitrate` stage and commit (reboot to apply); `--can-term` applies live and commits; `--save` alone commits staged running config (e.g. decimation) to NVS |
| `env` | Print shell `export`s (`CYPHAL_PATH`, node-ID) for stock yakut / yukon, plus tab-completion registration for bash and zsh |
| `store ls` | List store slots |
| `store save <slot>` | Persist the uploaded driver |
| `store rm <slot>` / `store clear` | Delete one slot / all slots |
| `store cycle` | Advance to the next populated slot |
| `push-fw <image>` | Firmware update (§7.2, §7.3) |
| `confirm-fw` | Explicit image confirm (serial; supervised builds only) |
| `recover` | Enter bootloader serial recovery (serial only) |

The `set-orientation` and `calibrate` verbs persist their result by default; `--no-persist` leaves it in the running state (§8.2.7), reverting at power-cycle.

```
nxs probe
nxs upload iam20680 --param sample_rate=250
nxs upload iam20680 -o iam20680.nxs
nxs store save 0
nxs stream
nxs commission --show
nxs commission --node-id 10
nxs push-fw zephyr.signed.bin
```

### 9.1 Programmatic surface (NxsClient)

The same operations are available as a transport-independent Python SDK, `nxs.client.NxsClient`, which the CLI and the suite tooling are themselves built on. Code written against it runs unchanged across transports — the wire is a constructor argument:

```python
from nxs import open_client
c = open_client("i2c", bus="/dev/i2c-2", address=0x30)   # or "cyphal-serial", "cyphal-can"
c.upload_image(image); c.vm_run(); c.set_param("sample_rate", 250)
for sample in c.iter_samples():       # decoded from device descriptors
    handle(sample.values)
```

`NxsClient` is a synchronous contract (`abc.ABC`); transport-specific operations — bootloader recovery, slot peek, commissioning, CAN bit timing, CAN termination — are typed capability interfaces (`SupportsRecovery`, `SupportsSlotPeek`, `SupportsCommissioning`, `SupportsBitTiming`, `SupportsCanTermination`) queried with `isinstance`. Streaming yields decoded `Sample`s and re-syncs decoding to `DESCRIPTOR_EPOCH` (§6.6). Full reference: `docs/zephyr/axon/host-sdk.md`.

## 10. Driver authoring

A driver is a Python class — datasheet as code. Class attributes name the bus addresses and identity check (`I2C_ADDRS`, `WHO_AM_I_REG`, `WHO_AM_I_VALUES`) and per-bus communication profiles (§10.2); methods define `probe()`, `configure()`, and a measure loop; declared parameters and output fields become the capability descriptors of §6.4/§6.6. The compiler traces the class into VM bytecode and packs it with the descriptors into an NXS image (bytecode ≤ 4096 bytes). Each output field's semantic category (§6.6) is inferred from its field name at compile time; drivers do not declare it.

Drivers are generated from a sensor datasheet by the `nxs-generate-sensor-driver` skill in the product source tree (`skills/`), then compiled and uploaded with `nxs upload`. The authoring reference is `docs/zephyr/axon/driver-authors-guide.md`.

### 10.1 Image format version

The NXS image begins with a 9-byte header: a 4-byte magic (`NXS\0` — the ASCII bytes `N` `X` `S` then a NUL pad, `4E 58 53 00`), a 1-byte **major**, a 1-byte **minor**, then the driver-name length and the parameter/output counts. This version is distinct from `PROTO_VERSION` (§2): `PROTO_VERSION` is the register-map contract, while the NXS major/minor is the image format the firmware executes.

LOAD runs an image only when both hold:

- **major == the firmware's NXS major.** A differing major means the wire layout or an opcode's semantics changed; the image is rejected.
- **the image's required minor ≤ the firmware's NXS minor.** The compiler stamps the required minor as the highest minor of any opcode the image emits. Every opcode in the 1.0 release is minor 0, so every image the tool produces requires minor 0; the gate is armed but dormant until a later release introduces a higher-minor opcode.

The contract is one-directional: new firmware runs old images, and old firmware cleanly refuses an image that needs an opcode it lacks rather than mis-executing it. A new opcode bumps the minor; an incompatible-format change bumps the major. The current image format is **major 1, minor 0**. The header carries this format version, not the product version: any image-format movement accompanies a product-MINOR firmware release, and the `nxs` tool refuses a stale compiled image with its rebuild command.

During pre-release the format is frozen at **major 1**: incompatible layout and opcode changes (the per-bus communication-profile trailer, the 16-bit register-address operand) ride under it and every image is recompiled from source, since no fielded firmware carries the older encoding to protect. The major-bump rule above governs from the first product release onward, when the wire format is locked.

### 10.2 Communication profiles

A register driver declares one communication profile per bus it supports — the wire framing (address byte count, R/W bit polarity, dummy bytes, auto-increment scheme), clock ceiling, and SPI mode. The compiler bakes every declared profile into the image as a trailer; at load the firmware applies the profile matching the active `bus` parameter (§6.4) to the peripheral before `probe()` runs, so a part whose SPI protocol deviates from the conventional bus (a 2-byte address phase, or the R/W bit cleared rather than set for a read) is reached without any per-part firmware code.

Because every supported bus's profile is present in the image, switching a dual-bus part between I²C and SPI is a `bus` write plus a reload — not a new image. A driver that declares no deviating profile runs the conventional register bus: a single address byte, the R/W bit in bit 7 set for a read, and implicit auto-increment. The register opcode operand is 16-bit, but the device frames 8-bit addresses; register addresses wider than 8 bits are not yet supported.

## 11. Limits

| Quantity | Value |
|---|---|
| Register-map contract version | 1 |
| NXS image format version (major.minor) | 1.0 |
| I²C target address | `0x30` |
| I²C write window / chunk | 32 bytes |
| Serial DFU chunk | 192 bytes |
| Sample record window | 128 bytes (18-byte header + ≤ 110 data bytes, §6.3) |
| Driver bytecode | ≤ 4096 bytes |
| Serialized driver image (header + descriptors + bytecode) | ≤ 6144 bytes |
| Driver / parameter / output-field name | 16 bytes |
| Unit string (parameter or output) | 8 bytes |
| Parameter value set | 16 values |
| Patch sites per parameter | 2 |
| Output fields per driver | 16 |
| Communication profiles per image | 3 |
| Store slots | 8 |
| Command queue depth (I²C) | 8 |
| DFU staging erase stall | ~2.5 s |
| Transfer-session stale window | 2 s of holder silence (2 × the 1 s DFU ack timeout) |
| Watchdog timeout | 3 s |
| Self-confirm window | ~1 s of healthy execution |

### Cyphal node

Limits of the Cyphal stack, fixed at firmware build time.

| Parameter | Value |
|---|---|
| Allocation arena | 8192 bytes |
| Allocator exhaustion | the transfer is dropped and the out-of-memory diagnostic counter increments |
| CAN RX queue depth | 16 frames |
| TX queue capacity | 16 frames (FD profiles) / 64 frames (Classic profiles — the same responses span ~8× more frames) |
| Subscriptions | 8 |
| TX transfer deadline | 1 s |
| File-pull read timeout | 500 ms |
| File-pull retries | 5 |
| Cyphal/serial single-frame payload | 512 bytes (buffer size, not a wire ceiling) |
| Node-ID (compiled default) | 125; a commissioned node-ID persists on the device and overrides it |
| CAN MTU | 64 bytes (FD profiles) / 8 bytes (Classic profiles) |
| CAN bit-timing profiles | FD 1M/4M (default), 1M/2M; Classic 1M, 500k, 250k, 125k; sample points fixed 0.875 / 0.750 |

## 12. Error reporting

`ERROR_CODE` (`0x03`) reports the VM error state, synced from `vm_status`: 0 when healthy, otherwise the positive errno of the most recent VM fault (5 = I/O error, 22 = invalid argument, …). `STATUS` bit 1 mirrors it; `VM_STATE` = 2 with `ERROR_CODE` gives the detail.

`CMD_ERROR` (`0x1D`) reports host command results — including the calibration commands (§6.9) — with the same encoding, and reads `CMD_ERR_PENDING` (`0xFF`) from enqueue until an async op resolves (§5). The two registers have disjoint writers: a `vm_status` update can never overwrite a command result, and a command can never mask a VM error. A completing calibration procedure latches its verdict here too, but only while it holds the transfer session — which the store and DFU commands refuse to run alongside (`EBUSY`), so a procedure and a command result cannot collide. A host issuing a command inside the boot-automatic gyro window (§6.9) therefore reads `EBUSY` and retries rather than reading someone else's answer. Beyond each backend's own errnos (flash, store, validation), the transfer protocol reports:

| Errno | Value | Meaning |
|---|---|---|
| `EBUSY` | 16 | a transfer session is live — another upload or firmware push owns the mux |
| `EPROTO` | 71 | wrong `XFER_TYPE` for the op, a zero-size announce, or a config stage trampled by an interleaved write |
| `EFBIG` | 27 | the announced size exceeds the staging buffer |
| `ENODATA` | 61 | `LOAD` on a stage short of the announce — bytes were lost in transit |
| `ENOEXEC` | 8 | `LOAD` on bytes that are not a valid driver image |
| `ENOENT` | 2 | `XFER_ABORT` with no session to release |
| `EAGAIN` | 11 | the command was dropped at a full device queue before dispatch — retry |

### 12.1 Fault counters

Five counters record faults the device absorbs without failing a command. Each saturates at 65535 — they are should-be-zero counters, so a saturated value stays sticky evidence instead of wrapping back to a healthy-looking number — and a host reads deltas across its observation window. On I²C they are paged through the diag view: write `DRIVER_SELECT = 3`, write the index to `SEL_VALUE_INDEX`, await each selector's echo, read the u32 at `SEL_VALUE`. The served value is a snapshot taken at the selector write — it never repaints under the reader, so the value whose echo was awaited cannot tear; re-write the index to refresh.

| Index | Counter | Counts | Cyphal register |
|---|---|---|---|
| 0 | `DRDY_COALESCED` | sample intervals missed because the VM was still busy when the sensor signalled data-ready. Counts from the driver load, and only once the driver has begun waiting — an idle data-ready line registers nothing (refreshes at the ~100 ms status cadence) | `aliensense.nxs.drdy_coalesced_count` |
| 1 | `INGRESS_REJECTS` | host commands rejected by the transport arbiter (§7.5), counted at reject time | `aliensense.nxs.ingress_reject_count` |
| 2 | `I2C_CMD_QUEUE_OVERFLOWS` | host writes dropped at a full I²C command queue (§3) | — |
| 3 | `VM_IO_ERRORS` | measure-loop I/O errors the VM absorbed (~100 ms cadence) | `aliensense.nxs.io_err_count` |
| 4 | `PROBE_FAILURES` | probe give-ups (~100 ms cadence) | `aliensense.nxs.probe_failed_count` |

`nxs status` prints all of them (§9).

Serial acknowledgements carry the same codes as signed 16-bit results (0 = success, negative = error).

