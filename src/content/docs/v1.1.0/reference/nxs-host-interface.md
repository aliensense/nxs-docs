---
title: NXS host interface specification
sidebar:
  order: 5
slug: v1.1.0/reference/nxs-host-interface
---

Applies to: NXS v1.1 · register-map contract 1 (`PROTO_VERSION` = 1) · image format 2.3 (§10.1). The tool names the firmware it requires (§2)

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, shipped personalities, versioning |
| **Interface Description** (this document) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Click Personality Reference](../nxs-click-personalities/) | authoring personalities for unsupported sensors |
| [Cam Personality Reference](../nxs-cam-personalities/) | describing camera chains for `nxs cam` |
| [MCP Tool Reference](../nxs-mcp/) | operating and configuring through an AI agent |
| [FAQ](https://aliensense.github.io/nxs-docs/hardware/faq/) | frequently asked questions |
| [Glossary](../nxs-glossary/) | one word for each thing |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

This document is the contract between an NXS device and any host that drives it. It specifies the two host-facing transports, the I²C register map, the command set, the firmware-update procedures, and the personality lifecycle. It ships with the product, and firmware and host tools conform to it.

***

## 1. Device model

NXS is a sensor co-processor. It runs click personalities as bytecode in an on-device virtual machine. A personality is compiled on the host and uploaded as an NXS image (bytecode and capability descriptors). The VM executes it: it probes the sensor, configures it, and produces fixed-size samples. The host reads samples, sets parameters, manages a persistent personality store, and updates the firmware. It does so over either transport, with identical semantics.

| Interface | Role | Parameters |
|---|---|---|
| I²C | I²C target, register map | 7-bit address `0x30`, Standard-mode and Fast-mode (≤ 400 kHz), the clock driven by the master |
| UART | Cyphal/serial host link | 460800 baud, 8N1, no flow control (§8) |

Both transports converge on the same internals. Anything written below for one transport about device behaviour (states, store, DFU model) holds for the other.

### 1.1 Capability matrix

The management surface is transport-symmetric: every configure, observe, and provision operation works over any single link. Swapping the transport is therefore invisible above the SDK's transport layer. The table is normative. Each row names the mechanism per transport, and the exceptions below it are the complete list of wire-inherent differences.

| Surface | I²C | Cyphal (serial / CAN-FD) |
|---|---|---|
| Presence and identity (probe, serial, firmware version) | `WHO_AM_I`, `SERIAL`, `FW_VERSION_*` registers | `GetInfo` |
| Personality upload / run / stop / store | `PROGRAM_*` window + `CMD` | file pull + `ExecuteCommand` |
| Stored-slot peek | `Cmd::PEEK_SLOT` + SEL peek view | `GetDriverInfo(slot)` |
| Parameters (descriptors, get, set) | SEL param view + `PARAM_*` | `GetParamInfo` + `register.Access` |
| Output descriptors | SEL output view | `GetOutputInfo` |
| Device-wide decimation | `DECIMATION` register | `aliensense.nxs.decimation` |
| Per-subject decimation knobs | `DECIMATION_SELECT`/`DECIMATION_VALUE` | `aliensense.nxs.decimation.<subject>` |
| Commissioning (node-ID, subject-IDs) | config record + `Cmd::STORE_PERSIST` | `uavcan.*.id` registers + Save |
| CAN bit timing | config record + `Cmd::STORE_PERSIST` | `uavcan.can.bitrate` + Save |
| CAN termination | `CAN_TERM` register | `aliensense.nxs.can_term` |
| Sample FIFO depth | SEL device-parameter view (§6.3) | `aliensense.nxs.sample_fifo.depth` |
| Time discipline (push and state) | time-sync record via `PROGRAM_DATA` (§6.8) | `aliensense.nxs.time_sync` |
| Firmware update | register-map DFU (§7) | file pull (§7) |
| Recovery trigger | `Cmd::ENTER_RECOVERY` | `ExecuteCommand ENTER_RECOVERY` |
| Identify (LED strobe) | `Cmd::IDENTIFY` | `ExecuteCommand IDENTIFY` |
| Samples | drain the sample FIFO through the `SAMPLE_DATA` window, or poll its latest-sample record (§6.3) | subscribe to the sample and SI subjects |
| Diagnostics (log stream) | — | subscribe to `uavcan.diagnostic.Record` (8184) |

The wire-inherent exceptions, the complete list. SI pub/sub delivery exists only on Cyphal: I²C polls, and the per-subject knobs configure the Cyphal egress from any link. The diagnostic log stream is likewise Cyphal-only, since an asynchronous push has no I²C equivalent. A rejected parameter write is silent on I²C, where the host confirms by reading the parameter window back. Cyphal's `register.Access` echoes the accepted value. On a VM fault, Cyphal's `Status.last_error_code` falls back to a sticky error kind when the VM byte is 0, and I²C has no counterpart (§12).

A `uavcan.node.id` read is per-link (§8.2.8). The DFU mechanism and speed differ: the host paces 32-byte chunks on I²C, and the device pulls the image on Cyphal. I²C descriptor scale/offset are f32, while Cyphal serves f64. Recovery can be triggered from either transport. MCUboot itself speaks only mcumgr over the host UART, so completing a recovery upload always needs that UART. An I²C-only integration can put a unit into recovery and cannot get it out again.

## 2. Interface version

Register `PROTO_VERSION` (`0x19`, read-only) identifies the register-map contract. This document describes version `1`. The version counts contract revisions. A change that gives an existing register a new meaning increments it. Growth in reserved space (a new command, a new `XFER_TYPE` mode, a new live register) does not, and rides a PATCH release.

Independently of the contract, the `nxs` tool names the firmware it requires. Every verb but `probe`, `push-fw`, and `recover` refuses a device whose build identity (§6.10) is older than that firmware, and prints the update command. A host therefore never drives a device with verbs it lacks.

***

## 3. I²C transport

### 3.1 Transactions

* **Write**: `[register address] [data …]` in one transaction. Up to 32 data bytes, the SMBus block-write limit, and all multi-byte windows are sized accordingly.
* **Read**: write `[register address]`, then read N bytes. The address pointer auto-increments on each byte read, so a block read returns a contiguous register range.

### 3.2 Write semantics

Control writes (`CMD`, the selectors `PARAM_SELECT` / `OUTPUT_SELECT` / `DRIVER_SELECT` / `SEL_VALUE_INDEX`, `PARAM_SET_VALUE`, `PROGRAM_SIZE`, `PROGRAM_DATA`, `XFER_TYPE`, `DECIMATION`) are queued on the device and applied after the transaction. A transaction ACK means *accepted*, not *applied*. Completion is observed through the status register named by each procedure in §6 (for example `XFER_ACK` for DFU chunks, `RUNNER_STATE` for personality loads).

The queue is 8 entries deep. A host that paces on the named status register cannot overflow it. A write dropped at a full queue is counted (§12). A dropped command that had armed `CMD_ERROR` resolves it to `EAGAIN`, so the poll fails immediately instead of timing out.

### 3.3 Read consistency

Registers are served byte-by-byte while the device runs, so a multi-byte read is not atomic. The map is designed around this:

* **Pacing registers are one byte wide** (`XFER_PHASE`, `XFER_ACK`, `STATUS`, `RUNNER_STATE`, …). A one-byte read is served in a single transaction and cannot tear.
* **The sample window is latched per transaction.** The device snapshots the whole `SAMPLE_DATA` record when a read transaction first touches the window base. It serves every byte, across chunked continuations, from that snapshot, so one read returns one coherent record (§6.3). Re-addressing the window base starts a fresh snapshot.
* **A sample burst is latched per transaction.** A read that follows a cursor written after the `SAMPLE_DATA` pointer is built whole at its first byte and served from that copy (§6.3).

***

## 4. Register map

All multi-byte integer registers are little-endian. Access: RO = read-only, RW = read/write, WO = write-effective (reads back last value). Unlisted addresses are reserved. Reserved registers read 0 and ignore writes.

Allocation follows a fixed policy. A flat cell is granted only to live single-byte state. Feature groups scale through the `SEL` window's views (§6) and the config-record transfer (§6.7) rather than by consuming cells. `0xEE`-`0xEF` are the last unallocated flat cells and are held in reserve. `0xFE` is reserved for a future `FW_VERSION_PATCH`. `0xFF` is never allocated, so a bus readback of all `0xFF` remains distinguishable from any real register, a wiring diagnostic rather than data.

| Addr | Name | Access | Size | Description |
|---|---|---|---|---|
| `0x00` | `WHO_AM_I` | RO | 1 | Constant `0xAB` |
| `0x01` | `STATUS` | RO | 1 | Bit 0 `SAMPLE_READY`, bit 1 `ERROR`, bit 7 `RUNNING` |
| `0x02` | `VM_STATE` | RO | 1 | 0 IDLE, 1 RUNNING, 2 ERROR |
| `0x03` | `ERROR_CODE` | RO | 1 | VM error byte, synced from `vm_status`: 0 when healthy, otherwise the code the faulting personality raised (§12). Command and DFU results report in `CMD_ERROR` |
| `0x04` | `SAMPLE_COUNT` | RO | 2 | Free-running counter of produced samples (liveness/status), and the readout sequence rides inside the record (§6.3) |
| `0x06` | `SAMPLE_SIZE` | RO | 1 | Bytes per sample, as declared by the loaded personality |
| `0x07` | `NUM_PARAMS` | RO | 1 | Number of personality parameters |
| `0x08` | `NUM_OUTPUTS` | RO | 1 | Number of output fields per sample |
| `0x09` | `DRIVER_NAME_LEN` | RO | 1 | Valid length of the personality name (served via the personality view, `DRIVER_SELECT`) |
| `0x0A` | `STORE_COUNT` | RO | 1 | Populated personality-store slots |
| `0x0B` | `ACTIVE_SLOT` | RO | 1 | Store slot the running personality came from. `0xFF` = transient, a RAM upload |
| `0x0C` | `RUNNER_STATE` | RO | 1 | 0 NO\_DRIVER, 1 LOADING, 2 PROBING, 3 MEASURING, 5 PROBE\_FAILED |
| `0x0D` | `PROBE_RETRIES` | RO | 1 | Current probe retry counter |
| `0x0E` | `DECIMATION` | RW | 2 | Device-output decimation gate: `0` = output off, `1` = every sample, `N` = every Nth. Live on write, and committed to NVS by `STORE_PERSIST` (§5), like all savable config |
| `0x10` | `CMD` | WO | 1 | Command opcode (§5). Bit 7 is the optional doorbell |
| `0x11` | `PROGRAM_SIZE` | RW | 2 | Total size of the next upload, an NXS image under `XFER_TYPE` = 0 (§6.1) or a firmware image under 1 (§7.3), little-endian. Writing the high byte opens the session: `CMD_ERROR` reads `CMD_ERR_PENDING`, then the verdict. `0` is open, `EBUSY` another session, `EPROTO` a mode that takes no upload, and `EFBIG` a size over the staging buffer |
| `0x13` | `PARAM_SELECT` | RW | 1 | Selects which parameter the `0xC0` descriptor block exposes. Under the peek view of a cam personality slot it selects the run parameter `PARAM_SET_VALUE` stages, and the view stays (§6.11) |
| `0x14` | `PARAM_SET_VALUE` | RW | 4 | New value (u32) for the selected parameter, applied immediately (§6.4). Under the device-parameter view it reads and writes the selected device parameter's setting (§6.3). Under the peek view of a cam personality slot it stages the value for that slot's next `CAM_RUN` instead. It reads back the staged value, else the value the slot's last completed run ended with, else the slot's compiled default (§6.11) |
| `0x18` | `STORE_SELECT` | RW | 1 | Slot index for `SAVE` / `DELETE_SLOT` / `PEEK_SLOT` and the slot `CAM_RUN` runs. Under `XFER_TYPE` = 4, CALIB, and 5, BUILD\_INFO, it is the read-back page. Under 6 and 7, PERSONALITY\_INFO and its second bank, it is `slot << 5 \| page` (§6.11) |
| `0x19` | `PROTO_VERSION` | RO | 1 | Register-map contract version (= 1, §2) |
| `0x1A` | `XFER_TYPE` | RW | 1 | `PROGRAM_DATA` consumer. 0 = VM bytecode (default), 1 = DFU firmware image, 2 = identity-config record (§6.7), 3 = time-sync record (§6.8). 4 = calibration record (§6.9), 5 = build identity (§6.10). 6 = personality info, the read-only descriptor trailer of a stored cam personality, and 7 its second page bank (§6.11). A write while another writer's session is open is refused silently (§6.1) |
| `0x1B` | `XFER_PHASE` | RO | 1 | DFU phase: 0 IDLE, 1 ERASING, 2 READY, 3 WRITING, 4 FINISHING, 5 ERROR. While a calibration procedure runs it carries the `CalState` (§6.9). While a camera run holds the session it mirrors `CAM_STATE` (§6.11) |
| `0x1C` | `XFER_ACK` | RO | 1 | DFU accepted-chunk counter, modulo 256: 0 after `DFU_BEGIN`, +1 per committed chunk. While a calibration procedure runs it is the procedure's detail (§6.9). While a camera run holds the session it is the low byte of the program counter |
| `0x1D` | `CMD_ERROR` | RO | 1 | Result of the most recent host command op: a DFU operation, a store `SAVE`/`DELETE_SLOT`/`CLEAR_STORE`, `STORE_PERSIST`, or a calibration command (§6.9). 0 = OK, otherwise the positive errno (`EINVAL` for an out-of-range identity record). Reads `CMD_ERR_PENDING` (`0xFF`) while an async command is in flight. Cleared by a successful `DFU_BEGIN` and by `XFER_ABORT`. An accepted chunk and a mode write leave it untouched, so a mid-push poll reads the last verdict |
| `0x1E` | `DESCRIPTOR_EPOCH` | RO | 1 | Descriptor-set generation: 0 = no descriptors readable. Advances on every personality (re)load (§6.6) |
| `0x1F` | `OUTPUT_SELECT` | RW | 1 | Selects which output descriptor the `0xC0` window exposes, and switches the window to its output view (§6.6) |
| `0x20` | `PROGRAM_DATA` | WO | ≤32 | Upload window, with the consumer selected by `XFER_TYPE` |
| `0x40` | `SAMPLE_DATA` | RO | 128 | Latest-sample record, all LE (§6.3): `latch_time_us` u64 at +0, `timestamp_us` u64 at +8, `seq` u16 at +16. Sample data follows at +18 for `SAMPLE_SIZE` bytes, capped at 110 bytes. A 2-byte cursor written after the register pointer, in the transaction that then reads, serves a burst of queued records instead (§6.3) |
| `0xC0` | `SEL_NAME_LEN` | RO | 1 | Selected-descriptor window (§6.4, §6.6): name length, any view |
| `0xC1` | `SEL_NAME` | RO | 16 | Descriptor name, ASCII, any view (personality view: the loaded personality's name) |
| `0xD1` | `SEL_TYPE` | RO | 1 | Param view: bits\[3:0] = 0 enumerated value set, 1 range, and bit\[4] = kind (0 = reload, 1 = live, §6.4). Output view: field type code (§6.6). Peek view: the slot's kind, 0 for a click personality, 1 for a cam personality (§6.5) |
| `0xD2` | `SEL_PARAM_DEFAULT` | RO | 4 | Param view: default value (u32) |
| `0xD3` | `SEL_DRIVER_NUM_PARAMS` | RO | 1 | Personality and peek views: declared parameter count |
| `0xD4` | `SEL_DRIVER_NUM_OUTPUTS` | RO | 1 | Personality and peek views: declared output count |
| `0xD5` | `SEL_DRIVER_SLOT` | RO | 1 | Peek view: the peeked slot, `0xFF` in the live personality view |
| `0xD7` | `SEL_DRIVER_I2C_ADDR` | RO | 1 | Peek view: latched mikroBUS I²C address of the active click personality (`0` for stored slots) |
| `0xD2` | `SEL_OUTPUT_SCALE` | RO | 4 | Output view: effective scale, f32 (full-precision f64 via Cyphal `GetOutputInfo`, §8.2.8) |
| `0xD6` | `SEL_PARAM_CURRENT` | RO | 4 | Param view: current value (u32) |
| `0xD6` | `SEL_OUTPUT_OFFSET` | RO | 4 | Output view: offset (f32) |
| `0xDA` | `SEL_PARAM_NUM_VALS` | RO | 1 | Param view: declared values (≤ 16), paged via `SEL_VALUE_INDEX` |
| `0xDA` | `SEL_OUTPUT_BYTE_ORDER` | RO | 1 | Output view: sample byte order, 0 = big-endian, 1 = little-endian |
| `0xDB` | `SEL_UNIT_LEN` | RO | 1 | Valid length of `SEL_UNIT`, param/output views |
| `0xDC` | `SEL_UNIT` | RO | 8 | Unit string, ASCII, param/output views |
| `0xE4` | `SEL_VALUE_INDEX` | RW | 1 | Param view: which declared value `SEL_VALUE` exposes. It echoes when the page is served, and resets to 0 on `PARAM_SELECT`. Diag view: which fault counter `SEL_VALUE` exposes (§12). Device-parameter view: which device parameter (§6.3). Resets to 0 on entering either view |
| `0xE4` | `SEL_OUTPUT_SEMANTIC` | RO | 1 | Output view: semantic category code (§6.6) |
| `0xE5` | `SEL_VALUE` | RO | 4 | Param view: `values[SEL_VALUE_INDEX]`, u32. A range param pages `[min, max]` at indexes 0, 1. Diag view: the selected fault counter, u16 zero-extended to u32. Device-parameter view: the selected parameter's value in effect. An out-of-range index reads 0 in every view |
| `0xE5` | `SEL_OUTPUT_COUNT` | RO | 2 | Output view: string payload width in bytes, 0 for numeric fields |
| `0xE7` | `SEL_OUTPUT_AT` | RO | 1 | Output view: the field's byte position within the sample (offsets may gap) |
| `0xE9` | `DRIVER_SELECT` | RW | 1 | Writing `3` switches the window to the diag view (§12) and `4` to the device-parameter view (§6.3). Any other write switches it to the personality view. Echoes 1 in the personality view, 2 in the peek view, 3 in the diag view, 4 in the device-parameter view |
| `0xEA` | `DECIMATION_SELECT` | RW | 1 | Per-subject decimation selector: a SubjectBucket value. Deferred echo, so poll until it reads back. An out-of-range value echoes `0xFF`. Selecting repaints `DECIMATION_VALUE` |
| `0xEB` | `DECIMATION_VALUE` | RW | 2 | The selected subject's decimation factor (u16 LE, one-transaction write), the register mirror of `aliensense.nxs.decimation.<subject>`. Volatile until the config Save persists the live factors |
| `0xED` | `CAN_TERM` | RW | 1 | CAN split-termination selection: `0` = off (default), `1` = on, `0xFF` = revert to the default. Applies live, and is persisted by `STORE_PERSIST` / a Cyphal Save. Reads mirror the effective state. An out-of-vocabulary write is ignored |
| `0xEE` | `CAM_STATE` | RO | 1 | Camera run state (§6.11): 0 IDLE, 1 LOADING, 2 PROBING, 3 CONFIGURING, 4 DONE, 5 PROBE\_FAILED, 6 FAULTED, 7 ABORTED. A terminal value stands until the next `CAM_RUN` |
| `0xEF` | `CAM_ERROR` | RO | 1 | Positive errno of the last camera run's terminal state: 0 after DONE, `ECANCELED` after ABORTED, and the fault's errno after PROBE\_FAILED or FAULTED. That errno is one of `EIO`, `ETIMEDOUT`, `EILSEQ`, `EPROTO`, `EFAULT`, `EBADF`, `ENOEXEC`, `EFBIG`, `ENOTSUP`, and §12 gives each one's meaning |
| `0xF0` | `SERIAL` | RO | 12 | 96-bit factory-programmed unique ID, MSB-first. Reads `0` until set. Unique per unit |
| `0xFC` | `FW_VERSION_MAJOR` | RO | 1 | Running firmware version major, the same value `GetInfo.software_version` serves over Cyphal. Reads `0` on firmware that predates the register |
| `0xFD` | `FW_VERSION_MINOR` | RO | 1 | Running firmware version minor. `0xFE` is reserved for a future patch byte |

Several views share the window at `0xC0`–`0xE8`. They are a parameter view, an output view, a personality view, a peek view, a diag view, and a device-parameter view. The selector written last (`PARAM_SELECT`, `OUTPUT_SELECT`, or `DRIVER_SELECT`) decides which one it shows. `Cmd::PEEK_SLOT` switches it to the peek view, `DRIVER_SELECT = 3` to the diag view, and `DRIVER_SELECT = 4` to the device-parameter view. `DRIVER_SELECT` echoes `1` in the live personality view, `2` in the peek view, `3` in the diag view, `4` in the device-parameter view.

`SEL_NAME*`, `SEL_TYPE`, and `SEL_UNIT*` occupy the same addresses in the param and output views. The remaining addresses are view-specific. A parameter's value set is paged, not windowed: write an index to `SEL_VALUE_INDEX`, poll its echo, read the u32 at `SEL_VALUE`.

## 5. Commands

Written as a single byte to `CMD` (`0x10`). Bit 7 (`0x80`) is an optional doorbell: a host may write `opcode | 0x80` so that opcode 0 (`LOAD`) is distinguishable from an idle register. The device masks bit 7 before dispatch.

`RUN` / `STOP` / `RESET` / `CYCLE` / `IDENTIFY` are fire-and-forget: observe their effect through `RUNNER_STATE` / `STATUS` (§4) and `STORE_COUNT`. `REBOOT` / `ENTER_RECOVERY` / `DFU_FINISH` answer with the reset itself. A failed `DFU_FINISH` latches its errno in `CMD_ERROR` and does not reboot (§7.3).

The commands with a polled result report in `CMD_ERROR`: `LOAD`, the store commands `SAVE` / `DELETE_SLOT` / `CLEAR_STORE` / `STORE_PERSIST` / `PEEK_SLOT`, `DFU_BEGIN`, and `XFER_ABORT`. The register reads 0 for success, else a positive errno (§12). The command-dispatch path owns it, so a VM status update cannot overwrite it. These dispatch asynchronously: `CMD_ERROR` reads `CMD_ERR_PENDING` (`0xFF`) from enqueue until the result lands, and the host polls that edge. The `PROGRAM_SIZE` upload announce (§6.1) reports through the same protocol.

| Opcode | Name | Action |
|---|---|---|
| 0 | `LOAD` | Parse the staged NXS image and load it into the VM, without running it. Ends the upload session. `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` when the device confirmed the parse, or an errno. `ENODATA`: the staged bytes are short of the announce, a transport loss. Re-upload, and the loaded personality stays. `ENOEXEC`: not a valid personality image, with the detail in the device log. The failed parse leaves the no-personality state |
| 1 | `RUN` | Start the VM (probe → configure → measure) |
| 2 | `STOP` | Halt the VM. The personality stays loaded |
| 3 | `RESET` | Unload the personality entirely |
| 4 | `SAVE` | Persist the staged image into store slot `STORE_SELECT` |
| 5 | `DELETE_SLOT` | Delete store slot `STORE_SELECT` |
| 6 | `CLEAR_STORE` | Wipe every store slot |
| 7 | `CYCLE` | Advance to the next populated store slot |
| 8 | `DFU_BEGIN` | Open a firmware-update session, and erase the staging flash slot (§7.3) |
| 9 | `DFU_FINISH` | Close the open DFU session, check the staged image, arm the swap, reboot to apply. A finish with no DFU session open is refused `ENOENT` and does not reboot. Other refusals come without a reboot, with `XFER_PHASE` = ERROR and the errno in `CMD_ERROR`. `ENODATA`: fewer than a header's worth of bytes were staged, or the image's declared length runs past the staged bytes. `ENOEXEC`: the staged bytes are the wrong shape, with no header magic, a raw `zephyr.bin`. Push `zephyr.signed.bin`. The flush closes the staging session on the device, and sampling resumes. The register-map session stays latched, so the errno survives until `XFER_ABORT` releases it. The retry is a fresh `DFU_BEGIN`, never a resend of chunks |
| 10 | `REBOOT` | Reboot the device (a pending swap applies on boot) |
| 11 | `STORE_PERSIST` | Validate and commit the staged identity record (§6.7) to NVS, together with the live decimation state and the running calibration record (§6.9). The decimation state is the device-wide factor and the per-subject SI factors. Refuses `EPROTO` with no live stage. Identity applies at the next reboot |
| 12 | `IDENTIFY` | Strobe the status LED (~10 s) so an operator can physically locate the unit. A repeat re-arms the window |
| 13 | `PEEK_SLOT` | Peek `store[STORE_SELECT]` without loading it (`STORE_SELECT` = `0xFF` peeks the active personality). Async like SAVE: `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` for a valid peek view, or an errno. `ENOENT` is an empty slot, `EBADF` a corrupt image, `ENOTSUP` a foreign image version. On success the SEL window switches to the peek view (below). There `SEL_TYPE` is the slot's kind, 0 for a click personality and 1 for a cam personality. The view is a snapshot, so re-issue the peek after store mutations. Peeking a camera slot also arms its run-parameter stage (§6.11). Peeking a different slot drops it |
| 14 | `ENTER_RECOVERY` | Arm MCUboot serial recovery and cold-reset into it. The device then holds in the bootloader until an upload completes (§7.4). Dispatched independently of the personality runner, so it reaches a device whose personality never loaded. Arms `CMD_ERR_PENDING`. On success the sentinel stays pending until the reset drops the bus, so the NACK is the acknowledgement. If the retention flag cannot be written the device stays in the application and `CMD_ERROR` resolves to the errno |
| 15 | `XFER_ABORT` | Release the transfer session and the `PROGRAM_DATA` mux, from any host, since the lock stops accidents, not intent. Resets `XFER_TYPE` to 0 and every staging cursor. `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` when a session was closed or `ENOENT` when none was open. A cleanup can therefore tell "released" from "nothing to do" |
| 16 | `CALIB_APPLY` | Validate the staged calibration record and apply it to the running state (§6.9). `CMD_ERROR` reads 0 when applied. It reads `EBUSY` while a firmware update or a running procedure holds the status registers, or `EINVAL` for a malformed or incomplete record |
| 17 | `CAL_GYRO` | Start the on-device gyro still-average (§6.9). `CMD_ERROR` reports acceptance: 0, `EBUSY` during a mag collection, `EOPNOTSUPP` when the active personality has no gyro vector, `ENODATA` while the personality is not measuring. The completion verdict lands in `CMD_ERROR` when the phase returns to idle |
| 18 | `CAL_MAG_START` | Begin the on-device mag collection (§6.9). `CMD_ERROR` reports acceptance: 0, `EBUSY` during a gyro procedure, `EOPNOTSUPP` when the active personality has no mag vector, `ENODATA` while the personality is not measuring |
| 19 | `CAL_MAG_STOP` | Close the mag collection: coverage-gate, solve, self-check, apply (§6.9). `CMD_ERROR` carries the fit verdict |
| 20 | `CALIB_PERSIST` | Commit the running calibration record to NVS, leaving identity untouched. It is the save a host performs after a solve (§6.9), when it has no identity record to stage. Snapshots the same live state a full Save does. Async like SAVE: `CMD_ERROR` reads `0` when committed, `EBUSY` while a firmware update or a running procedure holds the status registers. It reads `ENODEV` with no calibration bank, else an errno |
| 21 | `CONFIRM_FW` | Confirm the running firmware image so MCUboot keeps it across the next reset (§7.2). It is the supervisor's verdict after it validated the new image end to end. Idempotent on an already-confirmed image. Async like SAVE: `CMD_ERROR` reads `CMD_ERR_PENDING`, then 0 when confirmed. It reads `EBUSY` while an update session or an on-device procedure holds the status registers, or the errno of a failed trailer write. Dispatched independently of the personality runner |
| 22 | `CAM_RUN` | Run the cam personality in slot `STORE_SELECT` once on the pod-side bus (§6.11). Claims the transfer session like a calibration procedure. `CMD_ERROR` reports acceptance: 0, or an errno. `ENOEXEC`: the slot holds a click personality. `EBADF`: its cam personality does not parse. `ENOENT`: an empty slot. `EINVAL`: a staged value the personality does not accept. `EBUSY`: a session is open or a run is live. The verdict lands in `CMD_ERROR` on the run's terminal edge |
| 23 | `CAM_ABORT` | Stop a camera run within 50 ms. `CMD_ERROR` reads 0 when a run was stopped, or `ENOENT` when none was live. The run ends ABORTED with `ECANCELED` |

## 6. Procedures (I²C)

### 6.1 Personality upload

An upload is a transfer session. From the size announce to `LOAD`, the device reserves the `PROGRAM_DATA` mux for the uploader. Every step reports its verdict before the next may proceed. Nothing streams on a refusal, so a chunk can never land in another transfer's sink.

```d2 title="The personality upload over I²C, from the claim to RUN"
# The personality upload over I²C (Interface Description §6.1): one transfer
# session from the size announce to LOAD, every step answered before the next.

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

shape: sequence_diagram

host: Host
unit: NXS unit

claim: "1. Claim the bytecode consumer" {
  host -> unit: "write XFER_TYPE = 0"
  host <- unit: "read XFER_TYPE: 0 echoed (another echo: the mux is owned, retry or XFER_ABORT)"
}

announce: "2. Announce the image" {
  host -> unit: "write PROGRAM_SIZE (u16, one 2-byte write)"
  host <- unit: "CMD_ERROR: CMD_ERR_PENDING, then 0 (session open) or EBUSY, EPROTO, EFBIG"
}

stream: "3. Stream the image, chunks of up to 32 bytes" {
  host -> unit: "write PROGRAM_DATA"
  host -> unit: "write PROGRAM_DATA …"
}

load: "4. Load" {
  host -> unit: "write CMD = LOAD"
  host <- unit: "CMD_ERROR: CMD_ERR_PENDING, then 0 (parsed) or ENODATA, ENOEXEC; the session ends"
}

run: "5. Stop the previous personality, run the new one" {
  host -> unit: "write CMD = STOP"
  host <- unit: "RUNNER_STATE: LOADING"
  host -> unit: "write CMD = RUN"
  host <- unit: "RUNNER_STATE: MEASURING, or PROBE_FAILED with ERROR_CODE"
}
```

1. Claim the bytecode consumer: write `XFER_TYPE = 0`. Read it back. A live session on any mode refuses the write silently. A readback that does not echo 0 means another transfer owns the mux. Retry later, or release it deliberately with `CMD = XFER_ABORT`.
2. Announce the image: write the total size to `PROGRAM_SIZE` (u16, one 2-byte write). The announce arms `CMD_ERROR` with `CMD_ERR_PENDING`, so poll it out. `0` opens the session. `EBUSY` means a session is live, another upload or a firmware push. `EPROTO` means `XFER_TYPE` is not 0. `EFBIG` means the size exceeds the staging buffer (§11).
3. Stream the image to `PROGRAM_DATA` in chunks of up to 32 bytes.
4. Write `CMD = LOAD`. Poll `CMD_ERROR` out of `CMD_ERR_PENDING`. `0` means the device validated the NXS header (magic and format version, §10.1) and parsed the image. Only then has the upload happened. `LOAD` ends the session either way and leaves `RUNNER_STATE` as it was.

   `ENODATA`: the stage is short of the announce, refused before the parse, so the personality loaded before stays. `ENOEXEC`: the bytes are not a valid personality image, and the failed parse leaves the device in the no-personality state. A personality that runs keeps running until step 5 stops it.
5. The restart: `CMD = STOP`, a poll of `RUNNER_STATE` until LOADING, `CMD = RUN`, a poll until MEASURING, or PROBE\_FAILED.

   A `LOAD` leaves the state as it was, and until the runner parks, the register carries the verdict of the personality that ran before. `ERROR_CODE` names the code the probe raised (for example `WHO_AM_I_MISMATCH`). An I/O failure leaves it 0 while `VM_IO_ERRORS` counts it.

A session abandoned mid-stream (a crashed host) releases itself after 2 s of holder silence. The partial stage is discarded when the next contender takes over. `XFER_ABORT` releases it immediately.

### 6.2 Run state

`RUNNER_STATE` is the personality lifecycle: NO\_DRIVER → PROBING → MEASURING from a `RUN`, and LOADING while a `STOP` holds a loaded personality parked. A `RUN` or a `CYCLE` is accepted before the device starts the probe. Until then the register still reads the state before the command, the last personality's MEASURING or PROBE\_FAILED included. A host that needs the verdict of its own run stops first (§6.1 step 5). A sensor that fails its probe `PROBE_RETRIES` times enters PROBE\_FAILED. If other store slots are populated, the device advances to the next slot autonomously.

A host that caches anything derived from the loaded personality (sample layout, parameters) must validate the cache against `DESCRIPTOR_EPOCH` (§6.6). The epoch advances on every personality (re)load, autonomous slot changes included.

```d2 title="RUNNER_STATE, the personality lifecycle"
# RUNNER_STATE, the personality lifecycle (Interface Description §6.2).

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

direction: down

classes: {
  state: {style: {fill: "#e3ecf7"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14; border-radius: 8}}
  terminal: {style: {fill: "#fff0c2"; stroke: "#b07a00"; stroke-width: 2; font-size: 14; border-radius: 8}}
}

no_driver: "NO_DRIVER (0)\nno personality loaded" {class: state}
loading: "LOADING (1)\nloaded, parked by STOP" {class: state}
probing: "PROBING (2)\nsensor cold-reset, WHO_AM_I read" {class: state}
measuring: "MEASURING (3)" {class: state}
probe_failed: "PROBE_FAILED (5)\nPROBE_RETRIES probes failed" {class: terminal}

no_driver -> probing: "RUN, or the boot auto-load of the first populated slot"
loading -> probing: "RUN"
probing -> measuring: "the sensor answers"
probing -> probe_failed: "PROBE_RETRIES failures"
probe_failed -> probing: "another slot populated: autonomous advance"
measuring -> loading: "STOP"
measuring -> probing: "CYCLE: the next populated slot"
measuring -> no_driver: "RESET"
loading -> no_driver: "RESET"
```

On every entry into PROBING the device cold-resets the sensor before reading WHO\_AM\_I. It pulses the shared mikroBUS reset line (assert, hold, release, settle), so every bind, including an autonomous slot advance, probes a freshly-reset part. Reset polarity is per-personality. A personality for an active-high-reset part exposes a `reset_active` parameter, an enum, `1` active-high and `0` active-low. The parameter is RAM-backed and reverts to its compiled default on reset. The device reads it at bind to drive the correct physical level, and its absence selects the active-low default.

The parameter is discoverable through the normal parameter path (§6.4). It reflects the part's fixed datasheet polarity rather than a per-deployment override.

### 6.3 Sample readout

The `SAMPLE_DATA` window (`0x40`, 128 bytes) holds one record, little-endian throughout:

| Offset | Field | Size | Content |
|---|---|---|---|
| 0 | `latch_time_us` | 8 | Device µs clock at the instant this read transaction latched the window (§6.8) |
| 8 | `timestamp_us` | 8 | The sample's acquisition instant, device µs clock. It is the delivered DRDY edge (or declared frame bound) behind its measure pass, or the commit instant where the pacing carries no event |
| 16 | `seq` | 2 | Sample sequence number, wraps at 2^16 |
| 18 | data | `SAMPLE_SIZE` | Raw sample bytes, ≤ 110 |

Readout is a single (optionally chunked) read of `18 + SAMPLE_SIZE` bytes from `0x40`. The device latches the whole record when the transaction first touches the window base and serves every byte from that snapshot. `seq`, `timestamp_us`, and data are therefore coherent by construction, with no guard counter and no retry. Compare `seq` against the previous read to detect a new sample. Or pre-check `STATUS` bit 0 with a one-byte read when polling faster than the sample rate. A `seq` moving backward signals a personality restart, so re-read `SAMPLE_SIZE` and the descriptors (§6.6).

Between a personality unload and the next load `SAMPLE_SIZE` serves 0 and the descriptor set is empty (`DESCRIPTOR_EPOCH` = 0, §6.6). A host must treat a 0 size, like a backward `seq`, as transitional: re-read rather than cache it.

Sample content is defined by the personality's output-field descriptors (name, type, byte order, scale, offset, unit, semantic per field). They travel inside the NXS image and are readable on device (§6.6), so decoding a sample requires no personality file on the host. An addressed `nxs status` prints the descriptor set in its `Outputs:` block.

The window always holds the latest sample, so the host can decimate further by polling slower than the device produces. `DECIMATION` (`0x0E`) is the device-output gate. At the default `1` the window and `SAMPLE_READY` advance on every sample, `N` advances them only every Nth sample, and `0` stops output entirely. The gate is device-wide: it applies identically to the I²C window and to the Cyphal sample and SI subjects. The value is persisted across power cycles. Per-subject SI decimation is a separate refinement thinning only the Cyphal SI fan-out (§8.2.7).

Its factors are configurable over any transport: the `aliensense.nxs.decimation.<subject>` registers over Cyphal, the `DECIMATION_SELECT`/`DECIMATION_VALUE` window over I²C.

#### Sample FIFO

The device queues every sample that clears the `DECIMATION` gate. A host therefore reads batches and loses nothing while it is late by less than the queue's depth. Every queued record takes the next FIFO index, a u16 that wraps. The host names the index it wants next, the cursor, by writing two bytes after the register pointer in the transaction that then reads:

```
S addr W | 0x40 | cursor_lo | cursor_hi | Sr addr R | burst … | P
```

| Offset | Field | Size | Content |
|---|---|---|---|
| 0 | `latch_time_us` | 8 | Device µs clock at the first read byte, as in the record (§6.8) |
| 8 | first index | 2 | FIFO index of the first record served |
| 10 | count | 1 | Records in this burst |
| 11 | record size | 1 | Bytes per record, `10 + SAMPLE_SIZE` |
| 12 | pending | 2 | Records still queued behind this burst |
| 14 | records | count × record size | Oldest first, each `timestamp_us` u64, `seq` u16, then the sample bytes |

A burst is at most 256 bytes. The device releases the records before the cursor and serves from it on. A record leaves the queue only once a later cursor has passed it. A repeated read with the same cursor therefore returns the same records, so a failed transfer loses nothing. A host that reads fewer bytes than the burst advances its cursor by the whole records it received. To start from the present, a host reads the 14-byte header with any cursor and continues from `first index + count + pending`.

When the device has overwritten the record the cursor names, it serves from its oldest record. The first index is then ahead of the cursor, and the difference is the number of samples lost. A difference of 2^15 or more means the device restarted its index, and the host continues from the first index without counting a loss. A personality load drops the queue and the index keeps counting.

A device without the FIFO takes bytes written after a register pointer as a register write. A host therefore sends a cursor only to a device that echoes `4` in `DRIVER_SELECT`. A read with the pointer alone returns the latest-sample record on every device.

The queue holds 2048 bytes of records, 85 samples of a 14-byte IMU personality. Its depth is a device parameter. Write `DRIVER_SELECT = 4` and index `0` to `SEL_VALUE_INDEX`, await each echo, then read or write the setting as a u32 at `PARAM_SET_VALUE`. The setting is 0 to 255 records, where 0 (the default) is all the storage holds and a larger value than that is clamped.

`SEL_VALUE` serves the depth in effect. A write applies live and `STORE_PERSIST` commits it. A value past 255 is ignored, which the unchanged read-back shows. A `PARAM_SELECT` write leaves the view. The Cyphal face of the setting is `aliensense.nxs.sample_fifo.depth` (§8.2.7).

### 6.4 Parameters

Each parameter has a **kind**, `reload` or `live`, packed into `SEL_TYPE` bit 4 (§3), and the kind selects how a write is applied.

Read: write the parameter index to `PARAM_SELECT`. Then read the descriptor window at `0xC0`–`0xE8` in its parameter view (name, type, kind, default, current, unit). Then page the allowed values through `SEL_VALUE_INDEX`/`SEL_VALUE`. A range parameter (`SEL_TYPE` low bits = 1) reports its bounds as `[min, max]` at value indexes 0 and 1.

Write: select the index, then write the new value as u32 to `PARAM_SET_VALUE`. Values outside the allowed set, or outside `[min, max]` for a range parameter, are rejected silently. The window read-back shows the value still in force. How an accepted value is applied depends on the kind:

* **reload**: the device rewrites the personality's bytecode in place and reloads the VM (re-running probe + configure). The parameter takes effect without a host-visible restart.
* **live**: the device updates the value in place, and a runtime consumer re-reads it on its next cycle. The VM is **not** reloaded, so sampling continues uninterrupted.

Range parameters are always **live**. They carry no bytecode rewrite site, so a reload range would only fire a useless reload on every set. The device enforces the parameter contract at `LOAD`. An image is rejected (`ENOEXEC` in `CMD_ERROR`, the staged image left unchanged) when it declares one of these faults. The faults are a reload range, a range with other than two `[min, max]` bounds, a `default`/`current` outside those bounds, or an unrecognized parameter type. A host that uploads a well-formed image never sees these.

The PWM helper auto-declares two live range parameters, `pwm_freq` ∈ `[500, 25000]` Hz and `pwm_duty` ∈ `[0, 100]` %. A host retunes them at runtime via `PARAM_SET_VALUE` to drive the mikroBUS PWM pin.

Some parameters are injected by the compiler from a personality's hardware declarations rather than an explicit declaration. `bus` selects the active communication profile among the buses the personality supports (I²C `0`, SPI `1`, §10.2). `i2c_addr` overrides the strap scan, and `reset_active` sets the mikroBUS reset polarity. They are read and written through the same window and value path as any other parameter. `bus` reloads the personality so the new profile is applied at the next bind.

### 6.5 Personality store

The store persists up to 8 personality images in flash. `SAVE` writes the *staged* image (the most recent upload) to the selected slot. The result is reported in `CMD_ERROR` (§12): 0 on success, else a positive errno. The errno names no personality staged, a duplicate already stored, or a full store.

A store command (`SAVE`, `DELETE_SLOT`, `CLEAR_STORE`, `PEEK_SLOT`) issued while a transfer session is live, an upload or a firmware push, is refused with `EBUSY`. Persisting a half-streamed stage would surface as a corrupt slot at some later boot. A store landing mid-firmware-push would overwrite the push's latched error detail. A stale session's partial stage is discarded rather than saved.

The store keeps its slots packed. `SAVE` to a populated slot overwrites it in place, and `SAVE` to any other slot appends after the last populated one. `DELETE_SLOT` moves every later image down one slot. A host that replaces an image saves over its slot. A delete first would move the next image onto the slot it then saves to.

On boot the device auto-loads the first populated slot. `STORE_COUNT`, `ACTIVE_SLOT`, and `CYCLE` (§5) manage rotation. PROBE\_FAILED auto-advance (§6.2) makes a multi-sensor store self-selecting: the device settles on the first personality whose sensor answers.

### 6.6 Output descriptors

Each loaded personality declares how its sample bytes decode. Per field it declares a name, type, byte order, scale, offset, unit, semantic category, and for string fields a byte count. Fields are packed in declaration order, and their widths sum to `SAMPLE_SIZE`. A numeric field's width follows its type, and a string field's width is `SEL_OUTPUT_COUNT`. With no personality loaded the set is empty: `NUM_OUTPUTS` and `DESCRIPTOR_EPOCH` read 0, and `SAMPLE_SIZE` serves 0 until the next load (§6.3).

Read: write the field index (0 … `NUM_OUTPUTS`−1) to `OUTPUT_SELECT`. Then read the descriptor window at `0xC0`–`0xE8` in its output view. The field decodes at its declared byte position (`SEL_OUTPUT_AT`). Offsets may gap, since binary-record personalities map fields onto scattered offsets. Physical value = raw × scale + offset, in the unit string's unit.

The `scale` the window serves is the *effective* scale. It is the personality's base factor already multiplied by any linked parameter's live `current_value`, for example an IMU's full-scale range. So `raw × scale` decodes to correct SI at the current range with no re-read of the personality image. The same effective scale backs the Cyphal `GetOutputInfo` service and the `si.sample.*` projection (§8.2.8).

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

Semantic category codes (0 when no category applies, and codes are append-only):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 0 | generic | 7 | mag\_x |
| 1 | accel\_x | 8 | mag\_y |
| 2 | accel\_y | 9 | mag\_z |
| 3 | accel\_z | 10 | temperature |
| 4 | gyro\_x | 11 | pressure |
| 5 | gyro\_y | 12 | humidity |
| 6 | gyro\_z | 13 | nmea |

Geodetic semantic codes (the structured-GNSS group, projected onto the standard `reg.udral…geodetic.PointStateVarTs` subject):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 14 | latitude | 19 | vel\_down |
| 15 | longitude | 20 | pos\_h\_acc |
| 16 | altitude | 21 | pos\_v\_acc |
| 17 | vel\_north | 22 | vel\_s\_acc |
| 18 | vel\_east | | |

Scalar SI semantic codes (each projected onto the matching `uavcan.si.sample.<quantity>.Scalar` subject, §8.2.8):

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 23 | angle | 29 | luminance |
| 24 | voltage | 30 | mass |
| 25 | current | 31 | torque |
| 26 | distance | 32 | speed |
| 27 | force | 33 | flow |
| 28 | frequency | | |

GNSS epoch semantic codes, with no standard-subject projection. They identify a receiver's time solution for epoch-aware consumers, and the ROS 2 bridge's receiver-epoch stamp mode keys on the pair:

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 34 | time\_of\_week | 35 | fix\_type |

Descriptor reads race the device's autonomous personality changes (§6.2), so a host validates a descriptor set with `DESCRIPTOR_EPOCH`:

1. Read `DESCRIPTOR_EPOCH` (e₀). 0 means no descriptors are readable. Either the device holds no personality, or the firmware predates this register, which then always reads 0.
2. Read `NUM_OUTPUTS`, and each descriptor via `OUTPUT_SELECT`.
3. Read `DESCRIPTOR_EPOCH` again (e₁). If e₁ = e₀ the set is coherent. Cache it keyed by e₀. Otherwise restart from step 1.

A cached set remains valid exactly while `DESCRIPTOR_EPOCH` still reads e₀. Re-check it before trusting a cached sample layout. The epoch advances on every personality (re)load. A re-upload under the same personality name may carry different fields, so equality of the personality name guarantees nothing.

### 6.7 Commissioning (identity)

Node-ID, subject-IDs, and the CAN bit-timing profile are committed through the `PROGRAM_DATA` window under a config transfer mode. There are no extra fixed registers in the full map. The record is 28 bytes, packed little-endian. It holds the u16 node address, then nine u16 subject addresses in order, then the u32 CAN arbitration and data-phase bitrates in bit/s. The subject order is `sample`, `status`, `acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`, `gnss`, `scalar`. A valid node address is `0`–`125`, `255` for anonymous, or `0xFFFF`.

126 and 127 are reserved for diagnostic and host tooling. A valid subject address is `0`–`8191`, with the `scalar` base at most `8181`, keeping its 11-subject block in range. An address of `0xFFFF` reverts the field to the compiled default, and a subject address of `0` disables that topic. The bitrate pair must be a supported profile (§8.2.7). Equal rates select Classic CAN, and `{0, 0}` reverts to the compiled default profile. A host that changes only identity reads the record first and echoes the current pair back.

| Step | Register / command | Effect |
|---|---|---|
| 1 | write `XFER_TYPE = 2`, read it back | enter config mode. A live transfer session refuses the write silently, so the readback is the claim check. The `PROGRAM_DATA` window mirrors the current record for read-back |
| 2 | read `PROGRAM_DATA` (28 B) | the current identity record |
| 3 | write `PROGRAM_DATA` (28 B) | stage a new record |
| 4 | write `CMD = STORE_PERSIST` | validate + commit. Poll `CMD_ERROR` until it leaves `CMD_ERR_PENDING`: `0` = OK, `EINVAL` = out of range. `EPROTO` = the staged record was trampled by an interleaved mode write (§12), so re-stage from step 2. Consuming the record resets the staging cursor, so a corrected record may be staged and committed without re-entering config mode |
| 5 | write `CMD = REBOOT` | the new node-ID / subject-IDs / CAN profile take effect on boot |

Identity is fixed when the Cyphal node is constructed, so steps 1–4 persist the record and step 5 applies it. The same `STORE_PERSIST` snapshots the live decimation state, the device-wide `decimation` (§4) and the per-subject SI factors. The running rates therefore persist alongside the identity, exactly as a Cyphal Save does. A record staged in step 3 holds the window until step 4 consumes it (or config mode is left). The device's own identity refresh never overwrites pending staged bytes.

Staging is last-writer-wins between masters, since commissioning is a provisioning operation, one master at a time. A factory-fresh device needs none of this: it is plug-and-play at the compiled defaults.

### 6.8 Time synchronization

All device timestamps are one monotonic µs clock counting from device boot. They are `timestamp_us` in the sample record (§6.3), in `RawSample` (§8.2), and in the SI subjects (§8.2.8). The device additionally serves that clock's *current* value on every wire. A host can therefore measure the device→host clock offset with a bounded error and translate acquisition timestamps into its own time domain:

* **I²C**: `latch_time_us` in the sample record is stamped when the read transaction latches the window. The host's clock readings immediately before and after that transaction bracket it, so every sample poll doubles as one sync observation.
* **Cyphal (serial and CAN)**: the read-only `aliensense.nxs.time_us` register, natural64 (§8.2.7), returns the clock at request service time. The host brackets the `register.Access` round trip.

The estimation recipe is the standard two-way method (RFC 5905). For each exchange with host clock readings `t0`/`t1` around a device reading `d`, the host−device offset candidate is `(t0 + t1)/2 − d` with error bounded by `(t1 − t0)/2`. Keep the minimum-round-trip exchange over a sliding window (~30 s) and fit drift across the window, since the device clock is oscillator-driven, tens of ppm.

Repeating an exchange at ~1 Hz holds the projection error near the per-wire floor. That floor is ~100 µs on I²C (the host masters a ~200 µs transaction), a few hundred µs on CAN-FD, and 1–2 ms on serial. On serial the exchange shares a half-duplex link with the sample stream. `nxs ros2 --stamp synced` implements exactly this. The surfaces are standard reads, so any host can.

The host can additionally push its estimate down, giving the device a synced timescale, mesh time, beside its untouched local clock. The push is volatile and expires. Each record carries its own validity window, the discipline decays that long after the push applies, and every consumer falls back to local behavior. The window is the pusher's receipt timeout expressed as a duration. The `nxs` tools push ten times their refresh cadence, so ten consecutive lost pushes end the discipline. A zero window is malformed and the device rejects the record.

* **I²C**: write `XFER_TYPE = 3` and read it back. A live transfer session (a personality upload or firmware push) refuses the write silently. A periodic pusher then skips the cycle rather than streaming into the wrong sink. Then stream the 20-byte record into `PROGRAM_DATA`, in this order:

  * offset, i64 LE, µs
  * bound, u32 LE, µs
  * rate, i32 LE, parts per billion
  * validity window, u32 LE, µs

  The record applies as its last byte lands and the window re-arms for the next push. A read of the window in this mode serves the live state. That is offset, bound, rate, validity window, a source byte (0 none or stale, 1 host), and a validity byte.
* **Cyphal**: write `aliensense.nxs.time_sync` in one `register.Access`, as `integer64[4]` (offset µs, bound µs, rate ppb, validity window µs). A read serves `integer64[5]`, which is offset, bound, rate, validity window, source.

While a discipline is fresh, the SI subjects' `SynchronizedTimestamp` fields carry mesh time (the local clock mapped through the pushed offset and rate). Undisciplined, they carry the local clock. `RawSample.timestamp_us` and the sample record stay the local clock always. The rate term extrapolates the estimator's fitted clock skew between pushes. The mesh error therefore does not grow at the oscillator differential over the push interval.

While a discipline stays valid, mesh time is continuous and monotonic across pushes. A correction of 1 ms or less is absorbed by slewing at 500 ppm, never by stepping. The first discipline, a re-acquire after staleness, and a correction beyond 1 ms apply as a step. The status LED renders its pattern from the synced second while disciplined, so synced units blink in phase. `nxs switch` seeds the discipline at converge. A resident pusher keeps it fresh: the bare `nxs timesync`, an addressed `nxs --unit <name> timesync`, or the ROS 2 bridge.

### 6.9 Calibration

The device stores one per-unit calibration record. It holds an affine correction `v_out = M·v + b` (M 3×3 row-major, b 3×1) per vector bucket, the buckets being acceleration, angular velocity, magnetic field. It also holds a mounting-orientation code, and a scalar encoder zero-offset added to the `angle` output, the sum wrapped into \[0, 2π). The correction applies in the SI tier only. The `uavcan.si.sample.*` subjects (§8.2.8) carry calibrated values, while the `RawSample` stream and the I²C sample window (§6.3) carry raw counts. A host that applies the served record to its own raw decode reproduces the SI subjects exactly.

The orientation code composes a mount rotation on top of each bucket's affine (effective affine = R·M, R·b). It is one of the 24 axis-aligned proper rotations, with each angle in {0, 90, 180, 270}. The names follow the composition R = Rz·Ry·Rx, the rotations about Z by yaw, Y by pitch and X by roll. The names run from `NONE`, code 0, through `YAW_90`, code 1, to `ROLL_270_YAW_270`, code 23.

The code names the board's physical mounting rotation relative to the vehicle frame. The device applies that same rotation to measured vectors, so a board mounted with the named rotation reports vehicle-frame values. Verification anchor: a level board with `ROLL_90` set reads gravity on −Y, and the physically rolled board (+Y up) reads +Z.

Each solved bucket carries a personality tag: the FNV-1a 32-bit hash of the personality it was solved against. The hash is taken over the personality name, the bus kind, and the latched device address, and 0 = unguarded. Two identical Clicks on one panel therefore hash to different tags, so a swap between them is refused rather than silently accepted. A tagged bucket whose tag mismatches the running personality contributes only the mount rotation, never the stale affine. The encoder zero carries its own tag.

**Record layout.** 168 bytes, packed little-endian, one layout on flash and the wire:

| Offset | Field | Type | Content |
|---|---|---|---|
| 0 | `version` | u8 | record-layout version, 1. A persisted record whose version or size mismatches the firmware's layout is discarded at boot in favour of identity defaults |
| 1 | `orientation` | u8 | rotation code 0–23 |
| 2 | `reserved` | u8\[2] | 0 |
| 4 | `m` | f32\[3]\[9] | per-bucket M, row-major, buckets in order acceleration, angular velocity, magnetic field |
| 112 | `b` | f32\[3]\[3] | per-bucket b, same order |
| 148 | `encoder_zero` | f32 | radians added to the `angle` output, the sum wrapped into \[0, 2π) |
| 152 | `driver_tag` | u32\[3] | per-bucket personality guard, 0 = unguarded |
| 164 | `encoder_tag` | u32 | encoder-zero personality guard |

**Record write.** The record travels through the `PROGRAM_DATA` window under a calibration transfer mode, mirroring the identity flow (§6.7):

| Step | Register / command | Effect |
|---|---|---|
| 1 | write `XFER_TYPE = 4` | enter calibration mode. The write resets the staging cursor |
| 2 | write `PROGRAM_DATA` (168 B, chunks of ≤ 32 bytes) | stage the record |
| 3 | write `CMD = CALIB_APPLY` | validate + apply to the running state. Poll `CMD_ERROR` until it leaves `CMD_ERR_PENDING`: `0` = applied, `EBUSY` = a firmware update or a running procedure holds the status registers, `EINVAL` = malformed or incomplete record |
| 4 | write `CMD = CALIB_PERSIST` | persist the running record to NVS. Poll `CMD_ERROR`: `0` = committed, `ENODEV` with no calibration bank. This save carries no identity record, so it is a distinct command from `STORE_PERSIST` (§5) rather than the same one in a different ambient state |

Step 3 changes the running state immediately, with no reboot. Step 4 is the unified Save of the running/startup model (§8.2.7). An applied record that is not persisted reverts at power-cycle.

Over Cyphal the same two phases are the calibration registers and `aliensense.nxs.calibration.commit` (§8.2.7). Field writes stage, the commit applies the staged record whole, and Save persists it. Staging is what keeps the SI subjects from publishing under a partly-updated record. A host changing both the coefficients and the mount would otherwise emit the new coefficients under the old rotation for the remaining round trips. `aliensense.nxs.calibration.dirty` reads `1` while staged and running differ. Writing `0` to `calibration.commit` discards the staged edit and re-seeds the stage from the running record, the reset for an abandoned or failed edit.

A commit refused `ECANCELED` (an on-device solve landed mid-edit) also discards the stage, so the host re-reads and re-stages on a fresh copy. A validation refusal keeps the stage for a single-field correction.

**Record read-back.** Under `XFER_TYPE = 4` the `PROGRAM_DATA` window mirrors the running record, paged by `STORE_SELECT`. Write the page index, then read the window. It serves record bytes `[page·32 .. page·32+31]` (the 168-byte record spans six pages).

Byte 168 is the record's change counter, the same value the `aliensense.nxs.calibration.epoch` register serves over Cyphal. A host brackets the paged read on it: read the counter, the record, the counter again, and retry when it moved. That is the `DESCRIPTOR_EPOCH` idiom (§6.6), identical on both transports.

**On-device procedures.** Two solves run on the device itself, so a Cyphal autopilot or any I²C master drives them with no host tool. They report on the same registers the DFU path uses, and the device refuses the overlap. A procedure start while an update or upload session is live answers `EBUSY`, on either transport. So does starting an update while a host-commanded procedure runs. The boot-automatic gyro pass, which arms on the runner's first `MEASURING`, is the exception. It is the device's own housekeeping, so any host claim stops it and takes the session, keeping the previous boot's bias.

A host claim is a personality upload, a store command, `DFU_BEGIN` or `BEGIN_SOFTWARE_UPDATE`. A calibration start that joins that pass makes it the host's, and it then refuses like any other host-commanded procedure. `XFER_PHASE` carries the state (0 idle, 1 gyro-wait-still, 2 gyro-averaging, 3 mag-collect). `XFER_ACK` carries the detail: the gyro percent averaged, or the mag rotation coverage of 14. Of that coverage 12 is the stopping point at which a host asks the solve, and the answer can still be `EAGAIN`. `CMD_ERROR` carries the completion verdict.

A procedure has finished when `XFER_PHASE` returns to idle. Read the verdict in the same poll that observes the idle phase. `CMD_ERROR` is shared with the store and DFU results, and the next command op replaces it. Leaving DFU mode with an `XFER_TYPE` write resets `XFER_PHASE` and `XFER_ACK` only.

* **Gyro still-average** (`CAL_GYRO`): the device waits for stillness (a per-axis peak-to-peak gate), averages 400 samples, and writes `b = −mean` into the running record. The command result is acceptance only. The completion verdict lands in `CMD_ERROR` on the idle edge: it reads 0 while the average runs, then the errno when `XFER_PHASE` returns to idle. A commanded run times out after 60 s. The same procedure also runs once automatically at boot, on the runner's first `MEASURING`. It completes on a still boot and gives up with `ETIMEDOUT` after ~15 s of motion, leaving the stored bias untouched.
* **Mag in-situ ellipsoid** (`CAL_MAG_START` / `CAL_MAG_STOP`): `CAL_MAG_START` begins collection. The vehicle is rotated through all attitudes while the device accumulates float64 normal-equation sums, and no sample cloud is stored. `CAL_MAG_STOP` coverage-gates, solves, self-checks, and applies. Its `CMD_ERROR` is the fit verdict: 0 = applied, `EAGAIN` = insufficient coverage, `ERANGE` = degenerate, non-ellipsoid fit. `EBADMSG` = failed the sphere self-check, where the calibrated |B|² spread over the accumulated cloud exceeds the gate. Every failure keeps the previous calibration.

  `EAGAIN` alone leaves the collection open and restarts its give-up window. A host that reaches the progress byte's stopping point and is told "not yet" keeps rotating and stops again rather than starting over. A stop after the window finally expires answers `EINVAL`, no collection open. Coverage is only decided once the fit has divided the mount's own distortion out, so the progress byte is an estimate. `Cmd::XFER_ABORT` drops a procedure without solving, for a host that wants to cancel rather than commit. Over Cyphal the same release is `CAL_ABORT` (0xA00D).

  The solve preserves the RMS field radius, and the procedure runs mounted in the vehicle. The iron the fit removes belongs to the installation, not the unit.

Accelerometer calibration is a host-side procedure: a gravity-magnitude fit (per-axis scale and offset) over six poses, checked against two held-out poses. The `nxs` tool solves it and uploads it through the ordinary record write, Integration Manual §4.9. There is no dedicated reset command. Writing the identity record with the orientation field kept, then persisting it, is the reset, and `nxs calibrate reset` performs exactly that.

### 6.10 Build identity

The firmware's exact build is served as its `git describe` string, `vMAJOR.MINOR.PATCH-N-gSHA`. `N` counts commits above the release tag and `SHA` is the short commit hash. `-dirty` is appended when the image was built from an uncommitted tree. The record is 64 bytes, NUL-padded, read-only.

1. With `XFER_TYPE` and `STORE_SELECT` saved, write `XFER_TYPE` = 5.
2. Read page 0 through the `PROGRAM_DATA` window. If no NUL byte appeared, select page 1 via `STORE_SELECT` for the remainder.
3. Restore both registers. Restore `XFER_TYPE` to its prior value rather than 0, so a flow parked on that mode keeps its `PROGRAM_DATA` consumer. Mode writes leave `CMD_ERROR` untouched, so it may still hold an unread command verdict.

The string is the same value the Cyphal `aliensense.nxs.fw.describe` register serves, and the SDK's `read_fw_version()` returns it verbatim on every transport. Firmware whose `PROGRAM_DATA` window does not answer the mode serves the numeric pair through `FW_VERSION_MAJOR`/`FW_VERSION_MINOR` (§3) instead.

### 6.11 Cam personality

A cam personality is an NXS image of kind CAMERA (§10.1). It holds the sensor's probe and configure programs as VM bytecode, and the enum parameters that select a mode and a trigger conversion. It also holds a descriptor trailer the device stores without interpreting. It is uploaded and saved like any personality (§6.1, §6.5) and occupies a store slot.

The runner never auto-loads a CAMERA slot. The device runs it only on request, on a second VM instance bound to the pod-side bus. The main VM meanwhile keeps serving the click personality in its own slot.

Run:

1. Stage the run's parameters: `STORE_SELECT` = slot, `CMD` = `PEEK_SLOT`. Then per parameter `PARAM_SELECT` = its index and `PARAM_SET_VALUE` = the value (u32). The stored image never changes. The run's program copy takes the values, and the run consumes them.

   The parameter indices and the value of each mode and trigger conversion come from the personality's descriptor trailer (below). They never come from parameter names, which the peek view does not serve. A stage holds one value per parameter and survives a refused run. Peeking another slot drops it. A run starts with every parameter at its staged value or its compiled default. Its program may store a parameter, which is how a personality reports the value it achieved for a requested one.

   After a run reaches DONE, `PARAM_SET_VALUE` under the slot's peek view serves those ending values until the next run of any slot starts.
2. Write the slot to `STORE_SELECT` and `CMD` = `CAM_RUN`. Poll `CMD_ERROR` for acceptance (§5).

   The device accepts the command before it takes the bus. The acceptance is usually only readable once the run has ended (step 4). Poll it against the run's own budget, not the store-command timeout. A run that ends before the host reads the acceptance leaves its verdict in `CMD_ERROR`, and a refused command paints no state.

   Read the `CAM_RUNS` counter of the diag view (§12.1) before the command. A nonzero `CMD_ERROR` is the run's verdict when `CAM_RUNS` has advanced by one, and the command's refusal otherwise. An advance by one means the run was accepted and `CAM_STATE` reached a terminal state whose `CAM_ERROR` is the same errno. On firmware that predates `CAM_RUNS` the count never advances. A terminal state that differs from the one read before the command is the verdict instead. A run that ends the way the previous one did then reads as the refusal.
3. After the hold-off in step 4, poll `CAM_STATE`. It reads LOADING. It reads PROBING while the program counter sits inside the image's probe program, the alive or identity check (§10.1). It reads CONFIGURING from its end, and a terminal DONE, PROBE\_FAILED, FAULTED, or ABORTED last.

   A failed run takes the name of the phase its own instruction belongs to. A probe that writes before it reads and a configure whose first write fails therefore each report correctly. The device re-asserts a terminal state while it idles, so a host that polls late still reads it. `CAM_ERROR` carries the terminal errno. While the run holds the session `XFER_PHASE` mirrors the state and `XFER_ACK` the program counter's low byte. The verdict lands in `CMD_ERROR` on the terminal edge, in the poll that first observes it (§6.9).
4. Between the accepted `CAM_RUN` and the terminal edge the device is the bus master. **The host addresses nothing on that bus**, not the sensor, and not the device's own register map. The host holds off for the run and reads afterwards.

   The register map and the sensor share one I²C peripheral on one segment, so the map answers only between the run's own transactions. A host transaction that lands inside one is a second master. It fails the transfer the device was making, and the run retries that transfer and re-registers its target, at the retry ladder's cost in time. `CAM_STATE` holds a terminal value until the next `CAM_RUN`, so waiting misses nothing. `CMD_ERROR` holds the run's verdict from the terminal edge on: the errno `CAM_ERROR` carries, 0 for DONE. A refused command held the bus for no run, and its refusal stays in `CMD_ERROR` (step 2).

   How long to hold off is the caller's estimate of the program plus margin, and `nxs` uses two seconds. After that the poll costs nothing, because the bus is free once the run ends.

`CAM_ABORT` stops a run within 50 ms of the device receiving the command, one register transaction aside. The command has to reach the device first, and a run worth aborting is a run holding the bus. The write itself is therefore NAKed until a gap opens and the host repeats it. Once it lands, a register operation inside the run is retried 5 times, 50 ms apart. The wait between attempts is interruptible, so the abort bound holds however many retries are in flight. A register operation that fails every attempt faults the run with `EIO`.

A hard `POLL_REG` that times out faults with `ETIMEDOUT`, and a soft one records the miss and continues. A personality whose declared I²C clock ceiling is below the pod bus's rate is refused with `ENOTSUP` before the run touches the sensor.

Personality info lives under `XFER_TYPE` = 6 and 7. A write of `slot << 5 | page` to `STORE_SELECT` is queued like a command. `CMD_ERROR` reads `CMD_ERR_PENDING`, then `0` or an errno. The errno is `ENOEXEC` for a click personality's slot, `EBADF` for a cam personality that does not parse, `ENOENT` for an empty slot. `ENODEV` means the device has no personality store.

After that the `PROGRAM_DATA` window serves 32 bytes of that slot's descriptor trailer (§10.1), zeros past its end. The offset is `32 × page` under 6 and `32 × (32 + page)` under 7. The two banks of 32 pages cover the whole trailer, and the trailer's count byte and record lengths say where it ends. The bytecode is never served. Restore `XFER_TYPE` before `STORE_SELECT` after a read, so the restored select is a plain slot selection (§6.10).

## 7. Firmware update

### 7.1 Model

The device keeps two firmware slots (A/B). An update stages the new image into the update slot. `DFU_FINISH` checks that the staged bytes form a complete MCUboot image, marks the swap pending, and reboots. The new image boots in a probationary TEST state and self-confirms after 1 s of healthy main-loop execution with the host link initialised. That is the default build, and the window is a build option (§7.2). An image that faults, hangs (3 s hardware watchdog), or otherwise fails to confirm is automatically reverted on the next reset.

The previous firmware then returns without host intervention. The application arms the watchdog at 3 s. The bootloader re-arms it on a 30 s window and feeds it during the swap and in recovery. A hang anywhere in the update therefore resets the device instead of leaving it stuck. A power loss mid-swap resumes or reverts cleanly, and no sequence in this section can brick the device.

```d2 title="The firmware update over I²C, from the claim to the confirmed image"
# The firmware update over I²C (Interface Description §7.1, §7.3): the staged
# image, the acknowledged chunks, the reboot into the swap and the confirm.

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

shape: sequence_diagram

host: Host
unit: NXS unit (application)
boot: MCUboot

claim: "1. Claim the DFU consumer" {
  host -> unit: "write XFER_TYPE = 1"
  host <- unit: "read XFER_TYPE: 1 echoed"
}

begin: "2. Open the session" {
  host -> unit: "write CMD = DFU_BEGIN"
  unit -> unit: "erase the staging slot (about 2.5 s, bus held off)"
  host <- unit: "CMD_ERROR: 0, XFER_PHASE: READY (or EPROTO, EBUSY)"
}

chunks: "3. Push the image, chunk k of up to 32 bytes" {
  host -> unit: "write PROGRAM_DATA (chunk k)"
  host <- unit: "XFER_ACK: (k + 1) mod 256 (still k: resend the same bytes)"
}

finish: "4. Finish" {
  host -> unit: "write CMD = DFU_FINISH"
  unit -> unit: "check the staged MCUboot image, arm the swap"
  host <- unit: "XFER_PHASE: FINISHING, then the reset drops the bus (ERROR: errno in CMD_ERROR, then XFER_ABORT)"
}

swap: "5. Reboot and confirm" {
  unit -> boot: "reset"
  boot -> unit: "swap, boot the new image in the TEST state"
  unit -> unit: "self-confirm after 1 s of healthy execution, or CONFIRM_FW from the host"
  boot -> unit: "unconfirmed at the next reset: swap the previous image back"
}
```

Firmware images are signed, and the bootloader only swaps to an image whose signature verifies. That is build-gated, and development builds may run unsigned.

While a session is open the device halts sensor sampling and refuses the VM-control claim to any other transport (§7.5). A command from another transport is silently dropped and must be retried. Sampling resumes after an abort, after the reboot that ends a successful update, or once the claim is released (§7.5).

### 7.2 Update over Cyphal (file pull)

Over Cyphal the device is the *client*. A host command names a path, and the device pulls the image from a file server with standard `uavcan.file.Read` (fixed port 408) requests. The host serves the file, and it issues no per-chunk writes. The same pull engine delivers both a firmware image and a personality image. Only the trigger, the server selection, and the completion action differ.

#### Trigger and server selection

| Trigger | Image | Sink | File server |
|---|---|---|---|
| `ExecuteCommand` `BEGIN_SOFTWARE_UPDATE` (65533) | firmware | DFU slot | the commanding node (request's source node-ID) |
| `ExecuteCommand` `LOAD_FROM_FILE` (`0xA000`) | personality (NXS) | staging buffer | `aliensense.nxs.file_server_id` register if non-zero, else the commanding node |

Both commands carry the server-side path in the ExecuteCommand `parameter` field (`uavcan.file.Path`, ≤ 255 bytes). For `BEGIN_SOFTWARE_UPDATE` the server is always the node that sent the command, the contract `yakut --update-software` relies on. For `LOAD_FROM_FILE` the server defaults to the commanding node so a single-node tool works with no configuration. Writing a non-zero node-ID to `aliensense.nxs.file_server_id` (natural16, range 0–127) redirects the personality pull to a dedicated server. A value of 0 (the default) selects the commanding-node fallback. The resolved server must be a valid node-ID (0–127).

A fallback to an anonymous or out-of-range commanding node is rejected with `STATUS_FAILURE` rather than issuing a Read to a bad node. Such a fallback is possible on the serial link, where a service request is not gated to a valid source node-ID.

The ExecuteCommand reply is sent before the pull does any work. A trigger that starts a pull returns `STATUS_SUCCESS` (0) immediately, and the transfer then proceeds in the background on the device. Pull progress and failure are observed through the node Heartbeat and the `aliensense.nxs.cmd_error` register, not through the ExecuteCommand reply. The Heartbeat mode is `SOFTWARE_UPDATE` while a firmware pull is active, and a personality pull keeps `OPERATIONAL` (see §7.1's session model). While a pull is live that register carries the pull's `CMD_ERR_PENDING` sentinel. A store, `COMMAND_STORE_PERSISTENT_STATES`, `CONFIRM_FW`, calibration command, or second pull trigger from any link is therefore refused in its reply (`STATUS_FAILURE`) and leaves the register untouched.

#### Pull loop

The device requests the file as offset-addressed chunks of at most 256 bytes (the `uavcan.primitive.Unstructured` array capacity that carries `uavcan.file.Read.Response.data`). Exactly one Read is in flight at a time.

On each in-order response the chunk is written to the sink at the request's offset. The offset advances by the byte count returned, and the next Read is issued at the new offset. A response whose `data` array is shorter than 256 bytes marks end-of-file: the device commits the sink and the pull ends. A full 256-byte response is never the last chunk. A file that is an exact multiple of 256 bytes terminates with a final zero-length read.

Chunks are required to arrive strictly in ascending order. A write whose offset does not equal the running received-byte count is refused rather than assembled into a holed image, which fails the pull.

#### Timing and retry

| Parameter | Value |
|---|---|
| Read timeout | 1 s (checked continuously by the device, so a retry lands about 1 s after the Read) |
| Max retries per offset | 5 |

If no matching response arrives within 1 s of issuing a Read, the device re-issues the Read at the **same** offset. A `uavcan.file.Read` at a given offset is idempotent, so a lost request or a lost response recovers without disturbing the sink or the host-side server. The retry counter resets to zero each time a chunk lands and advances the offset. Six consecutive timeouts at one offset (the initial Read plus five retries) exhaust the budget and abort the pull. With a dead server that is about 6 s after the last response.

#### Failure conditions

Any of the following fails the pull. On failure the sink is aborted (the staged image is discarded) and the internal state becomes `FAILED`. The device resumes sensor sampling. None of these conditions reboots the device or alters the running firmware/personality.

| Condition | Cause |
|---|---|
| Path too long | command `parameter` exceeds 255 bytes (`-ENAMETOOLONG`) |
| Sink rejected the open | firmware/personality staging declined `begin` (staging unavailable, for example an update already in progress) |
| Request TX failed | the Read could not be enqueued or sent on the transport |
| Server Read error | the response's `error` field is non-zero (path not found, I/O error, …) |
| Malformed response | the `uavcan.file.Read.Response` failed to deserialize |
| Write failed | the sink rejected a chunk (flash program error, out-of-order offset, overflow) |
| No response | the retry budget for one offset was exhausted |

#### Completion

The completion action is fixed by which trigger started the pull:

* **Firmware** (`BEGIN_SOFTWARE_UPDATE`): end-of-file checks that the staged bytes are a complete MCUboot image and arms the MCUboot swap, so the staged image becomes swap-pending. The device then reboots into §7.1's probationary TEST flow. The reboot arrives seconds after the ExecuteCommand reply has drained, so it is not observable as a failed command. A file that is not an MCUboot image, a raw `zephyr.bin`, resolves `aliensense.nxs.cmd_error` to `ENOEXEC` (8). One that ends before the length its header declares resolves to `ENODATA` (61). Neither reboots.
* **Personality** (`LOAD_FROM_FILE`): end-of-file loads the assembled NXS personality. The personality structure is activated but **not** started, and the device does not reboot. Starting it is a separate `RUN` (`0xA001`) command (§6), mirroring the upload-then-run split of the I²C personality path.

#### One pull at a time

The device holds the state of a single transfer. A second provisioning trigger, firmware or personality, received while a pull is active is rejected with `STATUS_FAILURE` (1) and leaves the in-flight pull untouched. The host waits for the active pull to finish (Heartbeat mode returns to `OPERATIONAL`) before starting another.

#### No image-size ceiling

The pull places no upper bound on image length. The service transfer-ID that tags each Read is 5 bits on Cyphal/CAN (wraps every 32 transfers, ~8 KiB). It is an 8-bit counter on Cyphal/serial (wraps every 256 transfers, ~64 KiB). The device matches each response against the in-flight request modulo that field, so a pull continues correctly across every wrap.

The only size limit is the capacity of the update slot (221,184 bytes, §11) or the personality staging buffer. The pull opens the sink with the total size unknown, so an oversize image is not declined at `begin`. It fails at the first write past the capacity, aborting the pull.

#### Confirming the image

After the swap the new image runs in MCUboot's TEST state. Unless something confirms it before the next reset, MCUboot swaps the previous image back. The image confirms itself once its main loop has run for the self-confirm window with its host link initialised. The window is a build option, 1 s on the default build. A supervised build sets a long window, and the host confirms explicitly with `CONFIRM_FW` once it has validated the image end to end. The command is I²C `Cmd` 21, Cyphal ExecuteCommand `0xA00E`, or `nxs confirm-fw`.

The window is the safety net for a supervisor that never does, and a window of `0` removes it, leaving `CONFIRM_FW` as the only confirmation. `CONFIRM_FW` is idempotent and harmless on the default build. Over I²C it is refused `EBUSY` while an update session or an on-device procedure holds the status registers (§5).

### 7.3 Update over I²C

1. Write `XFER_TYPE = 1`, with a readback. A live transfer session refuses the write silently, and the readback is the claim check.
2. Write `CMD = DFU_BEGIN` and poll `CMD_ERROR` out of `CMD_ERR_PENDING`, straight through the erase. An accepted begin bulk-erases the staging slot first, stalling the device ~2.5 s with the bus held off. Transactions stretch or fail meanwhile, so keep polling. The verdict lands after the erase: `0` with `XFER_PHASE` already READY. `EPROTO` means `XFER_TYPE` is not 1, and `EBUSY` means a session is live. A second `BEGIN` never restarts a running push, so release deliberately with `XFER_ABORT`.
3. `XFER_PHASE` reads ERROR instead: the erase failed. Read `CMD_ERROR`, abort.
4. For each chunk k = 0, 1, 2 …: write up to 32 image bytes to `PROGRAM_DATA`. Poll `XFER_ACK` until it reads (k+1) mod 256. The chunk carries no offset. The device appends at its own cursor, exactly one chunk may be in flight, and the counter is the acknowledgement. If the counter stalls past a timeout, re-read it. Still k means the device dropped the chunk, so resend the same bytes, and k+1 means it landed.

   Resending a landed chunk is impossible to confuse with a lost one, and out-of-order delivery cannot occur. A chunk that would run past the update slot's capacity (221,184 bytes, §11) is refused `ENOSPC`. A chunk with no DFU session open is refused `ENOENT` and not acked.
5. `XFER_PHASE` = ERROR at any point: the failed chunk did not commit. `CMD_ERROR` holds the reason, and the session stays latched so the detail survives until a read takes it. Release with `XFER_ABORT`. Restart with `DFU_BEGIN`.
6. Write `CMD = DFU_FINISH`. The device checks that the staged bytes are a complete MCUboot image. It checks the header magic, the TLV trailer, and the declared length within the staged bytes. Success shows in the reboot, not in the write's ACK. The device publishes `XFER_PHASE = FINISHING`, after which the reset drops the bus. A NACK on the tail of this transaction is that reset, not an error.

   A finish dropped before dispatch at a full command queue instead leaves the bus alive with `XFER_PHASE` unchanged. Resend it. `XFER_PHASE = ERROR` is a failed finish, latched without a reboot. Read `CMD_ERROR`, then release the session with `XFER_ABORT`. `ENOENT` means no session open. `ENOEXEC` means the staged bytes are not an MCUboot image, so push `zephyr.signed.bin`.

   `ENODATA` means fewer than a full header was staged, or the image ends before the length its header declares. The flush already closed the staging session on the device, and sampling resumed. Recovery is therefore always `XFER_ABORT` then a fresh `DFU_BEGIN`, never a resend onto the same session.
7. To abort a session, write `CMD = XFER_ABORT` (§5). The device resumes sensor sampling, progress registers reset to IDLE/0, and `XFER_TYPE` resets to 0. `PROGRAM_DATA` reverts to the personality-upload path. An abandoned session (host crash) releases itself after 2 s of silence when another command contends. On its own it releases after 6 s. A host's chunk retries fit inside that budget.

### 7.4 Recovery

A device whose application firmware is damaged beyond the revert path recovers through MCUboot serial recovery (mcumgr / SMP over UART). A device in recovery **holds there** until an upload completes, so no host has to catch a boot-time window: run `mcumgr` / `smpmgr image upload`, then `smpmgr os reset`. The status LED shows two dark winks per second throughout ([Device Reference §2.3](../nxs-device-reference/)).

Recovery runs the host UART at **115200 8N1**, not the 460800 the application uses (§8.1). That is the default rate of every mcumgr client, so the upload command needs no baud option. A client pinned to 460800 sees no response at all, because the bootloader is not listening at that rate.

The bootloader answers the SMP commands recovery needs: image list, image upload, console echo control, and reset. It returns `MGMT_ERR_ENOTSUP` (8) for anything else, including `os echo` and `slot info`, so check the link with `image list`. The optional `MCUMGR_PARAMETERS` query is among the unsupported commands, so a client that issues it at connect time logs one warning and proceeds. The values it would have returned are a 128-byte line length and 8 line buffers, giving a 1024-byte maximum frame. A client that defaults to fewer buffers uploads correctly but slower. Passing the buffer count explicitly (`--line-buffers 8` on `smpmgr`) restores the intended frame size.

A recovery upload writes the application slot directly and no swap follows. An image still staged in the update slot by an interrupted update takes precedence. The bootloader applies that swap at the next boot before it consults the recovery flag, so the staged image swaps over the uploaded one. It reverts again only if it fails to confirm. No UART procedure recovers from the states that need SWD. They are a corrupted bootloader region, a flash ECC double error inside a slot header or trailer, and RDP level 2.

Three entrances reach that state, covering successively worse failures.

| Entrance | Applies when |
|---|---|
| `ENTER_RECOVERY`, I²C `Cmd` 14 (§3), or the vendor ExecuteCommand `0xA008` on Cyphal | the application still answers on a host transport. `nxs recover` on either transport arms the flag and cold-resets: over I²C the reset itself is the acknowledgement (§5), over Cyphal the reply precedes it. A failed flag write keeps the device in the application: the errno in `CMD_ERROR` over I²C, `STATUS_FAILURE` over Cyphal |
| Bridging mikroBUS `RST` to `CS` in place of a Click board, then resetting | the application boots but stops answering. The bridge is read once at reset. Remove it and the unit boots normally |
| Resetting a unit whose application slot holds no valid image | the image is erased, unsigned, or corrupt. No action beyond power is needed, since the unit cannot leave recovery until an image is uploaded |

The command dispatches independently of the personality runner, so it reaches a device whose personality never loaded. Recovery is a last resort, and the validated update path is §7.2/§7.3.

### 7.5 Transport arbitration (cross-transport)

The device accepts host commands on three transports, the UART host link, I²C (§3), and Cyphal/CAN-FD, and arbitrates VM-control authority. At most one transport drives control or a staged update at any instant. Egress is not arbitrated. Liveness, status, and the sample stream emit on their transport unconditionally, independent of which transport holds the control claim.

**Claim.** The arbiter is idle at boot. The first host command on an idle arbiter claims control for its transport. A command on the transport that already holds control refreshes the claim. A command on a different transport takes over control only if the current holder has no session in flight. Otherwise it is rejected.

**Reject.** A command rejected because another transport holds an in-flight session is **dropped without a reply**. On I²C the register file still tells the truth. A rejected op that had armed `CMD_ERROR` resolves to `EBUSY`, so a polling host fails immediately and by name. A rejected plain write is lost. On the reply-carrying transports the host distinguishes the drop only as a timeout and must retry.

Every reject is counted, and the `INGRESS_REJECTS` fault counter (§12) is the wire-visible evidence. I²C register reads and the diagnostic-view selectors (§12.1) both bypass the arbiter claim. The losing I²C host can therefore select the diag view and read it while still being rejected. The Cyphal copy (`aliensense.nxs.ingress_reject_count`) refreshes at the ~100 ms status cadence. Cyphal register reads do claim the arbiter, so it becomes readable there once the session ends.

**Idle release.** A held claim auto-releases after **5 s** of holder silence. Release is evaluated on the next command from another transport. A holder that keeps issuing commands (or, for a file pull, keeps receiving responses) holds control indefinitely. The cross-transport lock is therefore time-bounded: a holder that goes silent for 5 s is preempted on the next competing command, even mid-session.

**Session.** A session is the in-flight state the device must not let a competing transport interrupt:

| Transport | A session is in flight while |
|---|---|
| I²C | a DFU staging session is open (§7.3), a chunked personality-image upload is in progress (§6.1), or a host-commanded calibration procedure is running (§6.9). The boot-time gyro pass is not a session: it yields to every host claim, so it never holds the transport |
| Cyphal (serial / CAN-FD) | a DFU session is active, a `uavcan.file` pull (firmware or personality) is active, or a host-commanded calibration procedure is running (§6.9) |

While any session is in flight on one transport, host commands on the other transports are rejected per *Reject* above. This is the cross-transport counterpart to the same-transport rule in §7.1. A long file pull keeps its claim alive through per-response progress, so it is not preempted mid-transfer. If the pull stalls, control is released within 5 s.

```d2 title="The transfer session, from free to released"
# The transfer session that owns the PROGRAM_DATA mux (Interface Description
# §6.1, §7.3, §7.5): one holder at a time, from the claim to the release.

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

direction: down

classes: {
  state: {style: {fill: "#e3ecf7"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14; border-radius: 8}}
  live: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 2; font-size: 14; border-radius: 8}}
  error: {style: {fill: "#f8d7d7"; stroke: "#a13a3a"; stroke-width: 2; font-size: 14; border-radius: 8}}
}

free: "Free\nXFER_TYPE = 0\nthe PROGRAM_DATA mux unowned" {class: state}
claimed: "Claimed\nXFER_TYPE echoes the mode:\n0 bytecode, 1 firmware, 2 identity, 3 time sync,\n4 calibration, 5 build identity, 6 and 7 personality info\n(a write while another holder's session is open\nis refused silently)" {class: state}
live: "Live session\na personality upload, a firmware push,\na calibration procedure or a camera run\nthe mux is reserved, a store command reads EBUSY,\nanother transport's commands are rejected" {class: live}
error: "Error latched (firmware push)\nXFER_PHASE = ERROR\nthe errno in CMD_ERROR" {class: error}

free -> claimed: "write XFER_TYPE = mode,\nread it back"
claimed -> live: "PROGRAM_SIZE announce (CMD_ERROR 0),\nDFU_BEGIN, CAL_GYRO, CAL_MAG_START\nor CAM_RUN"
live -> free: "LOAD, the reboot of DFU_FINISH,\nXFER_PHASE back to idle,\nthe camera run's terminal edge,\nor XFER_ABORT\nstale: 2 s of holder silence under contention\n(the partial stage discarded),\n6 s on its own for a firmware push"
live -> error: "a chunk or DFU_FINISH fails"
error -> free: "XFER_ABORT"
```

## 8. UART transport

The UART carries the Cyphal/serial host link (§8.2). The electrical link is described in §8.1, the protocol framing in §8.2.

### 8.1 Link

8 data bits, no parity, 1 stop bit, no flow control. 460800 baud, with the UART hardware FIFO enabled so the link sustains a full 250 Hz sample stream without dropped frames.

### 8.2 Cyphal/serial host link

On the UART the NXS is a Cyphal node, decodable by yakut / pycyphal without proprietary tooling. The electrical link is §8.1 (460800 baud, 8N1). I²C (§3) is unaffected. Firmware update and personality delivery run over this link via a standard `uavcan.file.Read` pull (§7.2). I²C update and recovery (§7.3, §7.4) remain available.

Node identity is name `com.aliensense.nxs`, node-ID `125` by default (register `uavcan.node.id`, commissioned to deconflict a CAN mesh, §8.2.7). Device behaviour (VM states, personality store, DFU model) is identical across the host transports (§1). Vendor DSDL types and registers live in the `aliensense.nxs` namespace. `axon` is the compute board's design name, fixed on the wire for compatibility. A host that consumes only the standard `uavcan.si.sample.*` subjects never references it.

#### 8.2.1 Frame format

The host link carries one Cyphal/serial transfer per frame. A host integrator builds a frame from the constants in this section without proprietary tooling. The wire is byte-identical to pycyphal's serial transport.

Single-frame transfers only. There is no segmentation, no reassembly, and no session table on the link. Every transfer fits one frame and is delivered or dropped whole.

**Frame structure.**

```
0x00 | COBS( header[24] | payload[0..512] | transfer_crc[4] ) | 0x00
```

A frame is a COBS-encoded body bracketed by `0x00` delimiters, one leading and one trailing. The body that COBS encodes is the 24-byte header, the serialized DSDL payload, and a 4-byte transfer CRC, in that order. Maximum payload is 512 bytes.

**COBS framing.** Consistent Overhead Byte Stuffing removes every `0x00` from the body so the `0x00` delimiter is unambiguous. The encoder emits the trailing delimiter, and the leading delimiter is prepended, reproducing pycyphal's `0x00 | COBS | 0x00`. The decoder skips one or more leading `0x00` bytes, since a delimiter may be shared with the prior frame on the wire. It then requires the body to end in the trailing `0x00`. A `0x00` inside the decoded body, a zero COBS code byte, or a run length that overruns the body fails the decode.

#### 8.2.2 Header (24 bytes)

The header is a 22-byte little-endian field block followed by a 2-byte CRC-16/CCITT-FALSE. Every multi-byte field is **little-endian except the header CRC**, which is the sole big-endian field.

| Offset | Width | Endian | Field | Value / Notes |
|---|---|---|---|---|
| 0 | 1 | — | `version` | `0x01`. A frame with any other value is dropped. |
| 1 | 1 | — | `priority` | 8-bit Cyphal priority level (0 = Exceptional … 7 = Optional). The byte is carried verbatim, and the codec does not validate or clamp it. |
| 2 | 2 | LE | `source_node_id` | Sender node-ID. `0xFFFF` = anonymous. |
| 4 | 2 | LE | `destination_node_id` | Target node-ID. `0xFFFF` = anonymous / broadcast (messages). |
| 6 | 2 | LE | `data_specifier` | Subject-ID or service-ID plus role bits, see §8.2.3. |
| 8 | 8 | LE | `transfer_id` | 64-bit transfer-ID. On receive only the low 8 bits are consumed (§8.2.6). |
| 16 | 4 | LE | `frame_index_eot` | Frame index with bit 31 = End-Of-Transfer. Single-frame: always `0x80000000`. |
| 20 | 2 | LE | `user_data` | Reserved, `0x0000`. A nonzero value is dropped. |
| 22 | 2 | **BE** | `header_crc` | CRC-16/CCITT-FALSE over bytes 0–21, appended **big-endian** (byte 22 = high, byte 23 = low). |

**Header CRC.** CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, non-reflected input and output, final XOR `0x0000`. Computed over header bytes 0–21 and appended big-endian. The receiver validates by computing the same CRC-16 over all 24 bytes (struct + appended CRC) and requiring the residue to equal `0`. A nonzero residue drops the frame.

#### 8.2.3 data\_specifier bit layout

The 16-bit `data_specifier` encodes the transfer role and the port-ID.

| Bit(s) | Mask | Meaning |
|---|---|---|
| 15 | `0x8000` | Service-not-message. Set = service transfer, clear = message transfer. |
| 14 | `0x4000` | Request-not-response. Set = request, clear = response. Defined only when bit 15 is set. |
| 14:0 | `0x7FFF` | Subject-ID, when bit 15 is clear (message). 15-bit field. |
| 13:0 | `0x3FFF` | Service-ID, when bit 15 is set (service). 14-bit field. |

Encoded role values:

| Transfer | `data_specifier` |
|---|---|
| Message | `subject_id` |
| Request | `service_id \| 0xC000` |
| Response | `service_id \| 0x8000` |

The receiver classifies on the role bits. Bit 15 set selects service (request when bit 14 set, else response) and masks the port-ID with `0x3FFF`. Bit 15 clear selects message and masks with `0x7FFF`.

#### 8.2.4 Transfer CRC

Every transfer, single-frame included, appends a 4-byte transfer CRC after the payload, inside the COBS body.

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
| Nonzero user\_data | Bytes 20–21 ≠ `0x0000`. |
| Bad transfer CRC | CRC-32C over the payload ≠ the appended little-endian value. |
| Misaddressed service | Service transfer whose `destination_node_id` is not this node's ID. |
| Out-of-range source | Non-anonymous `source_node_id` > `127` (would alias the 7-bit `CanardNodeID`). |

#### 8.2.6 Node-ID mapping

The wire carries 16-bit node-IDs. A transfer maps onto libcanard's 7-bit `CanardNodeID` (`CANARD_NODE_ID_MAX` = 127).

| Wire `source_node_id` | Mapped `CanardNodeID` |
|---|---|
| `0xFFFF` | `CANARD_NODE_ID_UNSET` (255), anonymous. |
| `0`–`127` | The value, cast to `CanardNodeID`. |
| `128`–`0xFFFE` | Frame dropped (out-of-range source, §8.2.5). |

The `transfer_id` header field is 64-bit, but only its low 8 bits are taken into the Canard transfer on receive (`CanardTransferID` is 8-bit). A transmitter populates the full 64-bit field. The upper bytes are not consumed by the receiver.

**Served ports.**

| Port | Type | Function |
|---|---|---|
| Heartbeat | `uavcan.node.Heartbeat` (subject 7509) | 1 Hz. Health and mode track the VM error state and the DFU session |
| GetInfo | `uavcan.node.GetInfo` | device identity, with the response fields detailed under **Device identity** below |
| Registers | `uavcan.register.Access` / `.List` | read/write the registers below |
| Command | `uavcan.node.ExecuteCommand` | `COMMAND_RESTART`, 65535, reboots. `COMMAND_STORE_PERSISTENT_STATES`, 65530, validates and commits staged config (§8.2.7). `COMMAND_BEGIN_SOFTWARE_UPDATE`, 65533, and vendor `LOAD_FROM_FILE`, 0xA000, trigger a file pull (see Provisioning). Vendor `RUN` 0xA001 / `STOP` 0xA002 run / halt the personality. `SAVE` 0xA003 / `DELETE_SLOT` 0xA004 / `CLEAR_STORE` 0xA005 / `CYCLE` 0xA006 manage the store, with the slot in `parameter[0]`. `RESET` 0xA007 unloads the personality. `ENTER_RECOVERY` 0xA008 arms MCUboot serial recovery and reboots into it, where the device holds until an upload completes (§7.4). `IDENTIFY` 0xA009 strobes the status LED (~10 s) to physically locate the unit. `CONFIRM_FW` 0xA00E confirms the running image so MCUboot keeps it across the next reset (§7.2). `CAL_GYRO` 0xA00A starts the on-device gyro still-average. `CAL_MAG_START` / `CAL_MAG_STOP` 0xA00B / 0xA00C bracket the mag collection. `CAL_ABORT` 0xA00D drops any procedure in progress without solving, and the previous calibration stays. It fails with ENOENT when nothing is running (§6.9). Unknown commands return `STATUS_BAD_COMMAND`. A `STATUS_FAILURE` from a store, provisioning, or config-commit command leaves its reason in `aliensense.nxs.cmd_error` |
| Output descriptors | `aliensense.nxs.GetOutputInfo` (service 256) | output-field descriptors, the same data the I²C window serves (§6.6), with full-precision `float64` scale/offset and the field byte position (`byte_off`) |
| Param descriptors | `aliensense.nxs.GetParamInfo` (service 257) | per-parameter descriptor: name, unit, allowed-value set, default, current value |
| Personality snapshot | `aliensense.nxs.GetDriverInfo` (service 258) | full personality snapshot the host `read_*` getters poll: name, `sample_size`, `store_count`, vm / runner state, error code, probe retries, … (`slot` 0xFF = active). With no active personality the snapshot still answers: an empty name, zero descriptors, live store and runner state. Store contents therefore stay readable on a device that has not loaded anything |
| Samples | `aliensense.nxs.RawSample.0.1` (subject 6144 default) | sample stream. Each message carries `timestamp_us`, `seq`, and ≤ 128 bytes of `data` |
| Status | `aliensense.nxs.Status.0.1` (subject 6145 default) | 1 Hz telemetry push: vm / runner state, active slot, error counters, sample count, free slots |
| Diagnostics | `uavcan.diagnostic.Record` (subject 8184, fixed) | firmware log lines at or above the severity floor (default WARNING), forwarded at Low transfer priority. Up to four records go per second, so data-plane traffic always wins arbitration. The floor is runtime-tunable via `uavcan.diagnostic.severity` |

**Type evolution.** The vendor service types and `Status` are delimited with declared extents, so a minor version bump may append fields within the extent. The extents are 48 bytes for service requests, 128 for `Status` and the `GetDriverInfo` / `GetOutputInfo` responses, 256 for the `GetParamInfo` response. An older consumer reads the prefix it knows and ignores the rest, and a newer consumer zero-fills fields an older sender does not emit. Firmware and host tooling therefore tolerate version skew in both directions across an update wave. `RawSample` is sealed: its payload is opaque bytes decoded through the `GetOutputInfo` descriptors, so sample-schema evolution happens in the descriptor, not the DSDL type.

| Register | Access | Value |
|---|---|---|
| `uavcan.node.id` | read/write, persistent | `natural16`, the node-ID, commissioned to deconflict a CAN mesh. A CAN read reports the effective ID (the compiled default `125` when uncommissioned). A serial read reports the fixed point-to-point link address `125`. Applies at the next reboot (§8.2.7) |
| `uavcan.can.bitrate` | read/write, persistent | `natural32[2]`, the CAN bit-timing profile `[arbitration, data]` in bit/s. Equal rates select Classic CAN, MTU 8 with no bit-rate switch. `data > arbitration` selects CAN FD, MTU 64. Reads the staged profile, or the compiled default `[1000000, 4000000]` when uncommissioned. A single-element write `[v]` means Classic `[v, v]`, and `[0, 0]` reverts to the compiled default. Applies at the next reboot (§8.2.7) |
| `uavcan.pub.<name>.id` | read/write, persistent | `natural16`, the subject-ID for one published topic. `<name>` ∈ {`sample`, `status`, `acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`, `gnss`, `scalar`}. Reads the effective subject-ID (the vendor-fixed default when uncommissioned). `0` disables the topic. Applies at the next reboot |
| `aliensense.nxs.decimation` | read/write, persistent | `natural16`, the device-output gate: `0` = off, `1` = every sample (default), `N` = every Nth. Live on write, committed by Save |
| `aliensense.nxs.decimation.<subject>` | read/write, persistent | `natural16`, the per-subject SI refinement on top of `decimation`. `<subject>` ∈ {`acceleration`, `angular_velocity`, `magnetic_field`, `temperature`, `pressure`, `scalar`}. `0`/`1` = every sample, `N` = every Nth. `scalar` gates the whole single-value SI block (angle, voltage, speed, …) with one factor. `temperature` defaults to 25, the rest to 1. Live on write, committed by Save |
| `aliensense.nxs.file_server_id` | read/write | `natural16`, the node-ID the personality pull (`LOAD_FROM_FILE`) fetches from. 0 (default) = the commanding node. RAM-only |
| `aliensense.nxs.sample_fifo.depth` | read/write, persistent | `natural16`, the records the I²C sample FIFO retains before it overwrites the oldest (§6.3). `0` = all the storage holds (default). Live on write, committed by Save |
| `aliensense.nxs.can_term` | read/write, persistent | `natural16`, the on-board CAN split-termination selection: `0` = off (the uncommissioned default), `1` = on, `0xFFFF` = revert to the default. Applies live (§8.2.7), and reads mirror the effective state. The Cyphal face of the I²C `CAN_TERM` register (§4) |
| `aliensense.nxs.time_us` | read-only | `natural64`, the device µs clock at request service time, the two-way time-sync surface (§6.8) |
| `aliensense.nxs.time_sync` | read/write, volatile | `integer64`. Write `[offset µs, bound µs, rate ppb]` to discipline the synced timescale as a host source, and read `[offset, bound, rate, source]` (§6.8). Source decays to 0 when the discipline goes stale |
| `aliensense.nxs.cmd_error` | read-only | `natural16`, the result of the most recent vendor / store / provisioning ExecuteCommand: `0` = OK, otherwise the positive errno behind a `STATUS_FAILURE` reply. Examples: `EEXIST` 17 = duplicate image already stored, `ENOSPC` 28 = store full, … The Cyphal mirror of the I²C `CMD_ERROR` register (§12). The ExecuteCommand response itself carries only the stock status code. Every file pull, `BEGIN_SOFTWARE_UPDATE` and `LOAD_FROM_FILE`, marks this register `CMD_ERR_PENDING` (255) at accept and resolves it to the pull's verdict when the pull completes. The verdict is `0`, or `ENOEXEC` (8) for a file that is not an MCUboot image or a valid personality. It is `ENODATA` (61) for a truncated one, or the errno of a failed pull (§7.2). The host therefore polls this edge rather than trusting the pull's ExecuteCommand reply |
| `aliensense.nxs.io_err_count` | read-only | `natural16`, cumulative sensor-bus I/O errors since boot, including faults the device recovered and retried without sample loss. A steady rate is health telemetry worth monitoring even while the sample stream is unaffected. Saturates at 65535 |
| `aliensense.nxs.probe_failed_count` | read-only | `natural16`, cumulative probe give-ups since boot, failures the device could not recover in place. Saturates at 65535 |
| `uavcan.diagnostic.severity` | read/write | `natural16`, the capture floor for the diagnostic stream on subject 8184: `0` TRACE … `7` ALERT, default `4` (WARNING). Out-of-range writes clamp to `7`. RAM-only |
| `aliensense.nxs.param.<name>` | read/write | `natural32`, one register per loaded-personality parameter. A write sets the value, and a read returns the current. `register.List` enumerates them after the static registers. The descriptor (unit, allowed set) comes from GetParamInfo. RAM-only |
| `aliensense.nxs.calibration.acceleration` / `.angular_velocity` / `.magnetic_field` | read/write, persistent | `real32[12]`, the bucket's affine: M row-major as elements 0–8, then b as 9–11. A write stages. `calibration.commit` applies the staged record and Save persists it (§6.9) |
| `aliensense.nxs.calibration.encoder_zero` | read/write, persistent | `real32[1]`, radians added to the `angle` output, the sum wrapped into \[0, 2π) |
| `aliensense.nxs.calibration.commit` | read/write, volatile | `natural8[1]`. Writing a nonzero value validates the staged record and applies it to the running state in one step. Writing `0` discards the staged edit, and the stage re-seeds from the running record. The response carries the **result code**, not the written value. `Access` reads after the write regardless of its outcome, so a single round trip reports acceptance (`0`) or the errno. A commit refused `ECANCELED` discards the stage, and other refusals keep it |
| `aliensense.nxs.calibration.dirty` | read-only, volatile | `natural8[1]`, `1` while the staged record differs from the running one |
| `aliensense.nxs.calibration.orientation` | read/write, persistent | `natural8[1]`, the mounting-rotation code 0–23 (§6.9) |
| `aliensense.nxs.calibration.driver_tags` | read/write, persistent | `natural32[4]`, the three bucket guards then the encoder guard, 0 = unguarded (§6.9) |
| `aliensense.nxs.calibration.progress` | read-only | `natural8[3]`, `[state, detail, result]`, the on-device procedure surface (§6.9) |
| `aliensense.nxs.calibration.epoch` | read-only | `natural16`, the record's change counter. It brackets a multi-register record read (§6.9), the same counter byte 168 of the I²C read-back serves |
| `aliensense.nxs.descriptor.epoch` | read-only, volatile | `natural16[1]`, the descriptor-set generation: 0 until the first personality load, then 1–255 wrapping past 0, bumped on every personality (re)load. The Cyphal twin of the I²C `DESCRIPTOR_EPOCH` register. A host caches descriptors (and the calibration binding it decodes with) against it and re-reads on change. The active-slot number cannot express a RAM-to-RAM personality swap |
| `aliensense.nxs.fw.describe` | read-only | `string`, the build identity (§6.10), the firmware's `git describe`, identical to the I²C build-info record |
| `aliensense.nxs.fw.confirmed` | read-only | `natural16`, `1` once the running image is confirmed, `0` while it runs in MCUboot's TEST state (§7.2). In that state it reverts on the next reset unless confirmed. A host reads it after an update to know the pushed image is the one running. A supervising host reads it before deciding to `CONFIRM_FW`. Treat an absent register (older firmware) as unknown, never as unconfirmed |
| `aliensense.axon.param.<name>` | read/write | `natural32`, one register per loaded-personality parameter. A write sets the value, and a read returns the current. `register.List` enumerates them after the static registers. The descriptor (unit, allowed set) comes from GetParamInfo. RAM-only |

**Device identity (`GetInfo`).** The stock `uavcan.node.GetInfo` response carries the fields a host uses to identify and version-gate a node:

| Field | Type | Value |
|---|---|---|
| `name` | `string` | `com.aliensense.nxs` |
| `software_version` | `{major, minor}`, `uint8` each | the running firmware MAJOR.MINOR. The full build identity, patch level included, is the `aliensense.nxs.fw.describe` register (§6.10). Pin bookkeeping below the wire's proof stays with the suite tool (Integration Manual §5.4) |
| `software_vcs_revision_id` | `uint64` | firmware git commit. Two builds of one version are distinguishable, and a stock auto-updater treats an equal version with a differing revision as an update (Provisioning, above) |
| `hardware_version` | `{major, minor}`, `uint8` each | board hardware revision |
| `unique_id` | `uint8[16]` | STM32 UID96 in bytes 0–11, tail zero-padded, the board's immutable identity, used as the suite TOFU serial (Integration Manual §5.3) |

The host SDK exposes `read_fw_version()`, the build identity string (§6.10), or `"MAJOR.MINOR"` on firmware predating it. It also exposes `read_serial()`, bytes 0–11 of `unique_id`. Both are read-only and always reflect the running firmware, on every transport. Over Cyphal they use the `aliensense.nxs.fw.describe` register with `GetInfo` as the fallback. Over I²C they use the build-info transfer with the `FW_VERSION_MAJOR`/`FW_VERSION_MINOR` registers as the fallback (§3).

#### 8.2.7 Register persistence and the Save model

Config follows a running/startup model. A write takes effect in the running state and persists nothing until an explicit Save. `decimation` and its per-subject factors apply to the next sample, and a `calibration.*` write applies to the running record (§6.9). `node.id` and `pub.<name>.id` are reboot-applied, so a write stages without changing the running stream. `ExecuteCommand COMMAND_STORE_PERSISTENT_STATES` (65530) validates the staged record and commits it to NVS in one step. Out-of-range identity values are already rejected at the register write (the table below).

A Save over this transport therefore fails (`STATUS_FAILURE`, nothing written) only on the commit's own validation or a flash-write error. A shared subject-ID is legal and never rejected (§8.2.8). A device that is configured but not Saved reverts on reboot.

The persistent registers report `persistent = true`: `node.id`, `can.bitrate`, `can_term`, every `pub.<name>.id`, `decimation`, each `decimation.<subject>`, and the calibration record registers (§6.9). `file_server_id`, `uavcan.diagnostic.severity`, and `param.<name>` are RAM-only (`persistent = false`) and revert to compiled defaults on reset.

Every config register reports `mutable = true` (`calibration.progress`, a status surface, is read-only). A write is range-checked per register (`natural16`-typed, except the `natural32[2]` bit-timing pair and the `real32` calibration registers):

| Register | Write effect |
|---|---|
| `uavcan.node.id` | Staged when `0`–`125`, static, with 126/127 reserved for diagnostic and host tooling. Also staged when `255`, the anonymous sentinel: reachable over serial/I²C, the node boots silent on CAN. Also staged when `0xFFFF`, a revert to the compiled default. An out-of-range value is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `uavcan.can.bitrate` | Staged when the pair is a supported profile: FD `[1M, 4M]`, `[1M, 2M]`, Classic `[1M, 1M]`, `[500k, 500k]`, `[250k, 250k]`, `[125k, 125k]`, or `[0, 0]` (revert to the compiled default). A single-element write `[v]` means Classic `[v, v]`. Anything else, including `data < arbitration`, is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `uavcan.pub.<name>.id` | Staged when `0`–`8191` or `0xFFFF`, a revert to the compiled default. `0` disables the topic, and the `scalar` base is capped at `8181` so its 11-subject block stays in range. An out-of-range value is rejected: the response echoes the unchanged value. Applies at the next reboot |
| `aliensense.nxs.decimation` | Stored verbatim, applied live, no clamp |
| `aliensense.nxs.decimation.<subject>` | Stored verbatim, applied live, no clamp |
| `aliensense.nxs.sample_fifo.depth` | Staged when `0`–`255` and applied live to the queue. A larger value is rejected: the response echoes the unchanged setting |
| `aliensense.nxs.can_term` | Staged when `0`, `1`, or `0xFFFF` (revert to the default, off) and applied live to the termination pin. Anything else is rejected: the response echoes the unchanged effective state |
| `aliensense.nxs.file_server_id` | Stored when `0`–`127`. A value `> 127` is dropped |
| `aliensense.nxs.param.<name>` | Forwarded to the personality. See the acceptance note below |
| `aliensense.nxs.calibration.<name>` | Applied to the running calibration record when the value's type, element count, and contents fit the register. Otherwise ignored, and the response echoes the unchanged value, the same contract as `uavcan.node.id`. Committed by Save |

A `node.id` / `pub.<name>.id` read reports the **staged** value, the configured value or the resolved default when uncommissioned, never a bare "unconfigured" sentinel. Identity is reboot-applied. Between a write and the reboot the read echoes the staged value, while the running node keeps publishing at its boot-resolved addresses. After the reboot the two coincide. This staged echo is the write acknowledgement: a rejected write reads back unchanged.

**Node-ID is per-link.** Cyphal/serial is a point-to-point cable, with no bus and nothing to deconflict, so it is a fixed management link. Its node-ID is always the compiled default (`125`), and a `node.id` read over serial reports that link address regardless of any commissioned value. A `node.id` write (over any transport) stages the identity the **CAN** node adopts at the next reboot. A `node.id` read over CAN reports that staged/effective value.

The split is a console port, always reachable at a known address, versus a network interface at the configured, deployment-specific address. The serial link therefore stays reachable at `125` even when the CAN identity is unknown or misconfigured. Subject-IDs are not per-link, since a subject is the same on both transports.

**`can_term` drives the on-board split termination, live.** Unlike the reboot-applied identity, a termination write reaches the pin within one second, so a bench toggle needs no reboot. It persists nothing until Save, so a change that degrades the bus reverts at the next power cycle unless deliberately committed. The uncommissioned default is off. A unit joins an already-terminated bus without loading it, and only the units at the two physical bus ends are commissioned on. Hardware of v1.0 has no termination pin, so the selection persists but drives nothing.

**`can.bitrate` selects the CAN link timing.** The pair applies to the CAN controller at boot, before the node starts. An FD profile transmits FD frames with bit-rate switch at MTU 64, and a Classic profile transmits plain data frames at MTU 8. Sample points are fixed at 0.875 for arbitration and 0.750 for data on every profile. The register is served on both Cyphal transports. The serial link, whose timing never changes, is the recovery path for a CAN link commissioned onto a profile the attached bus does not speak.

A Save on any transport commits the staged record, so a profile staged over Cyphal persists on an I²C `STORE_PERSIST` too. The host interface must drive the unit's *active* profile. A host still configured for the previous timing loses the link at the reboot that applies the new one.

**`decimation` gates the whole sample stream.** A `natural16` value `N` is stored as-is: `0` disables publication, `1` (the default) publishes every sample, `N` publishes every Nth. No clamp is applied. The gate covers both `RawSample` and every standard SI projection (the IMU `si.sample.*` and GNSS subjects fan out behind it). A freshly booted node streams at its persisted `decimation`, `1` out of the box, so no host write is needed to start the stream.

**`decimation.<subject>` refines one SI subject.** After a sample clears the device-wide gate, each SI subject is thinned again by its own factor. `0` or `1` publishes every sample that passed the gate, `N` every Nth. `temperature` ships thinned to 25 (≈ 10 Hz at a 250 Hz acquisition rate) so a slow channel does not crowd the bus. The motion subjects stream every sample. The per-subject factors do not gate `RawSample`, which always carries the full sample.

**`file_server_id` write range.** Valid values are `0`–`127` (the Cyphal node-ID range). A write with a value above `127` is discarded without effect. The Access response carries the unchanged current value, so a host detects the rejection by comparing the returned value against the value it sent.

**`param.<name>` acceptance is read-back, not response-coded.** A `natural32` value in the write request is forwarded to the personality and the validation result is discarded. The Access response is therefore identical whether the value was accepted or rejected: it always carries the parameter's live `current_value`. An out-of-set value is not signalled in the Access response on this transport. A host confirms acceptance by reading the parameter back, through a subsequent `register.Access` read or through `GetParamInfo`, whose `current_value` field reflects the applied value. On the I²C register-map path a rejected write is likewise silent, so the host reads the window back (§7).

#### 8.2.8 Standard SI projection

Alongside the proprietary `aliensense.nxs.RawSample.0.1` stream (subject 6144 default, §8.2), every sample is also projected onto stock `uavcan.si.sample.*` and `reg.udral` subjects. A consumer reads acceleration, angular velocity, temperature, pressure, and a geodetic point-state in physical SI units with stock Cyphal tooling. It needs no descriptor list, which the RawSample stream requires.

The firmware walks the active personality's output descriptors and decodes each numeric field to its SI physical value (`raw * effective_scale + offset`). It applies the per-unit calibration (§6.9), and routes the value by semantic code (§6.6) into the matching standard subject. The *effective* scale is the descriptor's base `scale`, multiplied by the live `current_value` of a linked parameter when the field declares one (§6.6, `scale_param_index`). A runtime full-scale-range change, for example an IMU `accel_fs` write, therefore tracks on the wire with no image re-upload. The scalar and vector subjects narrow to their wire type (`float32`), and the geodetic position is carried as `float64`.

| Source semantic(s) | Subject-ID (default) | Cyphal DSDL type | Notes / slots |
|---|---|---|---|
| `accel_x` / `accel_y` / `accel_z` (1–3) | 6146 | `uavcan.si.sample.acceleration.Vector3.1.0` | `float32[3] meter_per_second_per_second`, with X→\[0], Y→\[1], Z→\[2] |
| `gyro_x` / `gyro_y` / `gyro_z` (4–6) | 6147 | `uavcan.si.sample.angular_velocity.Vector3.1.0` | `float32[3] radian_per_second`, with X→\[0], Y→\[1], Z→\[2] |
| `mag_x` / `mag_y` / `mag_z` (7–9) | 6151 | `uavcan.si.sample.magnetic_field_strength.Vector3.1.0` | `float32[3] tesla`, with X→\[0], Y→\[1], Z→\[2] |
| `temperature` (10) | 6148 | `uavcan.si.sample.temperature.Scalar.1.0` | `float32 kelvin`, kelvin at the source, published unchanged |
| `pressure` (11) | 6149 | `uavcan.si.sample.pressure.Scalar.1.0` | `float32 pascal` |
| scalar block `angle` (23) … `flow` (33) | `base + k`, base 6152 | `uavcan.si.sample.<quantity>.Scalar.1.0` | one `float32` per quantity. See the scalar-block rule below |
| `latitude` / `longitude` / `altitude`, codes 14–16, `vel_north` / `vel_east` / `vel_down`, codes 17–19, `pos_h_acc` / `pos_v_acc` / `vel_s_acc`, codes 20–22 | 6150 | `reg.udral.physics.kinematics.geodetic.PointStateVarTs.0.1` | Assembled from the structured-GNSS group into one position + velocity + covariance message. See the GNSS rule below |

These are the **default** subject-IDs (vendor-fixed band). Each is a `uavcan.pub.<name>.id` register a host commissions (§8.2.7). Sharing a subject-ID across nodes is legal and intended. A subscriber receives every publisher on a subject, disambiguated by source node-ID, so identical boards aggregate on the shared SI subjects with no per-board remap. Only the node-ID need be distinct.

**Scalar SI block.** The single-value SI quantities form a contiguous semantic range, `angle`, code 23, through `flow`, code 33. They are angle, voltage, electric current, length or distance, force, frequency, luminance, mass, torque, velocity or speed, and volumetric flow rate. Quantity *k*, its semantic code minus 23, publishes on `scalar_base + k`, so the block occupies `scalar_base` through `scalar_base + 10`. Every `uavcan.si.sample.<quantity>.Scalar.1.0` shares one sealed 11-byte wire layout, a 7-byte `SynchronizedTimestamp` then a `float32`, so a single serializer covers the whole block.

The compiled default base is 6152 (block 6152–6162). Commissioning caps the base at `8181`, keeping the whole block inside the 13-bit subject-ID space. `0` disables the block. Keep the span clear of the other subject-IDs.

**Canonical SI units.** Every field with a known SI semantic carries its semantic's canonical unit: `m/s^2`, `rad/s`, `tesla`, `kelvin`, `pascal`, and the scalar-block units. The units are declared once in the constants registry (`constants/field_semantics.yaml`) and enforced at personality compile time. A personality inherits the unit by omitting it, and declaring a conflicting unit is a compile error.

Temperature is kelvin at the source. The raw stream, the descriptor `unit` string, and the `temperature.Scalar` subject therefore carry one identical physical value in three framings. The mapper performs no unit conversion. Non-SI fields (humidity `%RH`, NMEA) declare their unit explicitly and have no standard subject.

**Geodetic (GNSS).** `PointStateVarTs` is published only when the sample carries the complete position triple: `latitude`, `longitude`, and `altitude` all present. A sample missing any of the three is suppressed entirely, rather than transmitting zeros that a consumer would read as a real position. Fix quality is not gated on-device. It rides in the covariance and in the personality's generic quality fields (fix type, satellite count). When published:

* Position latitude and longitude are radians as `float64`. Altitude is metres as `float64` (`uavcan.si.unit.length.WideScalar.1.0 meter`), referenced to **mean sea level (MSL)** per the DSDL's altitude definition. That definition reads "distance between the local mean sea level (MSL) and the focal point of the antenna". A receiver's ellipsoidal (WGS84) height is not published on this subject. Personalities expose it as the generic field `alt_ellipsoid` in the RawSample stream.
* Velocity is NED metres per second (`float32[3] meter_per_second`): `vel_north` → \[0], `vel_east` → \[1], `vel_down` → \[2]. Components default to 0 when not supplied.
* Covariance is carried on the upper-right-triangle diagonal of each 3×3 matrix (`float16[6]`, elements \[0], \[3], \[5]). Position covariance (m²) takes `pos_h_acc²` for the latitude and longitude diagonal entries and `pos_v_acc²` for the altitude entry. Velocity covariance, in (m/s)², takes `vel_s_acc²` on all three diagonal entries.
* A missing accuracy field yields the sentinel variance `1.0e6` rather than 0. So does, for velocity covariance, a fix with no velocity component supplied. A zero covariance reads as perfect certainty, and the sentinel marks the axis as effectively unknown.

**Enable / disable.** Each subject is emitted only when both a routed field is present in the sample and its subject-ID is non-zero. An ID of `0` disables that projection. Each subject-ID is the writable, persistent `uavcan.pub.<name>.id` register (§8.2.7), host-commissionable, and `register.List` enumerates them. The defaults are the vendor-fixed band: accel 6146, gyro 6147, magnetic field 6151, temperature 6148, pressure 6149, GNSS 6150, scalar block base 6152. The compiled defaults live in the constants registry (`constants/cyphal.yaml`).

**Timestamp.** Every projected subject carries the sample's acquisition instant in its `timestamp.microsecond` field (microseconds since boot). That instant is the delivered DRDY edge (or declared frame bound) behind the sample's measure pass, or the commit instant for event-less pacing. It is never the publish moment. Although the field type is a network-synchronized timestamp, the value is the local acquisition time, not a Cyphal-network-synchronized clock. Consumers that need network time must not treat it as such. A host can translate these stamps into its own time domain with a bounded error via the two-way sync surface (§6.8).

**Unmapped semantics.** Humidity, code 12, and NMEA, code 13, carry descriptors (§6.6) but emit no standard subject. There is no stock humidity scalar, and NMEA is delivered only as raw bytes in the RawSample stream. The geodetic projection, subject 6150, is populated when a loaded GNSS personality emits the structured geodetic fields, codes 14–22, its binary output mode. The same personality in NMEA mode emits a single string field, leaving the subject silent.

**Provisioning.** `COMMAND_BEGIN_SOFTWARE_UPDATE`, the stock command, and vendor `LOAD_FROM_FILE`, 0xA000, each carry a file path in `parameter`. The node fetches it with `uavcan.file.Read`, offset-addressed, in 256-byte chunks, with EOF on a short read. Firmware update reads from the commanding node, the standard contract, so `yakut file-server --update-software` and Yukon (the OpenCyphal GUI) drive it unchanged. It writes to the DFU slot, then reboots into the swap.

The auto-updater gates on `GetInfo`. It pulls a package whose name matches and whose `software_version` is higher. It also pulls an equal version with a differing `software_vcs_revision_id` (the firmware git revision), and skips an exact match. `nxs push-fw` commands the pull at any version, asking first when the image is older than the one the unit runs.

The personality load reads from the `aliensense.nxs.file_server_id` register, or the commanding node when it is unset. It writes the NXS to staging, where it loads without running. The load verdict resolves in `aliensense.nxs.cmd_error`: `CMD_ERR_PENDING` until the pull completes, then `0` or the parse errno. `RUN` / `STOP` (0xA001 / 0xA002) then control the loaded personality. One pull runs at a time. A trigger arriving mid-pull is rejected with `STATUS_FAILURE`, and `aliensense.nxs.cmd_error` keeps the live pull's sentinel.

The `STATUS_SUCCESS` reply confirms the pull is armed, not that staging is prepared. The staging erase runs when the first chunk arrives. A fault after the reply, an unreachable server or a flash error, resolves the verdict in `aliensense.nxs.cmd_error`. It returns the node to `OPERATIONAL` mode without a reboot instead of failing the command.

`RawSample.data` is opaque bytes. `GetOutputInfo` supplies the per-field name, type, byte order, scale, offset, unit, and semantic needed to decode it without a personality definition on the host. The same node and services are served on Cyphal/CAN-FD when that media is built. The bring-up procedure is [`nxs-integration-manual.md`](../nxs-integration-manual/) §3 and §4: yakut configuration, register and subject access.

## 9. nxs command-line tool

Host tool for every transport, shipped on PyPI as `aliensense-nxs`. Requires Python ≥ 3.10.

```
python3 -m pip install aliensense-nxs
```

pip takes the platform wheel of a Linux host, `manylinux_2_35_aarch64` or `manylinux_2_35_x86_64`, which carries the runtime library. On any other host, macOS among them, it takes the pure wheel, `py3-none-any`, which carries the compiler and `nxs personality check` and no runtime library.

The wheel is built from the product source tree with `python3 -m build --wheel` in `sdk/`. Installing from the source tree directly (`pip install .`) requires setuptools ≥ 61 in the build environment. On hosts with older stock toolchains (Ubuntu 22.04 and derivatives) the build silently produces an empty `UNKNOWN-0.0.0` package, so use the wheel.

Global options:

* `-t {i2c,cyphal-serial,cyphal-can}`: default `$NXS_TRANSPORT`, else I²C on Linux / Cyphal/serial on macOS, Windows.
* `-b BUS`: default `$NXS_BUS`, else the one i2c unit suite.yaml declares, else the single unit answering on the platform's camera buses. Several units refuse by name.
* `-a ADDR`: default `0x30`.
* `-p PORT`: `$NXS_PORT`, the serial device, auto-detected when omitted.
* `--baud`: default 460800.
* `--mtu {8,64}`: the Cyphal/CAN frame MTU, default `$NXS_CAN_MTU` or 64. Pass 8 on a bus running a Classic profile.
* `--remote-node-id N`: the Cyphal target node-ID, default 125, the plug-and-play factory address.
* `--unit NAME`: a declared unit by its declaration name. The declaration supplies the transport and link, overriding `-t`/`-b`/`-p`/`-a`.
* `--experimental`: the paths in `$NXS_CAM_HUBS` and `$NXS_CAM_PERSONALITIES`, the experimental overlays, a development personality store.
* `--version`.

| Command | Action |
|---|---|
| `probe` | Presence check (`WHO_AM_I`). Over I²C it also reports the register-map version and warns when it is newer than the tool supports. Bare on a camera host: every camera bus swept for hubs, units, and sensors |
| `status` | Addressed (`-b`, `-p`, `--unit`): device identity (`SERIAL`), VM, runner, and store status. Over I²C it adds the cam personality the store holds, with its slot and last run. The line reads `Camera:`, `never run` before its first run, `(none)` when the store holds none. Then come the fault counters (§12) on transports that serve them. The `Outputs:` block follows: each output field's name, type, byte order, semantic, scale, offset, and unit (§6.6). Over I²C a held session (a calibration procedure or a firmware push) prints as `Session: held` in place of the slot details. Bare: the declaration against the rig, node by node (`--json` for the tree) |
| `upload <name\|file> [--param K=V …] [-o FILE] [--slot N]` | Compile a personality by name, shipped or installed, or a local `.py` given by path, and upload it. A path to a compiled `.nxs` uploads verbatim. `-o` writes the compiled image to that file instead of a device, an offline producer for fleet file-servers. A cam personality lands in a store slot, `--slot` the one it takes (§6.11). It overwrites the slot it replaces in place, and a slot past the populated ones appends after them (§6.5). The line names the slot it took |
| `run` | Run the loaded personality again |
| `caps` | List personality parameters with their allowed values, current value, and default |
| `get <name>` / `set <name> <value>` | Parameter access, two families under one verb: the personality's parameters (`sample_rate`, `accel_fs`, …) and the device's below. A name neither family carries is refused with both lists |
| `get decimation` / `set decimation N` / `set decimation.<subject> N` | Device-output decimation, the device-wide factor, or a per-subject SI factor (§8.2.8). Live. Persist with `commission --save` |
| `get can-bitrate` / `set can-bitrate NOMINAL[/DATA]` | CAN bit-timing profile (§8.2.7): one rate selects Classic CAN, a pair selects FD, `0` reverts to the default. Staged. Persist with `commission --save`, and it applies at the next reboot |
| `get can-term` / `set can-term on\|off\|default` | On-board CAN split termination (§8.2.7). Applies live. Persist with `commission --save` |
| `get fifo-depth` / `set fifo-depth RECORDS` | Sample FIFO depth in records (§6.3), `0` = all the storage holds. Applies live. Persist with `commission --save` |
| `get orientation` / `set orientation ROTATION` | The unit's mounting orientation, one of the 24 rotation codes (§6.9). A set is applied and persisted |
| `calibrate gyro\|mag [--no-persist]` | Trigger the on-device solves (§6.9) with a progress readout. `mag` auto-stops at sufficient coverage |
| `calibrate accel [--no-persist]` | Accelerometer wizard: six poses plus two check poses auto-capture on stillness, the per-axis scale and offset solve host-side and upload via the record write (§6.9) |
| `calibrate encoder-zero [--no-persist]` | Declare the current angle as mechanical zero (circular mean of 50 samples) |
| `calibrate show [--full]` | Orientation, per-bucket solved/identity state with the guard verdict, encoder zero. `--full` prints M and b |
| `calibrate reset [accel\|gyro\|mag\|encoder\|all]` | Write the identity calibration (orientation kept) and persist |
| `commission [--node-id N] [--subject NAME=ID …] [--can-bitrate NOM[/DATA]] [--can-term on\|off\|default] [--save] [--show]` | Commission the Cyphal node-ID / subject-IDs / CAN link (§6.7, §8.2.7). `--show` reads the current identity. `--node-id` / `--subject` / `--can-bitrate` stage and commit (reboot to apply). `--can-term` applies live and commits. `--save` alone commits staged running config, for example decimation, to NVS |
| `stream [--raw] [--count N] [--hz N] [--units human\|si] [--json]` | Print decoded (or raw) samples, each with its timestamp and the rate the unit's timestamps give over the last second, from the second sample on. The closing line gives the rate over the read. `--json` is one document of fields and samples, with that rate as `rate_hz`, left out of a read of one sample |
| `identify` | Strobe the status LED for about 10 s to locate the unit |
| `timesync [--interval S] [--once] [--systemd] [--unit NAME …]` | Push the host time discipline (§6.8). Bare, it pushes to every unit the declaration declares as a resident pusher, and `--unit` narrows it, repeatable. `--systemd` prints the service unit. Addressed with `--unit NAME` before the verb, it pushes to that one unit |
| `store ls` | List store slots. Slot details are unavailable while a session is held, and the listing says so |
| `store save <slot>` | Persist the uploaded personality |
| `store rm <slot>` / `store clear` | Delete one slot / all slots |
| `store cycle` | Advance to the next populated slot |
| `push-fw <image> [--allow-downgrade]` | Firmware update (§7.2, §7.3). Refuses a file that is not a signed MCUboot image before touching the device. Names the running version and asks before installing an image older than it, since the bootloader has no downgrade check. `--allow-downgrade` answers for a script. After the reboot it waits up to 30 s for the device and reports `✓ updated`, `✓ unchanged`, or `✗ rejected or reverted` (exit 1). The verdict compares the build identity the device serves after the push against the one the pushed file carries |
| `confirm-fw` | Confirm the running image so it survives the next reset (§7.2). Required by supervised builds, harmless on the default build |
| `recover` | Enter bootloader serial recovery, on either transport |
| `reboot` | Cold-reset the unit from the application, mid-session too: a staged update swaps in, an unconfirmed image reverts (§7.2). Either transport |
| `generate [--dry-run] [--json]` | Walk the rig and write `hardware.yaml`, what answered. Seed `suite.yaml` when there is none. `--json` prints the walk as data |
| `switch [--dry-run] [--fdt PATH] [--unit NAME] [--accept-new-serial]` | Realize `suite.yaml`: the host's files, the camera buses on a host that boots none, the camera ports and every declared unit. A host that boots none then prints `REBOOT NEEDED`, exit 3, with or without a declaration. `--dry-run` prints the same lines with nothing done. `--fdt` names the base device tree the generated boot table loads, where the tool cannot pick the Jetson module's own. A path that names no file is refused with nothing written |
| `tune [--list] [--set CHANNEL[:SECTION]:FIELD=VALUE …] [--schema] [--play] [--json] [--freeze [--unit NAME] [--ports [--port NAME]] [--dry-run]]` | The declaration panel: edit the declared config from real options only. `--set` names a knob by its channel, a port `cam1`, a link `cam1/A` or a unit by its name. SECTION is needed where the field repeats in the channel, and a batch of `--set` saves once. `--schema` prints the rig's rules as JSON Schema, the declaration schema narrowed by what is on this rig. `--freeze` adopts the units' live tuning into the declaration, `--ports` the camera ports and `--port` one of them |
| `host info\|modes` | The capture host's contract: what booted, a port's mode table |
| `ros2 [--plan] …` | Bridge decoded samples onto ROS 2 topics |
| `personality check\|install` | A personality on the host: validate one before installing it, install one into the store |
| `mcp [--doc-table]` | Serve the verbs to an AI agent over MCP (stdio) |

The camera family (`on`, `off`, `stream`, `capture`, `status`, `caps`, `get`, `set`) runs under the node grammar `nxs <port> [<link>] <verb>`. It is specified in the [Integration & Operation Manual §5](../nxs-integration-manual/) and the [Cam Personality Reference](../nxs-cam-personalities/).

`set orientation` is applied and persisted. The `calibrate` verbs persist their result by default. `--no-persist` leaves it in the running state (§8.2.7), reverting at power-cycle.

```
nxs probe
nxs upload iam20680 --param sample_rate=250
nxs upload iam20680 -o iam20680.nxs
nxs store save 0
nxs status
nxs stream
nxs set decimation 2
nxs commission --show
nxs commission --node-id 10
nxs push-fw zephyr.signed.bin
```

### 9.1 Programmatic surface (NxsClient)

The same operations are available as a transport-independent Python SDK, `nxs.client.NxsClient`, which the CLI and the suite tooling are themselves built on. Code written against it runs unchanged across transports, since the wire is a constructor argument:

```python
from nxs import open_client
c = open_client("i2c", bus="/dev/i2c-2", address=0x30)   # or "cyphal-serial", "cyphal-can"
c.upload_image(image); c.vm_run(); c.set_param("sample_rate", 250)
for sample in c.iter_samples():       # decoded from device descriptors
    handle(sample.values)
```

`NxsClient` is a synchronous contract (`abc.ABC`). Transport-specific operations (bootloader recovery, slot peek, commissioning, CAN bit timing, CAN termination) are typed capability interfaces queried with `isinstance`. The interfaces are `SupportsRecovery`, `SupportsSlotPeek`, `SupportsCommissioning`, `SupportsBitTiming`, `SupportsCanTermination`. Streaming yields decoded `Sample`s and re-syncs decoding to `DESCRIPTOR_EPOCH` (§6.6). The verbs that drive it are §9, and the workflows [`nxs-integration-manual.md`](../nxs-integration-manual/) §4.

### 9.2 Stability of the host library and the JSON documents

The C header of `libnxs`, `nxs.h`, and the documents the verbs print under `--json` keep their shape from 1.1.0 on:

* A struct in `nxs.h` keeps its size, its layout and the meaning of each field in every later release. A program built against an earlier header therefore keeps working against a later library. A new field arrives as a new struct with its own function beside the released one. `nxs_capture_pair_of` reads a synced pair's part beside `nxs_capture_of`, and `nxs_unit_read_cam_runs` reads the camera-run counter beside `nxs_unit_read_diag`. A function keeps its signature and the meaning of its return values, and an enum keeps every value it has.
* Every `--json` document carries `contract`. This release prints contract 2, described by the `surface` schema the SDK ships. A release candidate previews it, and the final release fixes its keys. The schema lists every key an object may carry and refuses any other. A key added to any object therefore comes with a new contract number and that number's schema, as a renamed or removed key does. A program reads `contract` first and refuses a number it does not know.

## 10. Personality authoring

A personality is a Python class, datasheet as code. Class attributes name the bus addresses and identity check (`I2C_ADDRS`, `WHO_AM_I_REG`, `WHO_AM_I_VALUES`) and per-bus communication profiles (§10.2). Methods define `probe()`, `configure()`, and a measure loop. Declared parameters and output fields become the capability descriptors of §6.4/§6.6. The compiler traces the class into VM bytecode and packs it with the descriptors into an NXS image (bytecode ≤ 4096 bytes). Each output field's semantic category (§6.6) is inferred from its field name at compile time, and personalities do not declare it.

Click personalities are generated from a sensor datasheet by the `nxs-generate-click-personality` skill that ships with the SDK, then compiled and uploaded with `nxs upload`. The authoring reference is [`nxs-click-personalities.md`](../nxs-click-personalities/).

### 10.1 Image format version

The NXS image begins with a 13-byte header, in this order:

* a 4-byte magic, `NXS\0`, the ASCII bytes `N` `X` `S` then a NUL pad, `4E 58 53 00`
* a 1-byte **major** and a 1-byte **minor**
* a 1-byte **kind**: 0 DRIVER, 1 CAMERA, 2 HUB. A DRIVER image is a click personality and a CAMERA image a cam personality. A HUB image is the program of a device on the host's own bus. The host tool's executor runs it, and a device refuses it at upload
* a 1-byte **flags** field, bit 0 the bytecode section is sealed, bit 1 reserved
* the personality-name length and the parameter and output counts
* a 2-byte **probe length**, the offset inside the bytecode where `probe()` ends and `configure()` begins

A probe length past the end of the bytecode is refused at load. This version is distinct from `PROTO_VERSION` (§2). `PROTO_VERSION` is the register-map contract, while the NXS major/minor is the image format the firmware executes.

After the name comes the bytecode section. When plain, it is a 2-byte length and the bytes. When sealed, it is a 16-byte nonce, the 2-byte length, and the ciphertext (AES-128-CTR under a key the firmware holds). The device decrypts the ciphertext into its program buffer at load and never serves it back. The probe block, the parameters, the outputs, and the communication-profile trailer (§10.2) follow.

A descriptor trailer closes the image, at most 2048 bytes in all: a count byte, then records of type, length and bytes. The type is 1 byte and the length 2 bytes, little-endian. The device keeps the trailer as it is and serves it through personality info (§6.11). Record types:

* 1 MODES: the index of the `mode` parameter, then each mode's value, geometry, timing, and name
* 2 CONTROLS, 3 LAWS, 4 CAPTURE, 5 INSTANCE\_CAL (reserved)
* 6 IDENTITY: address, register and value widths, identity and alive registers, the default mode, name, compatible. It also says whether the head takes the hub's trigger and whether its pulse width is the exposure
* 7 PROGRAM
* 8 TRIGGERS: the index of the `trigger` parameter and each conversion's value and name
* 9 SHIPPED, retired: the number stays reserved, no compiler writes it and every decoder skips it
* 10 STATUS: the status probes, register, format, decode table
* 11 RUN\_PARAMS: the run parameters a host stages in physical units, index, range, default, name, unit
* 0xE0 to 0xEF are vendor records the tool never interprets, and an unknown type is kept and skipped

The [Cam Personality Reference](../nxs-cam-personalities/) lists what each record carries.

LOAD runs an image only when both hold:

* **major == the firmware's NXS major.** A differing major means the wire layout or an opcode's semantics changed, and the image is rejected.
* **the image's required minor ≤ the firmware's NXS minor.** The compiler stamps the required minor as the highest minor of any opcode the image emits. It never stamps below the minor that introduced the image's kind (HUB: 3). A reader older than the kind therefore refuses the image here rather than past the gate.

The contract is one-directional. New firmware runs old images of the same major. Old firmware cleanly refuses an image that needs an opcode it lacks rather than mis-executing it. A new opcode bumps the minor, and an incompatible-format change bumps the major.

The current image format is **major 2, minor 3** (minor 3 adds the HUB kind). The header carries this format version, not the product version. Any image-format movement accompanies a product-MINOR firmware release, and the `nxs` tool refuses a stale compiled image with its rebuild command. Firmware of major 2 does not load major-1 images. The tool recompiles every built-in personality on upload and `nxs switch` re-provisions saved slots.

### 10.2 Communication profiles

A register personality declares one communication profile per bus it supports. The profile is the wire framing (address byte count, R/W bit polarity, dummy bytes, auto-increment scheme), clock ceiling, and SPI mode. The compiler bakes every declared profile into the image as a trailer. At load the firmware applies the profile matching the active `bus` parameter (§6.4) to the peripheral before `probe()` runs. A part whose SPI protocol deviates from the conventional bus is therefore reached without any per-part firmware code. Such a deviation is a 2-byte address phase, or the R/W bit cleared rather than set for a read.

Every supported bus's profile is present in the image. Switching a dual-bus part between I²C and SPI is therefore a `bus` write plus a reload, not a new image. A personality that declares no deviating profile runs the conventional register bus. That bus is a single address byte, the R/W bit in bit 7 set for a read, and implicit auto-increment.

An I²C profile also declares the register-address width, 1 or 2 bytes, the value width, 1, 2, or 4 bytes, and the byte order. The conventional profile is one address byte and one value byte. A personality whose profile declares 2-byte addresses may use the full 16-bit register operand. Every register opcode, `POLL_REG` included, moves values at the declared width.

## 11. Limits

| Quantity | Value |
|---|---|
| Register-map contract version | 1 |
| NXS image format version (major.minor) | 2.3 |
| I²C target address | `0x30` |
| I²C write window / chunk | 32 bytes |
| Cyphal file-pull chunk | 256 bytes |
| Update slot capacity (firmware image) | 221,184 bytes, the 220 KiB update slot minus 2 KiB of bootloader swap bookkeeping and 2 KiB of swap working space |
| Sample record window | 128 bytes (18-byte header + ≤ 110 data bytes, §6.3) |
| Sample FIFO | 2048 bytes of records, 10 bytes of header per record, burst read ≤ 256 bytes, depth setting 0–255 records (§6.3) |
| Personality bytecode | ≤ 4096 bytes (DRIVER and CAMERA). A HUB image ≤ 16384 bytes, the host executor's budget |
| Serialized personality image (header + descriptors + bytecode) | ≤ 6144 bytes |
| Personality / parameter / output-field name | 16 bytes |
| Unit string (parameter or output) | 8 bytes |
| Parameter value set | 16 values |
| Patch sites per parameter | 2 |
| Output fields per personality | 16 |
| Communication profiles per image | 3 |
| Store slots | 8 |
| Camera program bundle | ≤ 4096 bytes, ≤ 48 sequences, ≤ 16 programs, ≤ 14 sequences per program (§6.11) |
| Camera descriptor payload | ≤ 2048 bytes (§6.11) |
| Camera program write retries | 5, 50 ms apart. Retry blocks nest 2 deep (§6.11) |
| Command queue depth (I²C) | 8 |
| DFU staging erase stall | ~2.5 s |
| Transfer-session stale window | 2 s of holder silence (2 × the 1 s DFU ack timeout) when another command contends. A DFU session expires on its own after 6 s |
| Watchdog timeout | 3 s for the application. A 30 s window fed by the bootloader during a swap and in recovery |
| Self-confirm window | 1 s of healthy execution with the host link initialised (default build, a build option, §7.2) |

### Cyphal node

Limits of the Cyphal stack, fixed at firmware build time.

| Parameter | Value |
|---|---|
| Allocation arena | 8192 bytes |
| Allocator exhaustion | the transfer is dropped and the out-of-memory diagnostic counter increments |
| CAN RX queue depth | 16 frames |
| TX queue capacity | 16 frames on FD profiles, 64 frames on Classic profiles, where the same responses span ~8× more frames |
| Subscriptions | 8 |
| TX transfer deadline | 1 s |
| File-pull read timeout | 1 s |
| File-pull retries | 5 |
| Cyphal/serial single-frame payload | 512 bytes (buffer size, not a wire ceiling) |
| Node-ID (compiled default) | 125. A commissioned node-ID persists on the device and overrides it |
| CAN MTU | 64 bytes on FD profiles, 8 bytes on Classic profiles |
| CAN bit-timing profiles | FD 1M/4M (default) and 1M/2M, Classic 1M, 500k, 250k, 125k, with sample points fixed 0.875 / 0.750 |

## 12. Error reporting

`ERROR_CODE` (`0x03`) reports the VM error byte, synced from `vm_status`: 0 when healthy, otherwise the code the faulting personality raised. The compiler's own codes are these. 17 is `TIMEOUT`, a `read_n`/`read_until` deadline, and 18 is `MISMATCH`, an `expect()` byte mismatch. 0xC0 is `WHO_AM_I_MISMATCH` and 0xC1 is `COMPANION_MISMATCH`. A personality may raise any other value as its own code.

Every other VM fault leaves the byte 0. `VM_STATE` = 2 with `ERROR_CODE` = 0 is a fault the register map cannot classify (`VM_IO_ERRORS` counts the I/O ones). `STATUS` bit 1 mirrors the VM error state (`VM_STATE` = 2), not the byte. When a personality code raised the fault, `VM_STATE` = 2 with `ERROR_CODE` gives the detail.

`CMD_ERROR` (`0x1D`) reports host command results, the calibration commands (§6.9) included, as a positive errno. It reads `CMD_ERR_PENDING` (`0xFF`) from enqueue until an async op resolves (§5). The two registers have disjoint writers: a `vm_status` update can never overwrite a command result, and a command can never mask a VM error. A completing calibration procedure latches its verdict here too, but only while it holds the transfer session. The store and DFU commands refuse to run alongside a session (`EBUSY`), so a procedure and a command result cannot collide. A command issued while a host-commanded procedure runs therefore reads `EBUSY` and retries rather than reading someone else's answer.

The boot-automatic gyro window (§6.9) refuses nothing: the pass yields to the claim and the command runs. Beyond each backend's own errnos (flash, store, validation), the transfer protocol reports:

| Errno | Value | Meaning |
|---|---|---|
| `EBUSY` | 16 | a transfer session is live: another upload, firmware push, calibration procedure, or camera run owns the mux |
| `EPROTO` | 71 | wrong `XFER_TYPE` for the op, a zero-size announce, or a config stage trampled by an interleaved write. A camera run whose personality raised an error code of its own |
| `EFBIG` | 27 | the announced size exceeds the staging buffer. A camera run whose program is larger than the camera runner holds |
| `ENODATA` | 61 | `LOAD` on a stage short of the announce, where bytes were lost in transit. `DFU_FINISH` before any chunk was accepted, or when the image's declared length runs past the staged bytes |
| `ENOEXEC` | 8 | `LOAD` on bytes that are not a valid personality image. `DFU_FINISH` on staged bytes that are not an MCUboot image. `CAM_RUN` or a personality-info select naming a slot that holds a click personality |
| `EBADF` | 9 | `PEEK_SLOT` on a corrupt image. `CAM_RUN`, a personality-info select, or a camera run's terminal state naming a slot whose cam personality does not parse |
| `EFAULT` | 14 | a camera run whose personality's program faulted, at an instruction the run's other errnos do not name. The unit's log names it |
| `ENOSPC` | 28 | a DFU chunk that would run past the update slot's capacity (§11) |
| `ENOENT` | 2 | `XFER_ABORT` with no session to release. `DFU_FINISH` or a `PROGRAM_DATA` chunk under `XFER_TYPE = 1` with no DFU session open (no `DFU_BEGIN`, or the session was evicted as stale). `CAM_RUN` or a personality-info select naming an empty slot. `CAM_ABORT` with no run in progress |
| `EAGAIN` | 11 | the command was dropped at a full device queue before dispatch, so retry |
| `ENODEV` | 19 | a personality-info select on a device without a personality store |
| `EINVAL` | 22 | `CAM_RUN` with a staged parameter value the personality does not accept |
| `ENOTSUP` | 134 | `PEEK_SLOT` on an image of another format version, which the host reads as `the slot holds a personality image of another format version; reinstall it: nxs switch`. A cam personality whose I²C profile tops out below the pod bus's clock. The bus is shared with the register-map target and cannot be slowed for the run |
| `EIO` | 5 | a camera run's register operation failed past its retries (the sensor stopped answering the unit) |
| `ETIMEDOUT` | 116 | a camera run's hard `POLL_REG` did not match within its timeout |
| `EILSEQ` | 138 | a camera run's register read did not match the value its personality expects |
| `ECANCELED` | 140 | a camera run was aborted |

### 12.1 Fault counters

Five counters record faults the device absorbs without failing a command, and a sixth counts the camera runs accepted. Each fault counter saturates at 65535. They are should-be-zero counters, so a saturated value stays sticky evidence instead of wrapping back to a healthy-looking number. A host reads deltas across its observation window.

On I²C they are paged through the diag view: write `DRIVER_SELECT = 3`, write the index to `SEL_VALUE_INDEX`, await each selector's echo, read the u32 at `SEL_VALUE`. The served value is a snapshot taken at the selector write. It never repaints under the reader, so the value whose echo was awaited cannot tear, and re-writing the index refreshes it.

| Index | Counter | Counts | Cyphal register |
|---|---|---|---|
| 0 | `DRDY_COALESCED` | sample intervals missed because the VM was still busy when the sensor signalled data-ready. Counts from the personality load, and only once the personality has begun waiting, since an idle data-ready line registers nothing. Refreshes at the ~100 ms status cadence | `aliensense.nxs.drdy_coalesced_count` |
| 1 | `INGRESS_REJECTS` | host commands rejected by the transport arbiter (§7.5), counted at reject time | `aliensense.nxs.ingress_reject_count` |
| 2 | `I2C_CMD_QUEUE_OVERFLOWS` | host writes dropped at a full I²C command queue (§3) | — |
| 3 | `VM_IO_ERRORS` | measure-loop I/O errors the VM absorbed (~100 ms cadence) | `aliensense.nxs.io_err_count` |
| 4 | `PROBE_FAILURES` | probe give-ups (~100 ms cadence) | `aliensense.nxs.probe_failed_count` |
| 5 | `CAM_RUNS` | camera runs accepted since boot: +1 per accepted `CAM_RUN`, untouched by a refused one. A count, not a fault, wrapping past 65535. The host reads it around `CAM_RUN` to tell this run's verdict from the previous run's terminal state (§6.11) | — |

`nxs status` prints the fault counters (§9).

Serial acknowledgements carry the same codes as signed 16-bit results (0 = success, negative = error).
