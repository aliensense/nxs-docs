---
title: "NXS host interface specification"
sidebar:
  order: 5
---

Applies to: NXS v1.1 · host interface 2 (`PROTO_VERSION` = 2) · map layout 1 (§2) · image format 1.1 (§10.1). The tool names the firmware it requires (§2)

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

---

## 1. Device model

NXS is a sensor co-processor. It runs click personalities as bytecode in an on-device virtual machine. A personality is compiled on the host and uploaded as an NXS image (bytecode and capability descriptors). The VM executes it: it probes the sensor, configures it, and produces fixed-size samples. The host reads samples, sets parameters, manages a persistent personality store, and updates the firmware. It does so over either transport, with identical semantics.

| Interface | Role | Parameters |
|---|---|---|
| I²C | I²C target, one map at two doors | 7-bit addresses `0x30`, the unit door, and `0x31`, the camera door (§4). Standard-mode and Fast-mode (≤ 400 kHz), the clock driven by the master |
| UART | Cyphal/serial host link | 460800 baud, 8N1, no flow control (§8) |

Both transports converge on the same internals. Anything written below for one transport about device behaviour (states, store, DFU model) holds for the other. A smart camera serves the capture cells alone, over I²C at 0x31, and no unit door on either transport (§6.12).

### 1.1 Capability matrix

The management surface is transport-symmetric: every configure, observe, and provision operation works over any single link. Swapping the transport is therefore invisible above the SDK's transport layer. The table is normative. Each row names the mechanism per transport, and the exceptions below it are the complete list of wire-inherent differences.

| Surface | I²C | Cyphal (serial / CAN-FD) |
|---|---|---|
| Presence and identity (probe, serial, firmware version) | `MAP_ID`, `SERIAL`, `FW_VERSION_*` cells | `GetInfo` |
| Personality upload / run / stop / store | `UPLOAD_SIZE`, `UPLOAD_CHUNK`, `CMD` and the `stream` row | file pull + `ExecuteCommand` |
| Stored-slot peek | `STORE_DIRECTORY` and `PERSONALITY_INFO` | `GetDriverInfo(slot)` |
| Parameters (descriptors, get, set) | the rows, the cells and a commit (§6.4) | `GetParamInfo` + `register.Access` |
| Output descriptors | `OUTPUT_ROWS` | `GetOutputInfo` |
| Device-wide decimation | the `decimation` row | `aliensense.nxs.decimation` |
| Per-subject decimation knobs | the `decim.<subject>` rows | `aliensense.nxs.decimation.<subject>` |
| Commissioning (node-ID) | the `can_node_id` row + `Cmd::STORE_PERSIST` | `uavcan.node.id` register + Save |
| Subject-IDs | none: Cyphal registers alone | `uavcan.pub.*.id` registers + Save |
| CAN bit timing | the `can_bitrate` and `can_data_rate` rows + `Cmd::STORE_PERSIST` | `uavcan.can.bitrate` + Save |
| CAN termination | the `can_term` row | `aliensense.nxs.can_term` |
| Sample FIFO depth | the `fifo_depth` row (§6.3) | `aliensense.nxs.sample_fifo.depth` |
| Time discipline (push and state) | `TIME_SYNC` (§6.8) | `aliensense.nxs.time_sync` |
| Firmware update | `DFU_CHUNK` and the DFU commands (§7) | file pull (§7) |
| Recovery trigger | `Cmd::ENTER_RECOVERY` | `ExecuteCommand ENTER_RECOVERY` |
| Identify (LED strobe) | `Cmd::IDENTIFY` | `ExecuteCommand IDENTIFY` |
| Samples | drain the sample FIFO through `SAMPLE_BURST`, or poll `SAMPLE_RECORD` (§6.3) | subscribe to the sample and SI subjects |
| Diagnostics (log stream) | — | subscribe to `uavcan.diagnostic.Record` (8184) |

The wire-inherent exceptions, the complete list. SI pub/sub delivery exists only on Cyphal: I²C polls, and the per-subject knobs configure the Cyphal egress from any link. The subject-IDs name Cyphal subjects, so they are Cyphal registers alone, set over a Cyphal transport (§6.7). The diagnostic log stream is likewise Cyphal-only, since an asynchronous push has no I²C equivalent.

A refused commit reports in `STATE` and `ERROR` on I²C (§6.4). Cyphal's `register.Access` echoes the accepted value. On a VM fault, Cyphal's `Status.last_error_code` falls back to a sticky error kind when the VM byte is 0, and I²C has no counterpart (§12).

A `uavcan.node.id` read is per-link (§8.2.8). The DFU mechanism and speed differ: the host paces 128-byte chunks on I²C, and the device pulls the image on Cyphal. Both serve a field's scale and offset as float64, I²C in the output rows (§6.6). Recovery can be triggered from either transport. MCUboot itself speaks only mcumgr over the host UART, so completing a recovery upload always needs that UART. An I²C-only integration can put a unit into recovery and cannot get it out again.

## 2. Interface version

The cell `PROTO_VERSION` (`0x0019`, read-only) identifies this host interface. This document describes version `2`. The version counts revisions of the contract as a whole: the map, the commands and the procedures. A change that gives an existing cell a new meaning increments it. Growth in reserved space does not: a new command, a new parameter id or a new cell in a reserved span rides a PATCH release.

The map's layout carries its own witness, `MAP_VERSION` (`0x0001`), which a kernel driver checks at probe. It counts layout revisions of the capture cells, and a driver refuses a version it does not know.

Version `1` was the interface of an 8-bit register map. A device of that version is one `nxs switch` upgrades in the field (§7.3), and no other verb drives it. The cell sits at `0x0019` so that a tool of version `1` reads it through its 1-byte pointer and refuses with a sentence.

Independently of the contract, the `nxs` tool names the firmware it requires. Every verb but `probe`, `push-fw`, `recover`, `reboot` and `confirm-fw` refuses a device whose build identity (§6.10) is older than that firmware. The refusal prints the update command. A host therefore never drives a device with verbs it lacks.

---

## 3. I²C transport

### 3.1 Transactions

A register pointer is two bytes, the address high byte first. Multi-byte cells are little-endian.

- **Write**: `[address high] [address low] [data …]` in one transaction. The pointer auto-increments on each byte, so one write fills a contiguous span of cells. A write that carries no data moves the pointer alone.
- **Read**: write the pointer, then read N bytes under a repeated start. The pointer auto-increments on each byte read, so a block read returns a contiguous span.

A transaction that writes one pointer byte addresses `0x00NN`. A tool of interface version `1` therefore reads the identity at `0x0000` and `PROTO_VERSION` at `0x0019` with its own transactions, and refuses cleanly (§2).

A read of a region that serves a cursor, the sample burst (§6.3), writes the cursor after the pointer in the transaction that then reads. A region of chunk cells, an upload or a firmware image (§6.1, §7.3), takes the chunk's cursor and its bytes in one write. Nothing a transaction writes changes what a later transaction's address means, so two hosts, a kernel driver and the tool never disturb each other.

A unit masters its own buses between the host's transfers, so the host controller runs multi-master. A transfer that loses arbitration ends in `EAGAIN`, and the host repeats it after `BUSY_RETRY_MS`, 1 ms, `BUSY_RETRIES` times, 8, at most. A unit that stops serving a read mid-way answers the rest of it with `0xFF` bytes and no error. A host therefore checks what a multi-byte read says before it uses it (§6.3, §6.4). Inside a commit window a NAK reads as busy (§6.4).

### 3.2 Write semantics

A write lands at the transaction's stop. The device takes a command, a commit, a chunk and a record write after the stop, so a transaction ACK means *accepted*, not *applied*. Completion is observed through the status cell each procedure names. That is `CMD_ERROR` and `CMD_COUNT` for a command, `STATE` for a commit, `DFU_ACK` for a firmware chunk and `RUNNER_STATE` for a personality load.

The device queues such writes 8 deep. A host that paces on the named status cell cannot overflow it. A write dropped at a full queue is counted (§12). A dropped command that had armed `CMD_ERROR` resolves it to `EAGAIN`, so the poll fails at once instead of timing out.

### 3.3 Read consistency

A read latches the first `MAP_LATCH_SIZE` bytes of the map, `0x0000` to `0x07FF`, at its first byte. A block read of the header, the cell arrays, the commit block and the mode table is therefore one coherent snapshot. The rows at `0x0800` and beyond are static once loaded and serve without a latch.

- **Pacing cells are one byte wide** (`STATE`, `CMD_ERROR`, `CMD_COUNT`, `DFU_ACK`, `RUNNER_STATE`, `STATUS`, …). A one-byte read is served in a single transaction and cannot tear.
- **The sample record is latched per transaction.** The device snapshots the whole record when a read transaction first touches `SAMPLE_RECORD`, and serves every byte, across chunked continuations, from that snapshot (§6.3).
- **A sample burst is latched per transaction.** A read that follows a cursor written after the `SAMPLE_BURST` pointer is built whole at its first byte and served from that copy (§6.3).
- **The unit's regions past the mode table** serve live. The calibration record, which a host writes and reads back, is bracketed on its counter (§6.9).

---

## 4. Register map

One map serves at two addresses on one peripheral. The unit door at `0x30` serves every cell. The camera door at `0x31` serves the capture cells, and every other cell reads 0 there and ignores writes. A smart camera serves the capture cells alone (§6.12). The machine-readable source of the layout is `constants/nxs_map.yaml`.

The map spans `0x0000` to `0xFFFF`, and the personality-info region at `0x8000` closes it (§4.6). Reserved cells, and every address no region names, read 0 and ignore writes (§4.7). Access: RO = read-only, RW = read/write, W1 = a write of 1 acts and the cell reads 0.

The capture cells are the header's capture fields, the parameter rows, their cell arrays, the commit block and the mode table. A kernel driver that knows no sensor reads them at probe, builds one control from each row and asks for changes in the row's unit. The device converts each request to its sensor's registers with the law it holds. A pod's unit converts through its cam personality's programs under the sensor's group hold, a smart camera in its own logic.

### 4.1 The header

`0x0000` to `0x003F`. The capture fields come first, the unit's state after them. A smart camera and the camera door read 0 in the unit's fields.

| Address | Cell | Access | Bytes | Meaning |
|---|---|---|---|---|
| `0x0000` | `MAP_ID` | RO | 1 | `0xAB` at the unit door, `0xC4` at the camera door and on a smart camera |
| `0x0001` | `MAP_VERSION` | RO | 1 | Layout version of the map, `1` (§2) |
| `0x0002` | `STATE` | RO | 1 | `0` INERT, `1` READY, `2` BUSY, `3` FAULT: the state of the commit engine both doors share (§6.4) |
| `0x0003` | `ERROR` | RO | 1 | Positive errno of the commit that last ended FAULT, `0` otherwise. The next accepted `COMMIT` clears it |
| `0x0004` | `FW_VERSION_MAJOR` | RO | 1 | The running firmware's major version, `0` on a smart camera |
| `0x0005` | `FW_VERSION_MINOR` | RO | 1 | |
| `0x0006` | `PARAM_COUNT` | RO | 1 | Rows served at `ROWS` through this door, 64 at most. The camera door counts the camera personality's rows alone |
| `0x0007` | `MODE_COUNT` | RO | 1 | Rows in the mode table, 16 at most, `0` on a unit that runs no camera personality |
| `0x0008` | `CURRENT_MODE` | RO | 1 | The mode-table value in effect, `0xFF` before the first run |
| `0x0009` | `STREAM` | RO | 1 | `0` standby, `1` streaming or sampling: the value of the `STREAM` row |
| `0x000A` | `APPLY_COUNT` | RO | 1 | Wrapping count of commits that ended READY with a row applied, at either door |
| `0x000B` | `FAULT_COUNT` | RO | 1 | Wrapping count of commits that ended FAULT |
| `0x000C` | `OUTPUT_COUNT` | RO | 1 | Rows served at `OUTPUT_ROWS`, 16 at most |
| `0x000D` | `SAMPLE_SIZE` | RO | 1 | Bytes of one sample record's data, 110 at most, `0` while no sampling personality runs |
| `0x000E` | `SAMPLE_COUNT` | RO | 2 | Wrapping count of samples the running personality produced |
| `0x0010` | `MODE_RUN_MS` | RO | 2 | How long the last RUN commit took, milliseconds, `0` before the device completed one |
| `0x0012` | `GATE_RUN_MS` | RO | 2 | How long the last GATE commit took |
| `0x0014` | `TRIGGER_RUN_MS` | RO | 2 | How long the last TRIGGER commit took |
| `0x0016` | `APPLY_RUN_MS` | RO | 2 | How long the last APPLY commit took from the `COMMIT` byte to READY, `4` before the device completed one (§6.4) |
| `0x0018` | `MODULE_KIND` | RO | 1 | `1` a unit, `2` a pod, `3` a smart camera, `4` a smart module, each with the ports §10.1 names |
| `0x0019` | `PROTO_VERSION` | RO | 1 | This interface's version, `2` (§2) |
| `0x001A` | `VM_STATE` | RO | 1 | `0` IDLE, `1` RUNNING, `2` ERROR, of the main VM |
| `0x001B` | `RUNNER_STATE` | RO | 1 | `0` NO_DRIVER, `1` LOADING, `2` PROBING, `3` MEASURING, `5` PROBE_FAILED (§6.2) |
| `0x001C` | `STORE_COUNT` | RO | 1 | Populated slots of the personality store |
| `0x001D` | `ACTIVE_SLOT` | RO | 1 | The slot the main VM runs, `0xFF` for a transient image |
| `0x001E` | `DESCRIPTOR_EPOCH` | RO | 1 | Generation of the row set: `0` until the first load, then +1 on every load (§6.6) |
| `0x001F` | `FW_VERSION_PATCH` | RO | 1 | |
| `0x0020` | `CLICK_ADDR` | RO | 1 | The latched mikroBUS I²C address of the running sampling personality, `0` while none runs on I²C |
| `0x0021` | `VM_ERROR` | RO | 1 | The main VM's error byte: `0` while healthy, else the code the faulting personality raised (§12) |
| `0x0022` | `PROBE_RETRIES` | RO | 1 | The sample runner's current probe-retry count |
| `0x0023` | `STATUS` | RO | 1 | Bit 0 `SAMPLE_READY`, bit 1 `ERROR`, bit 7 `RUNNING`, one byte for a cheap poll |
| `0x0024` | `CALIBRATION_EPOCH` | RO | 1 | The calibration record's change counter, +1 on every apply, the bracket of a `CALIBRATION` read (§6.9) |

### 4.2 The command block

`0x0040` to `0x004A`. A command and its argument are one write of `CMD_ARG` and `CMD` (§5).

| Address | Cell | Access | Bytes | Meaning |
|---|---|---|---|---|
| `0x0040` | `CMD_ARG` | RW | 1 | The argument of the next `CMD`: a slot for the store commands, else `0` |
| `0x0041` | `CMD` | W1 | 1 | The command opcode (§5), taken at the transaction's stop. Bit 7 is the optional doorbell |
| `0x0042` | `CMD_ERROR` | RO | 1 | Result of the last command: `0`, a positive errno (§12), or `0xFF` while it runs |
| `0x0043` | `CMD_COUNT` | RO | 1 | Wrapping count of commands taken, so a host tells its command's result from the previous one's |
| `0x0044` | `UPLOAD_SIZE` | RW | 2 | The size of the image an upload session delivers. Writing it opens the session, `LOAD` closes it (§6.1) |
| `0x0046` | `DFU_PHASE` | RO | 1 | `0` IDLE, `1` ERASING, `2` READY, `3` WRITING, `4` FINISHING, `5` ERROR (§7.3) |
| `0x0047` | `DFU_ACK` | RO | 1 | Wrapping count of firmware chunks taken |
| `0x0048` | `PROC_STATE` | RO | 1 | `0` idle, `1` gyro waiting for stillness, `2` gyro averaging, `3` magnetometer collecting (§6.9) |
| `0x0049` | `PROC_DETAIL` | RO | 1 | The procedure's progress: the percent averaged, or the rotation coverage of 14 |
| `0x004A` | `SESSION` | RO | 1 | `0` none, `1` an upload, `2` a firmware update, `3` a procedure: what the device holds (§7.5) |

### 4.3 The parameter cells

Five arrays of 64 cells of 4 bytes each. Cell i belongs to row i. The staged array runs downward so that a commit is one write from the highest staged row's cell through `MASK` and `COMMIT` (§6.4).

| Address | Array | Access | Meaning |
|---|---|---|---|
| `0x0100` | `LIVE` | RO | The value of row i in effect, in the row's unit, a signed row in two's complement. `0` while INERT |
| `0x0200` | `MIN` | RO | The lowest value row i takes in the mode and line time in effect, painted by the device. `0` for an enum row |
| `0x0300` | `MAX` | RO | The highest value row i takes in effect. The count minus one for an enum row |
| `0x0400` | `STEP` | RO | The increment of row i. `1` for an enum row |
| `0x0500` | `STAGED` | RW | The host's request for row i, taken by `COMMIT` when bit i of `MASK` is set. Row i's cell is at `0x0600` − 4 (i + 1), row 0's the last before `MASK` |
| `0x0600` | `MASK` | RW | 8 bytes. Bit i names row i as staged for the next `COMMIT` |
| `0x0608` | `COMMIT` | W1 | Write `1` to apply the masked rows. Accepted in READY or FAULT |

Cells at or past `PARAM_COUNT` read 0. The camera door indexes the camera personality's rows from 0, so cell i there is that personality's row i. The unit door indexes every row it serves.

### 4.4 The mode table

`0x0700`, 16 rows of 16 bytes, in the device's mode order. Rows at or past `MODE_COUNT` read 0.

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `WIDTH` | 2 | Pixels |
| 2 | `HEIGHT` | 2 | Lines |
| 4 | `BIT_DEPTH` | 1 | Bits per pixel on the wire: 8, 10 or 12 |
| 5 | `LANES` | 1 | CSI-2 lanes the mode drives |
| 6 | `RATE_MBPS` | 2 | The lane rate |
| 8 | `DATA_TYPE` | 1 | The RAW sample depth of the pixel stream, 10 or 12. The CSI-2 data type follows from it: RAW10 `0x2B`, RAW12 `0x2C` |
| 9 | `FLAGS` | 1 | Bit 0: the row a run configures when no mode is staged. Bit 1: the row takes the trigger conversions |
| 10 | `FPS_MAX_MILLI` | 4 | The mode's top rate in thousandths of a frame per second |
| 14 | `MODE_VALUE` | 1 | The value that selects the row in the `MODE` parameter, what `CURRENT_MODE` reports |
| 15 | `PIXEL_PHASE` | 1 | The Bayer order of the row before any flip: `0` RGGB, `1` GRBG, `2` GBRG, `3` BGGR. `0xFF` when the device's capture table names none |

The Bayer order in effect is `PIXEL_PHASE` XOR the `FLIPS` parameter's bits.

### 4.5 The parameter rows

`0x0800`, `PARAM_COUNT` rows of 64 bytes, the `PARAMS` records' bytes verbatim (§10.1). A parameter row describes one parameter, and a trigger row's values are each a trigger code of the registry below. A unit serves every running personality's rows, the owning slot in each row's flags, and the device's own knobs as rows owned by the device. A smart camera serves its memory.

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `NAME` | 16 | ASCII, 15 characters at most, NUL-padded: the parameter's name, what `nxs set` takes and a custom control carries |
| 16 | `UNIT` | 6 | ASCII, NUL-padded: the unit of every value of the row. Fixed per id for a standard row, empty for an enum |
| 22 | `ID` | 2 | The parameter id, the standard meaning the host maps to its control. `0` is a custom row the host offers by name |
| 24 | `TYPE` | 1 | Bit 0: `1` a range of min, max and step, `0` an enum. Bit 1: the values are signed. Bit 2: an enum's values are 32 bits wide |
| 25 | `KIND` | 1 | How a commit of this row runs: `0` APPLY, `1` RUN, `2` GATE, `3` TRIGGER (§6.4) |
| 26 | `FLAGS` | 1 | Bit 0: read-only, the device paints the row. Bit 1: under the fast trigger the pulse width sets the value, so a driver leaves the row out of its commits then. Bit 2: the graph's owner sets the row from the rig's facts, and a driver offers it read-only. Bits 5 to 7: the owner tag: `7` the device's own rows, a personality's slot below 7, else a tag no other owner carries |
| 27 | `COUNT` | 1 | An enum row's value count, 16 at most, or 8 when its values are 32 bits wide. `3` for a range row |
| 28 | `DEFAULT` | 4 | The value the row takes when the device configures its sensor |
| 32 | `VALUES` | 32 | An enum row: `COUNT` u16 values in the device's order, or u32 values when bit 2 of `TYPE` is set. A range row: min, max and step as u32, the rest `0` |

The standard ids and their units:

| Id | Meaning | Unit | Kind |
|---|---|---|---|
| 0 | `CUSTOM`: the host offers the row by its name | the row's own | the row's own |
| 1 | `EXPOSURE_US` | `us` | APPLY |
| 2 | `FRAME_RATE_MFPS`: the frame rate in thousandths of a frame per second | `mfps` | APPLY |
| 3 | `GAIN_MDB` | `mdB` | APPLY |
| 4 | `BLACK_LEVEL_DN`, at the mode's bit depth | `DN` | APPLY |
| 5 | `FLIPS`: an enum of `0` to `3`, bit 0 mirrors left to right, bit 1 top to bottom | | APPLY |
| 6 | `TEST_PATTERN`: the device's codes, `0` first for off | | APPLY |
| 7 | `TRIGGER`: the device's trigger conversions by the `TriggerCode` registry. `0` is free run. `1` is fast, where the pulse width is the exposure. `2` is sequential, one frame per pulse at the exposure row's value. `3` and up are the device's other conversions | | TRIGGER |
| 8 | `STREAM`: `0` standby, `1` streaming or sampling. Every personality that streams or samples carries one | | GATE |
| 9 | `MODE`: a `MODE_VALUE` of the mode table | | RUN |
| 10 | `TEMPERATURE_DC`, signed, read-only, `0x80000000` while unread | `dC` | |
| 11 | `FOCUS_POSITION`, the focus in steps, reserved | `step` | APPLY |
| 12 | `APERTURE`, the f-number times 100, reserved | `f*100` | APPLY |
| 13 | `ZOOM`, the magnification times 100, reserved | `x*100` | APPLY |
| 14 | `SAMPLE_RATE_HZ`, a sampling personality's rate | `Hz` | RUN |
| 15 | `FIFO_DEPTH`, the device's row: records the sample queue keeps before it overwrites the oldest, `0` for all it holds | `rec` | APPLY |
| 16 | `DECIMATION`, the device's rows: `decimation`, the gate on the sample window and every subject, and one per Cyphal SI subject. Those are `decim.accel`, `decim.gyro`, `decim.mag`, `decim.temp`, `decim.press`, `decim.gnss` and `decim.scalar`. `0` off, `1` every sample, `N` every Nth | | APPLY |
| 17 | `CAN_TERMINATION`, the device's row: the CAN split termination, `0` off, `1` on | | APPLY |
| 18 | `MOUNT_ORIENTATION`, a click personality's row: the mount rotation of the sensor's frame, a rotation code `0` to `23` (§6.9) | | APPLY |
| 19 | `CAN_NODE_ID`, the device's row: the unit's Cyphal node-ID, `0` to `125` static or `255` anonymous. `STORE_PERSIST` keeps it, and the next boot runs it (§6.7) | | APPLY |
| 20 | `CAN_BITRATE`, the device's row: the CAN arbitration rate, one of the profiles' nominal rates, judged with `CAN_DATA_BITRATE` as a pair at the commit. The next boot runs it (§6.7) | `bps` | APPLY |
| 21 | `CAN_DATA_BITRATE`, the device's row: the CAN data-phase rate, the nominal rate for Classic CAN and above it for CAN FD. The next boot runs it (§6.7) | `bps` | APPLY |

A host reads the rows before its first commit, at probe or at the start of each session. A standard id names its control: a kernel driver maps the id to the control its framework knows and converts no unit. A driver may offer a custom row as a control with the row's name, type and values. A row the driver does not understand is left alone, and nothing else on the map changes meaning. A driver that meets an id above the registry it knows treats the row as custom. Ids 14 to 21 are rows of a unit, which the camera door does not serve.

The `PRESENTATION` record of the image a row comes from says how the row reads to a person (§10.1). It gives the row a display unit, a decimal exponent and a name per value where the values have names. The tool prints the camera's gain row, served in `mdB`, in dB from it. The device's own rows have no such record and read in their own unit.

### 4.6 The unit's regions

`0x1800` and up. The camera door and a smart camera read 0 here and ignore writes.

| Address | Region | Access | Bytes | Meaning |
|---|---|---|---|---|
| `0x1800` | `OUTPUT_ROWS` | RO | 16 × 64 | `OUTPUT_COUNT` output descriptor rows, the `OUTPUTS` record's rows with the scale in effect (§6.6) |
| `0x1C00` | `SERIAL` | RO | 12 | The chip's UID96, MSB first |
| `0x1C10` | `BUILD_INFO` | RO | 64 | The firmware's build record (§6.10) |
| `0x1CC0` | `TIME_SYNC` | RW | 32 | The host's clock relation. The device takes a written record at the transaction's stop (§6.8) |
| `0x1D00` | `CALIBRATION` | RW | 4 × 64 | The calibration record in effect, in four blocks. A write patches the staged copy, `CALIB_APPLY` applies it (§6.9) |
| `0x1E00` | `DIAG` | RO | 16 × 2 | The fault counters and the errno cells (§12) |
| `0x1F00` | `STORE_DIRECTORY` | RO | 8 × 16 | What each slot of the personality store holds (§6.5) |
| `0x6000` | `SAMPLE_RECORD` | RO | 128 | The latest sample record (§6.3) |
| `0x6100` | `SAMPLE_BURST` | RO | 256 | The sample queue, read with a cursor (§6.3) |
| `0x6200` | `UPLOAD_CHUNK` | W | 132 | One chunk of an image upload: a u32 cursor, then up to 128 bytes (§6.1) |
| `0x6300` | `DFU_CHUNK` | W | 132 | One chunk of a firmware image, the same shape (§7.3) |
| `0x8000` | `PERSONALITY_INFO` | RO | 8 × 4096 | Each slot's descriptor trailer, slot k at `0x8000 + 4096 k`, served from flash (§6.5) |

### 4.7 Reserved spans

The spans below are reserved for the growth of the region before them. They read 0 and ignore writes, and a cell placed in one rides a PATCH release (§2).

| Span | Reserved for |
|---|---|
| `0x0025` to `0x003F` | the header |
| `0x004B` to `0x00FF` | the command block, before the cell arrays |
| `0x0609` to `0x06FF` | the commit block |
| `0x1C50` to `0x1C7F` | the identity |
| `0x1C80` to `0x1CBF` | the regions after the build info |
| `0x1CE0` to `0x1CFF` | the time-sync record |
| `0x1E20` to `0x1EFF` | the fault counters |
| `0x1F80` to `0x1FFF` | the store directory |
| `0x6400` to `0x7FFF` | the regions after the chunk cells |

---

## 5. Commands

A command is one write of `CMD_ARG` then `CMD` (`0x0040`, `0x0041`), two bytes after the pointer. Bit 7 (`0x80`) of the opcode is an optional doorbell. A host may write `opcode | 0x80` so that opcode `0` (`LOAD`) is distinguishable from an idle cell. The device masks bit 7 before dispatch. A command that takes no argument ignores `CMD_ARG`, and a host that writes `CMD` alone leaves the argument as it stands.

Every command reports in `CMD_ERROR` and advances `CMD_COUNT` when it is taken. The error cell reads `0` for success, else a positive errno (§12). It reads `0xFF`, pending, from the moment the command is taken until its result lands, and the host polls that edge. A host that cannot tell its own command's result from the previous one's reads `CMD_COUNT` before and after. `REBOOT`, `ENTER_RECOVERY` and `DFU_FINISH` answer with the reset itself. A failed `DFU_FINISH` latches its errno and does not reboot (§7.3).

What a commit says is not a command. The stream and the sampling start and stop through the `STREAM` row, a mode through the `MODE` row, and every parameter through its row (§6.4).

| Opcode | Name | Argument | Action |
|---|---|---|---|
| 0 | `LOAD` | | Close the upload session and run the delivered image: a sampling image on the main VM, a camera image on the camera run. `0` when the device validated the header (§10.1) and parsed the image. `ENODATA`: the chunks are short of `UPLOAD_SIZE`, a transport loss, and the personality loaded before stays. `ENOEXEC`: not a valid personality image. `ENOTSUP`: an image of another format version (§10.1). A failed parse leaves the no-personality state. The image is transient until `SAVE` |
| 1 | `SAVE` | slot | Keep the running image in the slot. `ENOENT` with nothing running, `EEXIST` for a duplicate, `ENOSPC` for a full store, `ENOTSUP` for an image the store does not take (§6.5) |
| 2 | `DELETE_SLOT` | slot | Empty the slot. Later images move down one slot |
| 3 | `CLEAR_STORE` | | Empty every slot |
| 4 | `ACTIVATE_SLOT` | slot | Run the slot: a sampling image on the main VM, a camera image on the camera run. A camera image then takes its configure from a RUN commit of the `MODE` row (§6.11). `ENOENT` for an empty slot, `EBADF` for an image that does not parse |
| 5 | `ABORT` | | Stop a commit in flight within 50 ms. `0` when one was stopped, `ENOENT` when none ran. The commit ends FAULT with `ECANCELED` |
| 6 | `DFU_BEGIN` | | Open the firmware-update session and erase the staging slot (§7.3) |
| 7 | `DFU_FINISH` | | Close the session, check the staged image, arm the swap and reboot to apply (§7.3) |
| 8 | `REBOOT` | | Reboot the device. A pending swap applies on boot |
| 9 | `CONFIRM_FW` | | Confirm the running firmware so the bootloader keeps it across the next reset (§7.2). Idempotent. `EBUSY` while a session is open |
| 10 | `ENTER_RECOVERY` | | Arm the bootloader's serial recovery and cold-reset into it (§7.4). The reset is the acknowledgement. A failed flag write keeps the device in the application with the errno in `CMD_ERROR` |
| 11 | `STORE_PERSIST` | | Keep the node-ID and the CAN profile the device rows committed, with the device's other rows and the calibration in effect (§6.7) |
| 12 | `CALIB_APPLY` | | Validate the staged `CALIBRATION` record and apply it to the running state (§6.9). `EBUSY` while a session or a procedure holds the device, `EINVAL` for a malformed record |
| 13 | `CALIB_PERSIST` | | Keep the calibration in effect. `ENODEV` with no calibration bank |
| 14 | `CAL_GYRO` | | Start the on-device gyro still average (§6.9). `EBUSY` during a magnetometer collection, `EOPNOTSUPP` with no gyro vector, `ENODATA` while the personality is not measuring |
| 15 | `CAL_MAG_START` | | Start the on-device magnetometer collection (§6.9) |
| 16 | `CAL_MAG_STOP` | | Close the collection: coverage-gate, solve, self-check, apply. `CMD_ERROR` carries the fit verdict (§6.9) |
| 17 | `IDENTIFY` | | Strobe the status LED for about 10 s so an operator can locate the unit. A repeat re-arms the window |
| 18 | `SESSION_ABORT` | | Close an open upload or firmware-update session, or drop a procedure without solving, from any host. `0` when one was closed, `ENOENT` when none was open |


---

## 6. Procedures (I²C)

### 6.1 Personality upload

An upload is a session. From the size announce to `LOAD`, the device holds the session for the uploader, and `SESSION` reads `1`. Every step reports its verdict before the next may proceed. A chunk carries its own place in the image, so nothing a chunk writes can land anywhere else.

```d2 title="The personality upload over I²C, from the announce to the stream row"
# The personality upload over I²C (Interface Description §6.1): one session
# from the size announce to LOAD, every step answered before the next, each
# chunk placed by its own cursor.

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

shape: sequence_diagram

host: Host
unit: NXS unit

check: "1. Check for a live session" {
  host <- unit: "read SESSION: 0 (else SESSION_ABORT, or try later)"
}

announce: "2. Announce the image" {
  host -> unit: "write UPLOAD_SIZE (u16, one write)"
  host <- unit: "CMD_ERROR: pending, then 0 (session open) or EBUSY, EFBIG"
}

stream: "3. Write the image, chunks of a u32 offset and up to 128 bytes" {
  host -> unit: "write UPLOAD_CHUNK: offset, bytes"
  host -> unit: "write UPLOAD_CHUNK: offset, bytes …"
}

load: "4. Load" {
  host -> unit: "write CMD = LOAD"
  host <- unit: "CMD_ERROR: pending, then 0 (parsed, running) or ENODATA, ENOEXEC, ENOTSUP; the session ends"
}

run: "5. Start the sampling" {
  host -> unit: "commit the stream row: STAGED, MASK, COMMIT in one write"
  host <- unit: "STATE: BUSY, then READY; RUNNER_STATE: MEASURING, or PROBE_FAILED with VM_ERROR"
}
```

1. Read `SESSION`. A value other than `0` names a live session, an upload, a firmware update or a procedure. Release it deliberately with `CMD = SESSION_ABORT` or try later.
2. Announce the image: write the total size to `UPLOAD_SIZE` (u16, one write). The announce arms `CMD_ERROR` with pending, so poll it out. `0` opens the session. `EBUSY` means a session is live. `EFBIG` means the size exceeds the staging buffer (§11).
3. Write the image as chunks to `UPLOAD_CHUNK`. Each write carries the chunk's byte offset as a u32, a multiple of 128, and 128 bytes. The image's last chunk carries its remainder. The device refuses a chunk past the announce with `ENOSPC` and keeps the session. It refuses one of another size or offset with `EINVAL`. Chunks arrive in any order, and a chunk tolerates a rewrite.
4. Write `CMD = LOAD`. Poll `CMD_ERROR` out of pending. `0` means the device validated the header (§10.1), parsed the image and runs it. A sampling image runs on the main VM, a camera image on the camera run. Only then has the upload happened. `LOAD` ends the session either way.

   `ENODATA`: the chunks are short of the announce, refused before the parse, so the personality loaded before stays. `ENOEXEC`: the bytes are not a valid personality image. `ENOTSUP`: an image of another format version, one a newer firmware runs (§10.1). A failed parse leaves the device in the no-personality state.
5. Start the sampling with a GATE commit of the `STREAM` row (§6.4). A GATE commit of `0` stops it. A load replaces a running personality in place.

A session abandoned mid-stream (a crashed host) releases itself after 5 s of holder silence. The partial stage is discarded when the next contender takes over. `SESSION_ABORT` releases it immediately.

### 6.2 Run state

`RUNNER_STATE` is the personality lifecycle. It runs NO_DRIVER → PROBING → MEASURING from a GATE commit of `STREAM` `1`. It reads LOADING while a GATE commit of `0` holds a loaded personality parked. A commit is accepted before the device starts the probe. Until then the cell still reads the state before the commit, the last personality's MEASURING or PROBE_FAILED included. A sensor that fails its probe `PROBE_RETRIES` times enters PROBE_FAILED.

If other store slots hold sampling images, the device advances to the next slot autonomously.

A host that caches anything derived from the loaded personality (sample layout, rows) validates the cache against `DESCRIPTOR_EPOCH` (§6.6). The epoch advances on every personality (re)load, autonomous slot changes included.

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

On every entry into PROBING the device cold-resets the sensor before reading WHO_AM_I. It pulses the shared mikroBUS reset line (assert, hold, release, settle), so every bind, including an autonomous slot advance, probes a freshly-reset part. Reset polarity is per-personality. A personality for an active-high-reset part exposes a `reset_active` row, an enum, `1` active-high and `0` active-low. The row is RAM-backed and reverts to its compiled default on reset. The device reads it at bind to drive the correct physical level, and its absence selects the active-low default.

The row is discoverable through the normal parameter path (§6.4). It reflects the part's fixed datasheet polarity rather than a per-deployment override.

### 6.3 Sample readout

`SAMPLE_RECORD` (`0x6000`, 128 bytes) holds one record, little-endian throughout:

| Offset | Field | Size | Content |
|---|---|---|---|
| 0 | `latch_time_us` | 8 | Device µs clock at the instant this read transaction latched the record (§6.8) |
| 8 | `timestamp_us` | 8 | The sample's acquisition instant, device µs clock. It is the delivered DRDY edge (or declared frame bound) behind its measure pass, or the commit instant where the pacing carries no event |
| 16 | `seq` | 2 | Sample sequence number, wraps at 2^16 |
| 18 | data | `SAMPLE_SIZE` | Raw sample bytes, ≤ 110 |

Readout is a single (optionally chunked) read of `18 + SAMPLE_SIZE` bytes from `0x6000`. The device latches the whole record when the transaction first touches the region and serves every byte from that snapshot. `seq`, `timestamp_us`, and data are therefore coherent by construction, with no guard counter and no retry. Compare `seq` against the previous read to detect a new sample. Or pre-check `STATUS` bit 0 with a one-byte read when polling faster than the sample rate. A `seq` moving backward signals a personality restart, so re-read `SAMPLE_SIZE` and the descriptors (§6.6).

Between a personality unload and the next load `SAMPLE_SIZE` serves 0 and the descriptor set is empty (`DESCRIPTOR_EPOCH` = 0, §6.6). A host must treat a 0 size, like a backward `seq`, as transitional: re-read rather than cache it.

Sample content is defined by the personality's output rows (name, type, byte order, scale, offset, unit, semantic per field). They travel inside the NXS image and are readable on the device (§6.6), so decoding a sample requires no personality file on the host. An addressed `nxs status` prints the descriptor set in its `Outputs:` block.

The record always holds the latest sample, so the host can decimate further by polling slower than the device produces. The device's `decimation` row (§4.5) is the device-output gate. At the default `1` the record and `SAMPLE_READY` advance on every sample, `N` advances them only every Nth sample, and `0` stops output entirely. The gate is device-wide: it applies identically to the I²C record and to the Cyphal sample and SI subjects. `STORE_PERSIST` persists it across power cycles. Per-subject SI decimation is a separate refinement thinning only the Cyphal SI fan-out (§8.2.7): the rows `decim.<subject>` over I²C, the `aliensense.nxs.decimation.<subject>` registers over Cyphal.

#### Sample FIFO

The device queues every sample that clears the `decimation` gate. A host therefore reads batches and loses nothing while it is late by less than the queue's depth. Every queued record takes the next FIFO index, a u16 that wraps. The host names the index it wants next, the cursor, by writing two bytes after the register pointer in the transaction that then reads:

```
S addr W | 0x61 | 0x00 | cursor_lo | cursor_hi | Sr addr R | burst … | P
```

| Offset | Field | Size | Content |
|---|---|---|---|
| 0 | `latch_time_us` | 8 | Device µs clock at the first read byte, as in the record (§6.8) |
| 8 | first index | 2 | FIFO index of the first record served |
| 10 | count | 1 | Records in this burst |
| 11 | record size | 1 | Bytes per record, `10 + SAMPLE_SIZE` |
| 12 | pending | 2 | Records still queued behind this burst |
| 14 | records | count × record size | Oldest first, each `timestamp_us` u64, `seq` u16, then the sample bytes |

A burst is at most 256 bytes. The device releases the records before the cursor and serves from it on. A record leaves the queue only once a later cursor has passed it. A repeated read with the same cursor therefore returns the same records, so a failed transfer loses nothing.

A torn read is a failed transfer too. Its sign is a header no device builds: a record size past the sample cap, or a count past the burst. A record stamped past `latch_time_us`, or before the record ahead of it, is one too. Past the last record of the burst the device serves `0x00`. A host reads eight bytes past the last record it wants, and a read that ends in `0xFF` there is torn too. The host repeats a torn read with the same cursor.

A host that reads fewer bytes than the burst advances its cursor by the whole records it received. To start from the present, a host reads the 14-byte header with any cursor and continues from `first index + count + pending`.

When the device has overwritten the record the cursor names, it serves from its oldest record. The first index is then ahead of the cursor, and the difference is the number of samples lost. A difference of 2^15 or more means the device restarted its index, and the host continues from the first index without counting a loss. A personality load drops the queue and the index keeps counting.

The queue holds 2048 bytes of records, 85 samples of a 14-byte IMU personality. Its depth is the device's `fifo_depth` row (§4.5), 0 to 255 records. The default 0 is all the storage holds, and a larger value than that is clamped. A commit of the row applies live and `STORE_PERSIST` keeps it. Its Cyphal register is `aliensense.nxs.sample_fifo.depth` (§8.2.7).

### 6.4 Parameters and commits

Every parameter of every running personality is a row (§4.5), and so is every knob of the device itself. A host reads a row's descriptor at `ROWS`, its value in effect at `LIVE` and its range in effect at `MIN`, `MAX` and `STEP`. It changes rows by a commit: it writes the values to `STAGED`, names them in `MASK` and writes `COMMIT`. The unit door serves every row. The camera door serves the camera personality's rows, re-indexed from 0, and a kernel driver drives them there (§6.11).

**The commit transaction.** A commit is one write. It starts at the `STAGED` cell of the highest row the host stages. It runs through the cells of the rows below it and ends on `MASK` and `COMMIT`. The staged array runs downward for that reason. A commit of the first rows, exposure, rate and gain, is 21 bytes after the pointer. Exposure and gain alone take the same 21 bytes, with the rate's bit of `MASK` clear.

Cells the host does not mean to stage stay out of `MASK`, whatever the write puts in them. A transaction the bus cuts never reaches `COMMIT`, so nothing half-written applies.

`COMMIT` is accepted in READY or FAULT. The write takes `STAGED` and `MASK` as they stand, and `STATE` turns BUSY at once. A cell written after it waits for the next `COMMIT`. A `MASK` of `0` returns to READY and counts nothing. A `COMMIT` written while BUSY or INERT is ignored.

**Kinds.** Every masked row shares one owner and one kind, the row's `KIND`:

- **APPLY**: the rows take effect in the running state, together. On a camera that is within the frame under the sensor's group hold: exposure, rate, gain, black level, test pattern and flips. The exposure row clamps under the frame the commit applies, less the sensor's margin. That frame is the period of the rate the same commit stages, or the one in effect. One commit therefore lengthens the frame and the exposure together, past the exposure's painted `MAX`. On a sampling personality an APPLY row is read in place by the running loop.
- **RUN**: the rows are patched into the personality and its configure re-runs once, with every masked row at its new value. A RUN commit is accepted with the stream or the sampling off, `STREAM` at `0`, and ends FAULT with `EINVAL` otherwise. On a camera the `MODE` row's RUN configures the sensor for that mode with the trigger in effect and reads BUSY throughout. In the same run it applies the exposure and gain rows' defaults at the frame length the configure stored. It then repaints `CURRENT_MODE`, every `LIVE` cell and every range. A sampling personality's RUN re-runs its probe and configure at the new values.
- **GATE**: the `STREAM` row. `1` starts the sensor or the sampling, `0` parks it. On a camera the configure starts the sensor, so `STREAM` reads `1` after a RUN. A driver that holds the sensor in standby until its stream start commits `0` next.
- **TRIGGER**: the `TRIGGER` row converts the trigger on the running sensor.

A commit ends FAULT with `ERROR` 22, `EINVAL`, when its mask breaks a rule. The rules are one owner and one kind per mask, rows the door serves, no read-only row, and enum values from the row's list. A RUN needs the stream off. A row the device cannot apply ends the same way. That is an id past its registry, a kind other than the id's, or a row its law cannot convert. So does a device row's value the device refuses: a node-ID of `126` to `254`, or a CAN rate pair off the profiles (§6.7).

A range value outside `MIN`..`MAX` clamps. A commit that ends READY with a row applied increments `APPLY_COUNT` and repaints `LIVE`. A commit that ends FAULT sets `ERROR`, increments `FAULT_COUNT` and leaves `LIVE` alone. A row the commit did not name keeps its value. A driver commits at most once per frame.

**The windows.** The host reads `STATE` first, since a `COMMIT` written while BUSY or INERT is ignored. It holds the host bus from that read, through its `COMMIT`, until `STATE` leaves BUSY. No other transfer of the host then starts against the device's own. A commit already in flight is waited out with the bus released.

After the commit the host keeps the bus and sends nothing for the time the device painted for the kind. That is `APPLY_RUN_MS` after an APPLY, and `MODE_RUN_MS`, `GATE_RUN_MS` or `TRIGGER_RUN_MS` after the others. No read of its own then lands on the device's transactions.

After an APPLY the host then reads `STATE` every `APPLY_POLL_MS`, 1 ms, for `APPLY_POLL_MAX_MS`, 20 ms, past the painted time. After the others it reads every `MODE_POLL_MS`, 10 ms, for `MODE_SWITCH_TIMEOUT_MS`, 6000 ms. A NAK inside the window reads as busy. Past the window the host reports the device busy and releases the bus.

A `STATE` read that lands inside the device's own transaction can be torn. The host takes a value outside the four as busy, and a terminal state only from two agreeing reads. The host's I²C controller runs in multi-master mode. A transaction that loses arbitration ends in an error the host repeats. The host never clears the bus: the clocks of a bus clear reach every device behind the serializer.

Outside a window the device NAKs a transaction that lands inside one of its own transfers. A host repeats such a transaction after `BUSY_RETRY_MS`, 1 ms, at most `BUSY_RETRIES` times, 8, and reports the device busy past that.

**Ranges.** `MIN`, `MAX` and `STEP` hold the range of each range row in the mode and line time in effect. The exposure's `MAX` is the frame in effect less the sensor's margin, under the register's longest frame. An APPLY that moves the frame period therefore repaints it. The device paints the ranges when the personality loads and again after every commit. A minimum rounds up and a maximum rounds down, so every value inside the range is one the sensor takes. `LIVE` reads inside the range, so a value in effect at a bound reads that bound.

While INERT the ranges describe the default row at its shortest frame. The rate's `MIN` is the rate of the register's longest frame, and its `MAX` the rate of the mode's shortest. A host re-reads the ranges after a RUN commit, and the exposure's after an APPLY commit that staged the rate. An enum row's `MIN` reads 0, its `MAX` the count minus one, and its values stand in the row.

**Injected rows.** Some rows are injected by the compiler from a personality's hardware declarations rather than an explicit declaration. `stream` is the GATE row of every personality that streams or samples. `bus` selects the active communication profile among the buses a sampling personality supports (I²C `0`, SPI `1`, §10.2), a RUN row. `i2c_addr` overrides the strap scan, and `reset_active` sets the mikroBUS reset polarity. Their `PRESENTATION` entries name the values: `off` and `on` for `stream`, `i2c` and `spi` for `bus`, `low` and `high` for `reset_active`.

The PWM helper injects two APPLY range rows, `pwm_freq` ∈ `[500, 25000]` Hz and `pwm_duty` ∈ `[0, 100]` %. A host retunes them at run time to drive the mikroBUS PWM pin.

The device's own rows carry the owner `7`. There are 13 of them, APPLY rows all, and `STORE_PERSIST` keeps them:

| Row | Id (§4.5) | Values |
|---|---|---|
| `fifo_depth` | 15 | `0` to `255` records (§6.3) |
| `decimation` | 16 | `0` to `65535`, the device-wide gate (§6.3) |
| `decim.accel`, `decim.gyro`, `decim.mag`, `decim.temp`, `decim.press`, `decim.gnss`, `decim.scalar` | 16 | `0` to `65535`, one SI subject's factor (§8.2.7) |
| `can_term` | 17 | `0` off, `1` on (§8.2.7) |
| `can_node_id` | 19 | a range of `0` to `255`, of which the device takes `0` to `125` and `255` (§6.7) |
| `can_bitrate` | 20 | `125000`, `250000`, `500000` or `1000000` `bps`, a wide enum (§6.7) |
| `can_data_rate` | 21 | `125000`, `250000`, `500000`, `1000000`, `2000000` or `4000000` `bps`, a wide enum (§6.7) |

A `decim.<subject>` row names the subject short, since a row's name holds 15 characters, and the Cyphal register keeps the subject's full name.

### 6.5 Personality store

The store persists up to 8 personality images in flash. `SAVE` keeps the *running* image, the most recent load, in the slot `CMD_ARG` names. The result is reported in `CMD_ERROR` (§12): 0 on success, else a positive errno. The errno names no personality running, a duplicate already stored, or a full store. `ENOTSUP` names an image the store does not take: one of another format version (§10.1), or a hub or graph image. A unit's store takes no module image either.

A store command (`SAVE`, `DELETE_SLOT`, `CLEAR_STORE`, `ACTIVATE_SLOT`) issued while a session is open, an upload or a firmware push, is refused with `EBUSY`. Persisting a half-streamed stage would surface as a corrupt slot at some later boot. A store landing mid-firmware-push would overwrite the push's latched error detail. A stale session's partial stage is discarded rather than saved.

The store keeps its slots packed. `SAVE` to a populated slot overwrites it in place, and `SAVE` to any other slot appends after the last populated one. `DELETE_SLOT` moves every later image down one slot. A host that replaces an image saves over its slot. A delete first would move the next image onto the slot it then saves to.

`STORE_DIRECTORY` (`0x1F00`) serves one entry of 16 bytes per slot. It holds the slot's state (`0` empty, `1` populated, `2` active), the image's kind (§10.1) and its size as u16. Then come its format major and minor, its parameter and output row counts, and the first 8 bytes of its name. `PERSONALITY_INFO` (`0x8000`) serves each slot's descriptor trailer (§10.1) in a 4096-byte region, slot k at `0x8000 + 4096 k`, zeros past its end. The trailer's count byte and record lengths say where it ends, and the bytecode is never served. A slot that holds no image serves zeros in both.

On boot the device runs the first populated sampling slot on the main VM and the first camera slot on the camera run. `STORE_COUNT`, `ACTIVE_SLOT` and `ACTIVATE_SLOT` (§5) manage the main VM's rotation. PROBE_FAILED auto-advance (§6.2) makes a multi-sensor store self-selecting: the device settles on the first personality whose sensor answers.

### 6.6 Output descriptors

Each loaded sampling personality declares how its sample bytes decode, one output row per field at `OUTPUT_ROWS` (`0x1800`). The rows are the `OUTPUTS` record's (§10.1), with the scale in effect in their `SCALE` field. Fields are packed in declaration order, and their widths sum to `SAMPLE_SIZE`. A numeric field's width follows its type, and a string field's width is its count. With no personality loaded the set is empty: `OUTPUT_COUNT` and `DESCRIPTOR_EPOCH` read 0, and `SAMPLE_SIZE` serves 0 until the next load (§6.3).

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `NAME` | 16 | ASCII, NUL-padded: the field's name |
| 16 | `UNIT` | 6 | ASCII, NUL-padded: the unit after scale and offset |
| 22 | `SEMANTIC` | 2 | The semantic category code below, `0` generic |
| 24 | `TYPE` | 1 | The field type code below |
| 25 | `FLAGS` | 1 | Bit 0: big-endian on the wire. Bit 1: a string payload |
| 26 | `COUNT` | 2 | Elements of the field, or the width of a string payload in bytes |
| 28 | `AT` | 2 | The field's byte position in the sample record's data. Positions may gap, since binary-record personalities map fields onto scattered offsets |
| 32 | `SCALE` | 8 | f64: the factor from the wire value to the unit |
| 40 | `OFFSET` | 8 | f64: the offset after the scale |

Physical value = raw × scale + offset, in the unit's unit. The scale the row serves is the *effective* scale. It is the personality's base factor already multiplied by any linked row's live value, for example an IMU's full-scale range. So `raw × scale` decodes to correct SI at the current range with no re-read of the personality image. The same effective scale backs the Cyphal `GetOutputInfo` service and the `si.sample.*` projection (§8.2.8).

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
| 8 | string | `COUNT` |

Semantic category codes (0 when no category applies, and codes are append-only):

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

GNSS epoch semantic codes, with no standard-subject projection. They identify a receiver's time solution for epoch-aware consumers, and the ROS 2 bridge's receiver-epoch stamp mode keys on the pair:

| Code | Semantic | Code | Semantic |
|---|---|---|---|
| 34 | time_of_week | 35 | fix_type |

Descriptor reads race the device's autonomous personality changes (§6.2), so a host validates a descriptor set with `DESCRIPTOR_EPOCH`:

1. Read `DESCRIPTOR_EPOCH` (e₀). 0 means no descriptors are readable, since the device holds no personality.
2. Read `OUTPUT_COUNT` and the rows at `OUTPUT_ROWS`, and `PARAM_COUNT` and the rows at `ROWS`.
3. Read `DESCRIPTOR_EPOCH` again (e₁). If e₁ = e₀ the set is coherent. Cache it keyed by e₀. Otherwise restart from step 1.

A cached set remains valid exactly while `DESCRIPTOR_EPOCH` still reads e₀. Re-check it before trusting a cached sample layout. The epoch advances on every personality (re)load. A re-upload under the same personality name may carry different fields, so equality of the personality name guarantees nothing.

### 6.7 Commissioning (identity)

The node-ID and the CAN bit-timing profile are three device rows (§6.4): `can_node_id`, `can_bitrate` and `can_data_rate`. `can_node_id` is a range row of `0` to `255`. The device takes `0` to `125` for a static address and `255` for a deliberately anonymous node. A commit of another value ends `FAULT` with `EINVAL`. 126 and 127 are reserved for diagnostic and host tooling.

`can_bitrate` and `can_data_rate` are wide enum rows in bit/s: the arbitration rate and the data-phase rate of the profiles the device realizes. A profile is a pair, so the two rows are judged together at the commit. A commit that names one row pairs it with the other in effect. A pair off the profiles ends `FAULT` with `EINVAL`. Equal rates select Classic CAN, a higher data rate CAN FD.

| Step | Cell / command | Effect |
|---|---|---|
| 1 | read the rows' `LIVE` cells | the identity the next boot runs, the compiled defaults on a factory-fresh device |
| 2 | commit `can_node_id`, or `can_bitrate` and `can_data_rate` in one transaction (§6.4) | stage the identity. `STATE` ends `READY`, or `FAULT` with `EINVAL` for a value the device does not take |
| 3 | write `CMD = STORE_PERSIST` | keep it. Poll `CMD_ERROR` out of pending: `0` = OK |
| 4 | write `CMD = REBOOT` | the new node-ID and CAN profile take effect on boot |

Identity is fixed when the Cyphal node is constructed, so steps 2 and 3 persist it and step 4 applies it. The same `STORE_PERSIST` snapshots the device's other rows and the calibration record in effect. Those rows are the FIFO depth, the termination, the `decimation` gate and the per-subject factors. A Save on this transport commits what a Cyphal Save does. The subject-IDs are Cyphal registers alone, `uavcan.pub.<subject>.id`, persisted by the Cyphal Save (§8).

A factory-fresh device needs none of this: it is plug-and-play at the compiled defaults.

### 6.8 Time synchronization

All device timestamps are one monotonic µs clock counting from device boot. They are `timestamp_us` in the sample record (§6.3), in `RawSample` (§8.2), and in the SI subjects (§8.2.8). The device additionally serves that clock's *current* value on every wire. A host can therefore measure the device→host clock offset with a bounded error and translate acquisition timestamps into its own time domain:

- **I²C**: `latch_time_us` in the sample record is stamped when the read transaction latches the record. The host's clock readings immediately before and after that transaction bracket it, so every sample poll doubles as one sync observation.
- **Cyphal (serial and CAN)**: the read-only `aliensense.nxs.time_us` register, natural64 (§8.2.7), returns the clock at request service time. The host brackets the `register.Access` round trip.

The estimation recipe is the standard two-way method (RFC 5905). For each exchange with host clock readings `t0`/`t1` around a device reading `d`, the host−device offset candidate is `(t0 + t1)/2 − d` with error bounded by `(t1 − t0)/2`. Keep the minimum-round-trip exchange over a sliding window (~30 s) and fit drift across the window, since the device clock is oscillator-driven, tens of ppm.

Repeating an exchange at ~1 Hz holds the projection error near the per-wire floor. That floor is ~100 µs on I²C (the host masters a ~200 µs transaction), a few hundred µs on CAN-FD, and 1–2 ms on serial. On serial the exchange shares a half-duplex link with the sample stream. `nxs ros2 --stamp synced` implements exactly this. The surfaces are standard reads, so any host can.

The host can additionally push its estimate down, giving the device a synced timescale, mesh time, beside its untouched local clock. The push is volatile and expires. Each record carries its own validity window, the discipline decays that long after the push applies, and every consumer falls back to local behavior. The window is the pusher's receipt timeout expressed as a duration. The `nxs` tools push ten times their refresh cadence, so ten consecutive lost pushes end the discipline. A zero window is malformed and the device rejects the record.

- **I²C**: write the 32-byte record to `TIME_SYNC` at `0x1CC0` in one transaction. Its first 20 bytes are the push, in this order.
  - offset, i64 LE, µs
  - bound, u32 LE, µs
  - rate, i32 LE, parts per billion
  - validity window, u32 LE, µs

  The device applies the push at the transaction's stop, ignores the bytes past it, and re-arms the window for the next push. A read serves the live state in the same 32 bytes. That is the push fields, a source byte at 20 (0 none or stale, 1 host), a validity byte at 21, then reserved bytes.
- **Cyphal**: write `aliensense.nxs.time_sync` in one `register.Access`, as `integer64[4]` (offset µs, bound µs, rate ppb, validity window µs). A read serves `integer64[5]`, which is offset, bound, rate, validity window, source.

While a discipline is fresh, the SI subjects' `SynchronizedTimestamp` fields carry mesh time (the local clock mapped through the pushed offset and rate). Undisciplined, they carry the local clock. `RawSample.timestamp_us` and the sample record stay the local clock always. The rate term extrapolates the estimator's fitted clock skew between pushes. The mesh error therefore does not grow at the oscillator differential over the push interval.

While a discipline stays valid, mesh time is continuous and monotonic across pushes. A correction of 1 ms or less is absorbed by slewing at 500 ppm, never by stepping. The first discipline, a re-acquire after staleness, and a correction beyond 1 ms apply as a step. The status LED renders its pattern from the synced second while disciplined, so synced units blink in phase. `nxs switch` seeds the discipline at converge.

A resident pusher keeps it fresh. That is `nxsd` where it runs, the bare `nxs timesync` on a bench, an addressed `nxs --unit <name> timesync`, or the ROS 2 bridge.

### 6.9 Calibration

The device stores one per-unit calibration record. It holds an affine correction `v_out = M·v + b` (M 3×3 row-major, b 3×1) per vector bucket, the buckets being acceleration, angular velocity, magnetic field. It also holds a scalar encoder zero-offset added to the `angle` output, the sum wrapped into [0, 2π). The correction applies in the SI tier only. The `uavcan.si.sample.*` subjects (§8.2.8) carry calibrated values, while the `RawSample` stream and the I²C sample record (§6.3) carry raw counts. A host that applies the served record to its own raw decode reproduces the SI subjects exactly.

The mount rotation composes on top of each bucket's affine (effective affine = R·M, R·b). It is the running sampling personality's `orientation` row (`MOUNT_ORIENTATION`, §4.5), one of the 24 axis-aligned proper rotations. A commit of the row applies it live. A personality without the row composes no rotation. The record carries none: its byte 1 is reserved.

The rotation code names the board's physical mounting rotation relative to the vehicle frame. The device applies that same rotation to measured vectors, so a board mounted with the named rotation reports vehicle-frame values. Verification anchor: a level board with `ROLL_90` set reads gravity on −Y, and the physically rolled board (+Y up) reads +Z.

Each solved bucket carries a personality tag: the FNV-1a 32-bit hash of the personality it was solved against. The hash is taken over the personality name, the bus kind, and the latched device address, and 0 = unguarded. Two identical Clicks on one panel therefore hash to different tags, so a swap between them is refused rather than silently accepted. A tagged bucket whose tag mismatches the running personality contributes only the mount rotation, never the stale affine. The encoder zero carries its own tag.

**Record layout.** 256 bytes, packed little-endian, in four 64-byte blocks. Block 0 is the header, and block 1 + v is vector bucket v, the buckets in order acceleration, angular velocity, magnetic field. Reserved bytes read 0, and a write leaves them 0.

| Block | Offset | Field | Type | Content |
|---|---|---|---|---|
| 0 | 0 | `version` | u8 | record-layout version, 2. The firmware also reads a version-1 record, written by v1.0.0 and v1.1.0, and keeps its calibration while ignoring its byte 1. A stored record of another version is discarded at boot in favour of identity defaults |
| 0 | 1 | `reserved` | u8[3] | 0 |
| 0 | 4 | `encoder_zero` | f32 | radians added to the `angle` output, the sum wrapped into [0, 2π) |
| 0 | 8 | `encoder_tag` | u32 | encoder-zero personality guard, 0 = unguarded |
| 0 | 12 | `reserved` | u8[52] | 0 |
| 1 + v | 0 | `m` | f32[9] | the bucket's M, row-major |
| 1 + v | 36 | `b` | f32[3] | the bucket's b |
| 1 + v | 48 | `driver_tag` | u32 | the bucket's personality guard, 0 = unguarded |
| 1 + v | 52 | `reserved` | u8[12] | 0 |

**Record write.** The record is the `CALIBRATION` region at `0x1D00`:

| Step | Cell / command | Effect |
|---|---|---|
| 1 | write `CALIBRATION` (256 B, in writes of any length) | patch the staged copy at the written offsets. The stage seeds from the running record at boot and after every apply, so a write of one block changes that block alone |
| 2 | write `CMD = CALIB_APPLY` | validate + apply to the running state. Poll `CMD_ERROR` out of pending: `0` = applied, `EBUSY` = a session or a procedure holds the device, `EINVAL` = malformed record |
| 3 | write `CMD = CALIB_PERSIST` | persist the running record to NVS. Poll `CMD_ERROR`: `0` = committed, `ENODEV` with no calibration bank. This save leaves the device rows alone, so it is a distinct command from `STORE_PERSIST` (§5) |

Step 2 changes the running state immediately, with no reboot. Step 3 is the unified Save of the running/startup model (§8.2.7). An applied record that is not persisted reverts at power-cycle.

Over Cyphal the same two phases are the calibration registers and `aliensense.nxs.calibration.commit` (§8.2.7). Field writes stage, the commit applies the staged record whole, and Save persists it. Staging is what keeps the SI subjects from publishing under a partly-updated record. A host changing several buckets would otherwise emit one bucket's new coefficients beside another's old ones for the remaining round trips. `aliensense.nxs.calibration.dirty` reads `1` while staged and running differ. Writing `0` to `calibration.commit` discards the staged edit and re-seeds the stage from the running record, the reset for an abandoned or failed edit.

A commit refused `ECANCELED` (an on-device solve landed mid-edit) also discards the stage, so the host re-reads and re-stages on a fresh copy. A validation refusal keeps the stage for a single-field correction.

**Record read-back.** A read of the region serves the running record. `CALIBRATION_EPOCH` (`0x0024`) is the record's change counter, the same value the `aliensense.nxs.calibration.epoch` register serves over Cyphal. A host brackets its read on it: read the counter, the record, the counter again, and retry when it moved. That is the `DESCRIPTOR_EPOCH` idiom (§6.6), identical on both transports.

**On-device procedures.** Two solves run on the device itself, so a Cyphal autopilot or any I²C master drives them with no host tool. A procedure is a session: `SESSION` reads `3` while one runs, and the device refuses the overlap. A procedure start while an update or upload session is live answers `EBUSY`, on either transport. So does starting an update while a host-commanded procedure runs. The boot-automatic gyro pass, which arms on the runner's first `MEASURING`, is the exception. It is the device's own housekeeping, so any host claim stops it and takes the session, keeping the previous boot's bias.

A host claim is a personality upload, a store command, `DFU_BEGIN` or `BEGIN_SOFTWARE_UPDATE`. A calibration start that joins that pass makes it the host's, and it then refuses like any other host-commanded procedure. `PROC_STATE` carries the state (0 idle, 1 gyro-wait-still, 2 gyro-averaging, 3 mag-collect). `PROC_DETAIL` carries the detail: the gyro percent averaged, or the mag rotation coverage of 14. Of that coverage 12 is the stopping point at which a host asks the solve, and the answer can still be `EAGAIN`. `CMD_ERROR` carries the completion verdict.

A procedure has finished when `PROC_STATE` returns to idle. Read the verdict in the same poll that observes the idle state. `CMD_ERROR` is shared with every command, and the next command replaces it.

- **Gyro still-average** (`CAL_GYRO`): the device waits for stillness (a per-axis peak-to-peak gate), averages 400 samples, and writes `b = −mean` into the running record. The command result is acceptance only. The completion verdict lands in `CMD_ERROR` on the idle edge: it reads 0 while the average runs, then the errno when `PROC_STATE` returns to idle. A commanded run times out after 60 s. The same procedure also runs once automatically at boot, on the runner's first `MEASURING`. It completes on a still boot and gives up with `ETIMEDOUT` after ~15 s of motion, leaving the stored bias untouched.
- **Mag in-situ ellipsoid** (`CAL_MAG_START` / `CAL_MAG_STOP`): `CAL_MAG_START` begins collection. The vehicle is rotated through all attitudes while the device accumulates float64 normal-equation sums, and no sample cloud is stored. `CAL_MAG_STOP` coverage-gates, solves, self-checks, and applies. Its `CMD_ERROR` is the fit verdict: 0 = applied, `EAGAIN` = insufficient coverage, `ERANGE` = degenerate, non-ellipsoid fit. `EBADMSG` = failed the sphere self-check, where the calibrated |B|² spread over the accumulated cloud exceeds the gate. Every failure keeps the previous calibration.

  `EAGAIN` alone leaves the collection open and restarts its give-up window. A host that reaches the progress byte's stopping point and is told "not yet" keeps rotating and stops again rather than starting over. A stop after the window finally expires answers `EINVAL`, no collection open. Coverage is only decided once the fit has divided the mount's own distortion out, so the progress byte is an estimate. `Cmd::SESSION_ABORT` drops a procedure without solving, for a host that wants to cancel rather than commit. Over Cyphal the same release is `CAL_ABORT` (0xA00D).

  The solve preserves the RMS field radius, and the procedure runs mounted in the vehicle. The iron the fit removes belongs to the installation, not the unit.

Accelerometer calibration is a host-side procedure: a gravity-magnitude fit (per-axis scale and offset) over six poses, checked against two held-out poses. The `nxs` tool solves it and uploads it through the ordinary record write, Integration Manual §4.9. There is no dedicated reset command. The reset writes the identity affine, M = I and b = 0, into the buckets it resets and persists the record. `nxs calibrate reset` performs exactly that.

### 6.10 Build identity

The firmware's exact build is served as its `git describe` string, `vMAJOR.MINOR.PATCH-N-gSHA`, in `BUILD_INFO` (`0x1C10`). `N` counts commits above the release tag, `0` at the tag itself, and `SHA` is the short commit hash. `-dirty` is appended when the image was built from an uncommitted tree. The record is 64 bytes, NUL-padded, read-only, one read.

The string is the same value the Cyphal `aliensense.nxs.fw.describe` register serves, and the SDK's `read_fw_version()` returns it verbatim on every transport. `FW_VERSION_MAJOR`, `FW_VERSION_MINOR` and `FW_VERSION_PATCH` (§4.1) serve the numeric triple.

### 6.11 Cam personality

A cam personality is an NXS image of kind CAMERA (§10.1). It holds the sensor's probe, configure, apply, park, start and trigger programs as VM bytecode. It holds its parameter rows, its mode table and the law that converts a row's public value into the sensor's units. It is uploaded and saved like any personality (§6.1, §6.5) and occupies a store slot. A pod's unit runs it on a second VM instance bound to the pod-side bus. The main VM meanwhile serves the sampling personality in its own slot, and a smart camera runs its own logic instead (§6.12).

A camera slot is activated like any other, by `LOAD` or `ACTIVATE_SLOT` (§5), and the device runs it on the camera run. From then on its rows are served at both doors, with their owner the slot. The camera door serves them alone, re-indexed from 0, so that a kernel driver bound there sees nothing but the camera. The unit door serves them beside the sampling personality's rows and the device's own.

The camera is driven entirely by commits (§6.4). A RUN commit of the `MODE` row configures the sensor and starts it. A GATE commit of `STREAM` parks or starts it. An APPLY commit sets exposure, rate, gain and the other APPLY rows within the frame. A TRIGGER commit converts the trigger.

The owner of the hub's bus, the daemon or a module running the graph image, brings a pod up through the unit door. It first commits the rows the graph derives, the line time of a synced pair for one. Those rows carry bit 2 of `FLAGS`, and a kernel driver offers them read-only. Then it commits the mode. The kernel driver of the host that receives the stream drives the camera door at frame rate.

The pod's law, the `CAMERA_MAP` record, is private. It converts a standard row's public value, in the row's unit, into the VM's run values in the sensor's units, and back for `LIVE`. A row the law cannot convert ends a commit FAULT with `EINVAL`. A sampling personality's row is the VM's own parameter and needs no law.

A pod stays INERT until a RUN commit configures its sensor: `LIVE` reads `0`, `CURRENT_MODE` reads `0xFF` and `COMMIT` is ignored. The rows and the mode table are served as soon as the camera slot is active, from its `PARAMS` and `CAMERA_MAP` records. After the first run the values in effect follow the sensor, and a driver that polls `STATE` sees READY. A pod whose camera personality is replaced, or whose first configure ends other than DONE, is INERT at the camera door. The unit door reads FAULT with the errno in `ERROR`, and the next RUN commit through it retries. Once a configure ended DONE, a run that ends other than DONE reads FAULT at both doors with the errno, and the next commit retries.

While a commit runs, the device masters the pod bus and the host holds off as §6.4 says. The device re-asserts a terminal `STATE` while it idles, so a host that polls late still reads it. A commit that a bus error cuts fails after the device's own retries and ends FAULT with `EIO`. The retries are 5 of them 50 ms apart for a run, and 2 of them 1 ms apart for an apply. A hard poll of a sensor register that times out ends `ETIMEDOUT`, and a soft one records the miss and continues. A personality whose declared I²C clock ceiling is below the pod bus's rate is refused with `ENOTSUP` before the run touches the sensor.

### 6.12 A smart camera

A smart camera serves the capture cells alone: no unit regions, no personality upload, no sessions, no time discipline and no firmware update. It powers up READY in its default row with `STREAM` at `0`, its rows in its memory and their ranges painted. An installed cam personality of the `native` law family describes its rows and mode table, and the host never uploads it. The tool names it by that personality, reads its rows and sets a parameter by name as a driver does, under the host's bus lock. With no unit door answering, `nxs -t i2c -b <bus> map check` proves the map at `0x31` against that personality's records (§9).

`MAP_ID` reads `0xC4` and `MODULE_KIND` `3` on a smart camera, `FW_VERSION_MAJOR` and `FW_VERSION_MINOR` read `0`, and `APPLY_RUN_MS` carries its own apply time. One whose sensor fails at power-up reads FAULT with the errno in `ERROR`. It then takes a RUN commit of its default row.

### 6.13 A smart module

A smart module, a compute module on a hub's second output, is a unit. It serves the whole map at its unit door with `MODULE_KIND` `4`. It runs a personality of kind MODULE (§10.1), whose rows are its knobs and whose output rows describe its records. It streams those records through the sample path (§6.3).

It reaches a host over the hub's bus like a pod, or over Cyphal/serial on its USB or UART port. As the owner of a hub's bus it runs the graph image and drives the pods through their unit doors. The host that receives the hub's first output is then passive.

---

## 7. Firmware update

### 7.1 Model

The device keeps two firmware slots (A/B). An update stages the new image into the update slot. `DFU_FINISH` checks that the staged bytes form a complete MCUboot image, marks the swap pending, and reboots. The new image boots in a probationary TEST state and self-confirms after 1 s of healthy main-loop execution with the host link initialised. That is the default build, and the window is a build option (§7.2). An image that faults, hangs (3 s hardware watchdog), or otherwise fails to confirm is automatically reverted on the next reset.

The previous firmware then returns without host intervention. The application arms the watchdog at 3 s. The bootloader re-arms it on a 30 s window and feeds it during the swap and in recovery. A hang anywhere in the update therefore resets the device instead of leaving it stuck. A power loss mid-swap resumes or reverts cleanly, and no sequence in this section can brick the device.

```d2 title="The firmware update over I²C, from the claim to the confirmed image"
# The firmware update over I²C (Interface Description §7.1, §7.3): the staged
# image, the acknowledged chunks placed by their offsets, the reboot into the
# swap and the confirm.

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

check: "1. Check for a live session" {
  host <- unit: "read SESSION: 0 (else SESSION_ABORT, or try later)"
}

begin: "2. Open the session" {
  host -> unit: "write CMD = DFU_BEGIN"
  unit -> unit: "erase the staging slot (about 2.5 s, bus held off)"
  host <- unit: "CMD_ERROR: 0, DFU_PHASE: READY, SESSION: 2 (or EBUSY)"
}

chunks: "3. Push the image, chunk k: a u32 offset and up to 128 bytes" {
  host -> unit: "write DFU_CHUNK (chunk k)"
  host <- unit: "DFU_ACK: (k + 1) mod 256 (still k: resend the same bytes)"
}

finish: "4. Finish" {
  host -> unit: "write CMD = DFU_FINISH"
  unit -> unit: "check the staged MCUboot image, arm the swap"
  host <- unit: "DFU_PHASE: FINISHING, then the reset drops the bus (ERROR: errno in CMD_ERROR, then SESSION_ABORT)"
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

- **Firmware** (`BEGIN_SOFTWARE_UPDATE`): end-of-file checks that the staged bytes are a complete MCUboot image and arms the MCUboot swap, so the staged image becomes swap-pending. The device then reboots into §7.1's probationary TEST flow. The reboot arrives seconds after the ExecuteCommand reply has drained, so it is not observable as a failed command. A file that is not an MCUboot image, a raw `zephyr.bin`, resolves `aliensense.nxs.cmd_error` to `ENOEXEC` (8). One that ends before the length its header declares resolves to `ENODATA` (61). Neither reboots.
- **Personality** (`LOAD_FROM_FILE`): end-of-file loads the assembled NXS personality. The personality structure is activated but **not** started, and the device does not reboot. Starting it is a separate `RUN` (`0xA001`) command (§6), mirroring the upload-then-run split of the I²C personality path.

#### One pull at a time

The device holds the state of a single transfer. A second provisioning trigger, firmware or personality, received while a pull is active is rejected with `STATUS_FAILURE` (1) and leaves the in-flight pull untouched. The host waits for the active pull to finish (Heartbeat mode returns to `OPERATIONAL`) before starting another.

#### No image-size ceiling

The pull places no upper bound on image length. The service transfer-ID that tags each Read is 5 bits on Cyphal/CAN (wraps every 32 transfers, ~8 KiB). It is an 8-bit counter on Cyphal/serial (wraps every 256 transfers, ~64 KiB). The device matches each response against the in-flight request modulo that field, so a pull continues correctly across every wrap.

The only size limit is the capacity of the update slot (221,184 bytes, §11) or the personality staging buffer. The pull opens the sink with the total size unknown, so an oversize image is not declined at `begin`. It fails at the first write past the capacity, aborting the pull.

#### Confirming the image

After the swap the new image runs in MCUboot's TEST state. Unless something confirms it before the next reset, MCUboot swaps the previous image back. The image confirms itself once its main loop has run for the self-confirm window with its host link initialised. The window is a build option, 1 s on the default build. A supervised build sets a long window, and the host confirms explicitly with `CONFIRM_FW` once it has validated the image end to end. The command is I²C `Cmd` 9, Cyphal ExecuteCommand `0xA00E`, or `nxs confirm-fw`.

The window is the safety net for a supervisor that never does, and a window of `0` removes it, leaving `CONFIRM_FW` as the only confirmation. `CONFIRM_FW` is idempotent and harmless on the default build. Over I²C it is refused `EBUSY` while an update session or an on-device procedure holds the device (§5).

### 7.3 Update over I²C

1. Read `SESSION`. A value other than `0` names a live session. Release it deliberately with `CMD = SESSION_ABORT` or try later.
2. Write `CMD = DFU_BEGIN` and poll `CMD_ERROR` out of pending, straight through the erase. An accepted begin bulk-erases the staging slot first, stalling the device ~2.5 s with the bus held off. Transactions stretch or fail meanwhile, so keep polling. The verdict lands after the erase: `0` with `DFU_PHASE` already READY and `SESSION` at `2`. `EBUSY` means a session is live. A second `DFU_BEGIN` never restarts a running push, so release deliberately with `SESSION_ABORT`.
3. `DFU_PHASE` reads ERROR instead: the erase failed. Read `CMD_ERROR`, abort.
4. For each chunk k = 0, 1, 2 …: write the chunk's u32 offset and up to 128 image bytes to `DFU_CHUNK`. Poll `DFU_ACK` until it reads (k+1) mod 256. Exactly one chunk may be in flight, and the counter is the acknowledgement. If the counter stalls past a timeout, re-read it. Still k means the device dropped the chunk, so resend the same bytes, and k+1 means it landed.

   The device takes a chunk at its cursor, and a resend of the last chunk lands as a no-op, so a lost acknowledgement costs nothing. A chunk ahead of the cursor is refused `EINVAL`, since the staging flash is written in order. A chunk that would run past the update slot's capacity (221,184 bytes, §11) is refused `ENOSPC`. A chunk with no session open is refused `ENOENT` and not acked.
5. `DFU_PHASE` = ERROR at any point: the failed chunk did not commit. `CMD_ERROR` holds the reason, and the session stays latched so the detail survives until a read takes it. Release with `SESSION_ABORT`. Restart with `DFU_BEGIN`.
6. Write `CMD = DFU_FINISH`. The device checks that the staged bytes are a complete MCUboot image. It checks the header magic, the TLV trailer, and the declared length within the staged bytes. Success shows in the reboot, not in the write's ACK. The device publishes `DFU_PHASE = FINISHING`, after which the reset drops the bus. A NACK on the tail of this transaction is that reset, not an error.

   A finish dropped before dispatch at a full command queue instead leaves the bus alive with `DFU_PHASE` unchanged. Resend it. `DFU_PHASE = ERROR` is a failed finish, latched without a reboot. Read `CMD_ERROR`, then release the session with `SESSION_ABORT`. `ENOENT` means no session open. `ENOEXEC` means the staged bytes are not an MCUboot image, so push `zephyr.signed.bin`.

   `ENODATA` means fewer than a full header was staged, or the image ends before the length its header declares. The flush already closed the staging session on the device, and sampling resumed. Recovery is therefore always `SESSION_ABORT` then a fresh `DFU_BEGIN`, never a resend onto the same session.
7. To abort a session, write `CMD = SESSION_ABORT` (§5). The device resumes sensor sampling and the progress cells reset to IDLE/0. An abandoned session (host crash) releases itself after 5 s of silence.

A unit of interface version `1` (§2) takes the same image through its own 8-bit map, and `nxs switch` performs that push. It reads `PROTO_VERSION` through the 1-byte pointer and streams the image through the first interface's session. After the reboot it confirms the new image through this map. The daemon never drives such a unit and names `nxs switch` instead.


### 7.4 Recovery

A device whose application firmware is damaged beyond the revert path recovers through MCUboot serial recovery (mcumgr / SMP over UART). A device in recovery **holds there** until an upload completes, so no host has to catch a boot-time window: run `mcumgr` / `smpmgr image upload`, then `smpmgr os reset`. The status LED shows two dark winks per second throughout, or one 300 ms pulse per second when no valid firmware image is present ([Device Reference §2.3](../nxs-device-reference/)).

Recovery runs the host UART at **115200 8N1**, not the 460800 the application uses (§8.1). That is the default rate of every mcumgr client, so the upload command needs no baud option. A client pinned to 460800 sees no response at all, because the bootloader is not listening at that rate.

The bootloader answers the SMP commands recovery needs: image list, image upload, console echo control, and reset. It returns `MGMT_ERR_ENOTSUP` (8) for anything else, including `os echo` and `slot info`, so check the link with `image list`. The optional `MCUMGR_PARAMETERS` query is among the unsupported commands, so a client that issues it at connect time logs one warning and proceeds. The values it would have returned are a 128-byte line length and 8 line buffers, giving a 1024-byte maximum frame. A client that defaults to fewer buffers uploads correctly but slower. Passing the buffer count explicitly (`--line-buffers 8` on `smpmgr`) restores the intended frame size.

A recovery upload writes the application slot directly and no swap follows. An image still staged in the update slot by an interrupted update takes precedence. The bootloader applies that swap at the next boot before it consults the recovery flag, so the staged image swaps over the uploaded one. It reverts again only if it fails to confirm. No UART procedure recovers from the states that need SWD. They are a corrupted bootloader region, a flash ECC double error inside a slot header or trailer, and RDP level 2.

Three entrances reach that state, covering successively worse failures.

| Entrance | Applies when |
|---|---|
| `ENTER_RECOVERY`, I²C `Cmd` 10 (§5), or the vendor ExecuteCommand `0xA008` on Cyphal | the application still answers on a host transport. `nxs recover` on either transport arms the flag and cold-resets: over I²C the reset itself is the acknowledgement (§5), over Cyphal the reply precedes it. A failed flag write keeps the device in the application: the errno in `CMD_ERROR` over I²C, `STATUS_FAILURE` over Cyphal |
| Bridging mikroBUS `RST` to `CS` in place of a Click board, then resetting | the application boots but stops answering. The bridge is read once at reset. Remove it and the unit boots normally |
| Resetting a unit whose application slot holds no valid image | the image is erased, unsigned, or corrupt. No action beyond power is needed, since the unit cannot leave recovery until an image is uploaded |

The command dispatches independently of the personality runner, so it reaches a device whose personality never loaded. Recovery is a last resort, and the validated update path is §7.2/§7.3.

### 7.5 Transport arbitration (cross-transport)

The device accepts host commands on three transports, the UART host link, I²C (§3), and Cyphal/CAN-FD, and arbitrates VM-control authority. At most one transport drives control or a staged update at any instant. Egress is not arbitrated. Liveness, status, and the sample stream emit on their transport unconditionally, independent of which transport holds the control claim.

**Claim.** The arbiter is idle at boot. The first host command on an idle arbiter claims control for its transport. A command on the transport that already holds control refreshes the claim. A command on a different transport takes over control only if the current holder has no session in flight. Otherwise it is rejected.

**Reject.** A command rejected because another transport holds an in-flight session is **dropped without a reply**. On I²C the register file still tells the truth. A rejected op that had armed `CMD_ERROR` resolves to `EBUSY`, so a polling host fails immediately and by name. A rejected plain write is lost. On the reply-carrying transports the host distinguishes the drop only as a timeout and must retry.

Every reject is counted, and the `INGRESS_REJECTS` fault counter (§12) is the wire-visible evidence. I²C register reads, the `DIAG` cells included (§12.1), bypass the arbiter claim. The losing I²C host can therefore read the `DIAG` cells while still being rejected. The Cyphal copy (`aliensense.nxs.ingress_reject_count`) refreshes at the ~100 ms status cadence. Cyphal register reads do claim the arbiter, so it becomes readable there once the session ends.

**Idle release.** A held claim auto-releases after **5 s** of holder silence. Release is evaluated on the next command from another transport. A holder that keeps issuing commands (or, for a file pull, keeps receiving responses) holds control indefinitely. The cross-transport lock is therefore time-bounded: a holder that goes silent for 5 s is preempted on the next competing command, even mid-session.

**Session.** A session is the in-flight state the device must not let a competing transport interrupt:

| Transport | A session is in flight while |
|---|---|
| I²C | a DFU staging session is open (§7.3), a chunked personality-image upload is in progress (§6.1), or a host-commanded calibration procedure is running (§6.9). The boot-time gyro pass is not a session: it yields to every host claim, so it never holds the transport |
| Cyphal (serial / CAN-FD) | a DFU session is active, a `uavcan.file` pull (firmware or personality) is active, or a host-commanded calibration procedure is running (§6.9) |

While any session is in flight on one transport, host commands on the other transports are rejected per *Reject* above. This is the cross-transport counterpart to the same-transport rule in §7.1. A long file pull keeps its claim alive through per-response progress, so it is not preempted mid-transfer. If the pull stalls, control is released within 5 s.

```d2 title="The transfer session, from free to released"
# The session that holds the device (Interface Description §5, §6.1, §6.9,
# §7.3): one holder at a time, from the first chunk to the release.

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

free: "No session\nSESSION = 0\nevery command answers" {class: state}
upload: "Upload\nSESSION = 1\nUPLOAD_SIZE announced, chunks land at\nUPLOAD_CHUNK at their cursors, in any order" {class: live}
firmware: "Firmware push\nSESSION = 2\nDFU_BEGIN erased the slot, chunks land at\nDFU_CHUNK at the cursor, DFU_PHASE and DFU_ACK\nfollow each one" {class: live}
procedure: "Procedure\nSESSION = 3\nPROC_STATE and PROC_DETAIL carry the\ngyro or mag procedure" {class: live}
held: "While a session is open\na store command reads EBUSY,\nanother transport's commands are rejected,\nthe unit door serves no sampling rows\nduring an upload" {class: state}
error: "Firmware error\nDFU_PHASE = ERROR\nthe errno in DFU_ACK" {class: error}

free -> upload: "write UPLOAD_SIZE"
free -> firmware: "CMD = DFU_BEGIN"
free -> procedure: "CMD = CAL_GYRO\nor CAL_MAG_START"
upload -> held
firmware -> held
procedure -> held
upload -> free: "CMD = LOAD,\nCMD = SESSION_ABORT,\nor SESSION_STALE_MS without a chunk"
firmware -> free: "the reboot of DFU_FINISH,\nCMD = SESSION_ABORT,\nor SESSION_STALE_MS without a chunk"
procedure -> free: "PROC_STATE back to idle,\nor CMD = SESSION_ABORT"
firmware -> error: "a chunk or DFU_FINISH fails"
error -> free: "CMD = SESSION_ABORT"
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

#### 8.2.3 data_specifier bit layout

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
| Nonzero user_data | Bytes 20–21 ≠ `0x0000`. |
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
| Output descriptors | `aliensense.nxs.GetOutputInfo` (service 256) | output-field descriptors, the same data the I²C window serves (§6.6), with the `float64` scale and offset and the field byte position (`byte_off`) |
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
| `aliensense.nxs.can_term` | read/write, persistent | `natural16`, the on-board CAN split-termination selection: `0` = off (the uncommissioned default), `1` = on, `0xFFFF` = revert to the default. Applies live (§8.2.7), and reads mirror the effective state. The Cyphal register of the device's `can_term` row (§4.5) |
| `aliensense.nxs.time_us` | read-only | `natural64`, the device µs clock at request service time, the two-way time-sync surface (§6.8) |
| `aliensense.nxs.time_sync` | read/write, volatile | `integer64`. Write `[offset µs, bound µs, rate ppb]` to discipline the synced timescale as a host source, and read `[offset, bound, rate, source]` (§6.8). Source decays to 0 when the discipline goes stale |
| `aliensense.nxs.cmd_error` | read-only | `natural16`, the result of the most recent vendor / store / provisioning ExecuteCommand: `0` = OK, otherwise the positive errno behind a `STATUS_FAILURE` reply. Examples: `EEXIST` 17 = duplicate image already stored, `ENOSPC` 28 = store full, … The Cyphal mirror of the I²C `CMD_ERROR` register (§12). The ExecuteCommand response itself carries only the stock status code. Every file pull, `BEGIN_SOFTWARE_UPDATE` and `LOAD_FROM_FILE`, marks this register `CMD_ERR_PENDING` (255) at accept and resolves it to the pull's verdict when the pull completes. The verdict is `0`, or `ENOEXEC` (8) for a file that is not an MCUboot image or a valid personality. It is `ENODATA` (61) for a truncated one, or the errno of a failed pull (§7.2). The host therefore polls this edge rather than trusting the pull's ExecuteCommand reply |
| `aliensense.nxs.io_err_count` | read-only | `natural16`, cumulative sensor-bus I/O errors since boot, including faults the device recovered and retried without sample loss. A steady rate is health telemetry worth monitoring even while the sample stream is unaffected. Saturates at 65535 |
| `aliensense.nxs.io_errno` | read-only | `natural16`, the positive errno of the latest absorbed I/O error, 0 before the first (§12.1) |
| `aliensense.nxs.probe_failed_count` | read-only | `natural16`, cumulative probe give-ups since boot, failures the device could not recover in place. Saturates at 65535 |
| `uavcan.diagnostic.severity` | read/write | `natural16`, the capture floor for the diagnostic stream on subject 8184: `0` TRACE … `7` ALERT, default `4` (WARNING). Out-of-range writes clamp to `7`. RAM-only |
| `aliensense.nxs.param.<name>` | read/write | `natural32`, one register per loaded-personality parameter. A write sets the value, and a read returns the current. `register.List` enumerates them after the static registers. The descriptor (unit, allowed set) comes from GetParamInfo. RAM-only |
| `aliensense.nxs.calibration.acceleration` / `.angular_velocity` / `.magnetic_field` | read/write, persistent | `real32[12]`, the bucket's affine: M row-major as elements 0–8, then b as 9–11. A write stages. `calibration.commit` applies the staged record and Save persists it (§6.9) |
| `aliensense.nxs.calibration.encoder_zero` | read/write, persistent | `real32[1]`, radians added to the `angle` output, the sum wrapped into [0, 2π) |
| `aliensense.nxs.calibration.commit` | read/write, volatile | `natural8[1]`. Writing a nonzero value validates the staged record and applies it to the running state in one step. Writing `0` discards the staged edit, and the stage re-seeds from the running record. The response carries the **result code**, not the written value. `Access` reads after the write regardless of its outcome, so a single round trip reports acceptance (`0`) or the errno. A commit refused `ECANCELED` discards the stage, and other refusals keep it |
| `aliensense.nxs.calibration.dirty` | read-only, volatile | `natural8[1]`, `1` while the staged record differs from the running one |
| `aliensense.nxs.calibration.driver_tags` | read/write, persistent | `natural32[4]`, the three bucket guards then the encoder guard, 0 = unguarded (§6.9) |
| `aliensense.nxs.calibration.progress` | read-only | `natural8[3]`, `[state, detail, result]`, the on-device procedure surface (§6.9) |
| `aliensense.nxs.calibration.epoch` | read-only | `natural16`, the record's change counter. It brackets a multi-register record read (§6.9), the same counter the I²C `CALIBRATION_EPOCH` cell serves |
| `aliensense.nxs.descriptor.epoch` | read-only, volatile | `natural16[1]`, the descriptor-set generation: 0 until the first personality load, then 1–255 wrapping past 0, bumped on every personality (re)load. The Cyphal twin of the I²C `DESCRIPTOR_EPOCH` register. A host caches descriptors (and the calibration binding it decodes with) against it and re-reads on change. The active-slot number cannot express a RAM-to-RAM personality swap |
| `aliensense.nxs.fw.describe` | read-only | `string`, the build identity (§6.10), the firmware's `git describe`, identical to the I²C build-info record |
| `aliensense.nxs.fw.confirmed` | read-only | `natural16`, `1` once the running image is confirmed, `0` while it runs in MCUboot's TEST state (§7.2). In that state it reverts on the next reset unless confirmed. A host reads it after an update to know the pushed image is the one running. A supervising host reads it before deciding to `CONFIRM_FW`. Treat an absent register (older firmware) as unknown, never as unconfirmed |

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

The persistent registers report `persistent = true`: `node.id`, `can.bitrate`, `can_term`, `sample_fifo.depth`, every `pub.<name>.id`, `decimation`, each `decimation.<subject>`, and the calibration record registers (§6.9). `file_server_id`, `uavcan.diagnostic.severity`, and `param.<name>` are RAM-only (`persistent = false`) and revert to compiled defaults on reset.

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

**`param.<name>` acceptance is read-back, not response-coded.** A `natural32` value in the write request is forwarded to the personality and the validation result is discarded. The Access response is therefore identical whether the value was accepted or rejected: it always carries the parameter's live `current_value`. An out-of-set value is not signalled in the Access response on this transport. A host confirms acceptance by reading the parameter back, through a subsequent `register.Access` read or through `GetParamInfo`, whose `current_value` field reflects the applied value. On the I²C map a commit ends FAULT with `EINVAL` for a value off an enum row's list, and a range value clamps (§6.4).

#### 8.2.8 Standard SI projection

Alongside the proprietary `aliensense.nxs.RawSample.0.1` stream (subject 6144 default, §8.2), every sample is also projected onto stock `uavcan.si.sample.*` and `reg.udral` subjects. A consumer reads acceleration, angular velocity, temperature, pressure, and a geodetic point-state in physical SI units with stock Cyphal tooling. It needs no descriptor list, which the RawSample stream requires.

The firmware walks the active personality's output descriptors and decodes each numeric field to its SI physical value (`raw * effective_scale + offset`). It applies the per-unit calibration (§6.9), and routes the value by semantic code (§6.6) into the matching standard subject. The *effective* scale is the descriptor's base `scale`, multiplied by the live `current_value` of a linked parameter when the field declares one (§6.6, `scale_param_index`). A runtime full-scale-range change, for example an IMU `accel_fs` write, therefore tracks on the wire with no image re-upload. The scalar and vector subjects narrow to their wire type (`float32`), and the geodetic position is carried as `float64`.

| Source semantic(s) | Subject-ID (default) | Cyphal DSDL type | Notes / slots |
|---|---|---|---|
| `accel_x` / `accel_y` / `accel_z` (1–3) | 6146 | `uavcan.si.sample.acceleration.Vector3.1.0` | `float32[3] meter_per_second_per_second`, with X→[0], Y→[1], Z→[2] |
| `gyro_x` / `gyro_y` / `gyro_z` (4–6) | 6147 | `uavcan.si.sample.angular_velocity.Vector3.1.0` | `float32[3] radian_per_second`, with X→[0], Y→[1], Z→[2] |
| `mag_x` / `mag_y` / `mag_z` (7–9) | 6151 | `uavcan.si.sample.magnetic_field_strength.Vector3.1.0` | `float32[3] tesla`, with X→[0], Y→[1], Z→[2] |
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

- Position latitude and longitude are radians as `float64`. Altitude is metres as `float64` (`uavcan.si.unit.length.WideScalar.1.0 meter`), referenced to **mean sea level (MSL)** per the DSDL's altitude definition. That definition reads "distance between the local mean sea level (MSL) and the focal point of the antenna". A receiver's ellipsoidal (WGS84) height is not published on this subject. Personalities expose it as the generic field `alt_ellipsoid` in the RawSample stream.
- Velocity is NED metres per second (`float32[3] meter_per_second`): `vel_north` → [0], `vel_east` → [1], `vel_down` → [2]. Components default to 0 when not supplied.
- Covariance is carried on the upper-right-triangle diagonal of each 3×3 matrix (`float16[6]`, elements [0], [3], [5]). Position covariance (m²) takes `pos_h_acc²` for the latitude and longitude diagonal entries and `pos_v_acc²` for the altitude entry. Velocity covariance, in (m/s)², takes `vel_s_acc²` on all three diagonal entries.
- A missing accuracy field yields the sentinel variance `1.0e6` rather than 0. So does, for velocity covariance, a fix with no velocity component supplied. A zero covariance reads as perfect certainty, and the sentinel marks the axis as effectively unknown.

**Enable / disable.** Each subject is emitted only when both a routed field is present in the sample and its subject-ID is non-zero. An ID of `0` disables that projection. Each subject-ID is the writable, persistent `uavcan.pub.<name>.id` register (§8.2.7), host-commissionable, and `register.List` enumerates them. The defaults are the vendor-fixed band: accel 6146, gyro 6147, magnetic field 6151, temperature 6148, pressure 6149, GNSS 6150, scalar block base 6152. The compiled defaults live in the constants registry (`constants/cyphal.yaml`).

**Timestamp.** Every projected subject carries the sample's acquisition instant in its `timestamp.microsecond` field. That instant is the delivered DRDY edge (or declared frame bound) behind the sample's measure pass, or the commit instant for event-less pacing. It is never the publish moment. While a pushed discipline is fresh the field carries mesh time, and otherwise the local clock in microseconds since boot (§6.8). A host translates a local stamp into its own time domain with a bounded error through the two-way sync surface (§6.8).

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

The wheel is built from the product source tree with `python3 -m build --wheel` in `sdk/`. Installing from the source tree directly (`pip install .`) requires setuptools ≥ 62 in the build environment. On hosts with older stock toolchains (Ubuntu 22.04 and derivatives) the build silently produces an empty `UNKNOWN-0.0.0` package, so use the wheel.

Global options:

- `-t {i2c,cyphal-serial,cyphal-can}`: default `$NXS_TRANSPORT`, else I²C on Linux / Cyphal/serial on macOS, Windows.
- `-b BUS`: default `$NXS_BUS`, else the one i2c unit suite.yaml declares, else the single unit answering on the platform's camera buses. Several units refuse by name.
- `-a ADDR`: default `0x30`.
- `-p PORT`: `$NXS_PORT`, the serial device, auto-detected when omitted.
- `--baud`: default 460800.
- `--mtu {8,64}`: the Cyphal/CAN frame MTU, default `$NXS_CAN_MTU` or 64. Pass 8 on a bus running a Classic profile.
- `--remote-node-id N`: the Cyphal target node-ID, default 125, the plug-and-play factory address.
- `--unit NAME`: a declared unit by its declaration name. The declaration supplies the transport and link, overriding `-t`/`-b`/`-p`/`-a`.
- `--experimental`: the paths in `$NXS_CAM_HUBS` and `$NXS_CAM_PERSONALITIES`, the experimental overlays, a development personality store.
- `--version`.

| Command | Action |
|---|---|
| `probe` | Presence check (`MAP_ID`). Over I²C it also reports the interface version and warns when it is newer than the tool supports. Bare on a camera host: every camera bus swept for hubs, units, and sensors |
| `status` | Addressed (`-b`, `-p`, `--unit`): device identity (`SERIAL`), VM, runner, and store status. Over I²C it adds the cam personality the store holds, with its slot and its unit door's state and errno. The line reads `Camera:`, `no mode` before a run set one, `(none)` when the store holds none. A unit of interface version 1 reads one line instead, which names `nxs switch`. Then come the fault counters (§12) on transports that serve them. The `Outputs:` block follows: each output field's name, type, byte order, semantic, scale, offset, and unit (§6.6). Over I²C a held session (a calibration procedure or a firmware push) prints as `Session: held` in place of the slot details. Bare: the declaration against the rig, node by node (`--json` for the tree) |
| `upload <name\|file> [--param K=V …] [-o FILE] [--slot N]` | Compile a personality by name, shipped or installed, or a local `.py` given by path, and upload it. A path to a compiled `.nxs` uploads verbatim. `-o` writes the compiled image to that file instead of a device, an offline producer for fleet file-servers. A cam personality lands in a store slot, `--slot` the one it takes (§6.11). It overwrites the slot it replaces in place, and a slot past the populated ones appends after them (§6.5). The line names the slot it took |
| `run` | Run the loaded personality again |
| `caps` | List personality parameters with their allowed values, current value, and default |
| `get <name>` / `set <name> <value>` | Parameter access, two families under one verb: the device's parameters below and the personality's parameters (`sample_rate`, `accel_fs`, …). A device parameter's name reaches the device's parameter, whatever row the personality names so. A value is a number, or a name where the row's `PRESENTATION` entry names its values, and `get` prints that name beside the number. A name neither family carries is refused with both lists |
| `get decimation` / `set decimation N` / `set decimation.<subject> N` | Device-output decimation, the device-wide factor, or a per-subject SI factor (§8.2.8). `<subject>` is the subject's full name, such as `temperature`. Live. Persist with `commission --save` |
| `get can-bitrate` / `set can-bitrate NOMINAL[/DATA]` | CAN bit-timing profile (§8.2.7): one rate selects Classic CAN, a pair selects FD, `0` reverts to the default. Staged. Persist with `commission --save`, and it applies at the next reboot |
| `get can-term` / `set can-term on\|off\|default` | On-board CAN split termination (§8.2.7). Applies live. Persist with `commission --save` |
| `get fifo-depth` / `set fifo-depth RECORDS` | Sample FIFO depth in records (§6.3), `0` = all the storage holds. Applies live. Persist with `commission --save` |
| `get orientation` / `set orientation ROTATION` | The running personality's `orientation` row, one of the 24 rotation codes by its number or its name, `ROLL_90` (§6.9). A set applies live, and a converge sets the value the declaration states again. Where the running personality has no such row, the name is refused with both lists |
| `calibrate gyro\|mag [--no-persist]` | Trigger the on-device solves (§6.9) with a progress readout. `mag` auto-stops at sufficient coverage |
| `calibrate accel [--no-persist]` | Accelerometer wizard: six poses plus two check poses auto-capture on stillness, the per-axis scale and offset solve host-side and upload via the record write (§6.9) |
| `calibrate encoder-zero [--no-persist]` | Declare the current angle as mechanical zero (circular mean of 50 samples) |
| `calibrate show [--full]` | The rotation the `orientation` row holds, per-bucket solved/identity state with the guard verdict, encoder zero. `--full` prints M and b |
| `calibrate reset [accel\|gyro\|mag\|encoder\|all]` | Write the identity calibration and persist |
| `commission [--node-id N] [--subject NAME=ID …] [--can-bitrate NOM[/DATA]] [--can-term on\|off\|default] [--save] [--show]` | Commission the Cyphal node-ID / subject-IDs / CAN link (§6.7, §8.2.7). `--show` reads the current identity. `--node-id` / `--subject` / `--can-bitrate` stage and commit (reboot to apply). `--can-term` applies live and commits. `--save` alone commits staged running config, for example decimation, to NVS. Over I²C `--node-id` and `--can-bitrate` commit the device rows, and `--subject` is refused: the subject-IDs are Cyphal registers, set over a Cyphal transport |
| `stream [--raw] [--count N] [--hz N] [--units human\|si] [--json]` | Print decoded (or raw) samples, each with its timestamp and the rate the unit's timestamps give over the last second, from the second sample on. The closing line gives the rate over the read. `--json` is one document of fields and samples, with that rate as `rate_hz`, left out of a read of one sample |
| `identify` | Strobe the status LED for about 10 s to locate the unit |
| `timesync [--interval S] [--once] [--unit NAME …]` | Push the host time discipline (§6.8). Bare, it pushes to every unit the declaration declares as a resident pusher, and `--unit` narrows it, repeatable. A host that runs `nxsd` needs none, since the daemon disciplines the units. Addressed with `--unit NAME` before the verb, it pushes to that one unit |
| `store ls` | List store slots. Slot details are unavailable while a session is held, and the listing says so |
| `store save <slot>` | Persist the uploaded personality |
| `store rm <slot>` / `store clear` | Delete one slot / all slots |
| `store cycle` | Advance to the next populated slot |
| `map check [--json]` | `nxs <unit> map check`, or `-t i2c -b <bus> -a <unit address>`, proves the map at both doors against the unit's own records (§4). Where no unit answers, `nxs -t i2c -b <bus> map check` proves a smart camera's capture cells at `0x31` against the installed personality whose rows it serves. It reads the identity, the rows and the mode table, and runs the default mode. It commits each APPLY row in range. It commits each unsigned range but the rate past its maximum, the refusals §6.4 names, the stream gate and a mode switch. A map that streams, or a port nxsd holds, is refused with `nxs <port> off`. It prints a `✓` or `✗` line per check and exits 1 when one fails. `--json` emits the `map_check` document, its `unit` null for a smart camera |
| `push-fw <image> [--allow-downgrade]` | Firmware update (§7.2, §7.3). Refuses a file that is not a signed MCUboot image before touching the device. Names the running version and asks before installing an image older than it, since the bootloader has no downgrade check. `--allow-downgrade` answers for a script. After the reboot it waits up to 30 s for the device and reports `✓ updated`, `✓ unchanged`, or `✗ rejected or reverted` (exit 1). The verdict compares the build identity the device serves after the push against the one the pushed file carries |
| `confirm-fw` | Confirm the running image so it survives the next reset (§7.2). Required by supervised builds, harmless on the default build |
| `recover` | Enter bootloader serial recovery, on either transport |
| `reboot` | Cold-reset the unit from the application, mid-session too: a staged update swaps in, an unconfirmed image reverts (§7.2). Either transport |
| `generate [--dry-run] [--json]` | Walk the rig and write `hardware.yaml`, what answered. Seed `suite.yaml` in api 3 when there is none. A declaration of api 2 or of the 1.0 form is written again in api 3. The earlier file stays beside it as `suite.yaml.api2` or `suite.yaml.1.0`. A fact api 3 derives and states nowhere refuses the conversion, naming the fact. `--json` prints the walk as data |
| `describe <type> [--json]` | What a node of a type offers a declaration, from its description alone (§10.1). It prints the kind, the ports with their types and directions and the identity pins the node takes. It prints each row with the values it admits, in the form a declaration writes. A type is a host plugin, a Hub's deserializer compatible, a unit module, `nxs` or `nxs-module`, a cam personality or a click personality. A unit's ports come from its module kind, and its rows from a live unit. A type nothing installed describes is refused. `--json` emits the `describe` document |
| `switch [--dry-run] [--fdt PATH] [--unit NAME] [--accept-new-serial]` | Realize `suite.yaml`: the host's files, the camera buses on a host that boots none, the camera ports and every declared unit. A host that boots none then prints `REBOOT NEEDED`, exit 3, with or without a declaration. `--dry-run` prints the same lines with nothing done. `--fdt` names the base device tree the generated boot table loads, where the tool cannot pick the Jetson module's own. A path that names no file is refused with nothing written |
| `tune [--list] [--set CHANNEL[:SECTION]:FIELD=VALUE …] [--schema] [--play] [--json] [--freeze [--unit NAME] [--ports [--port NAME]] [--dry-run]]` | The declaration panel: edit the declared config from real options only. Each node has one section of its block's rows beside the knobs that declare it. `--set` names a knob by its channel, a port `cam1`, a link `cam1/A` or a unit by its name. SECTION is a section's label, needed where the field repeats in the channel, and a batch of `--set` saves once. `--schema` prints the rig's rules as JSON Schema. That is the declaration schema with each node's parameters narrowed to the rows its block offers here and their values. `--freeze` adopts the units' live tuning into the declaration, `--ports` the camera ports and `--port` one of them |
| `host info\|modes` | The capture host's contract: what booted, a port's mode table |
| `ros2 [--plan] …` | Bridge decoded samples onto ROS 2 topics |
| `personality check\|install\|records` | A personality on the host: validate one before installing it, install one into the store, or print its trailer. `records <path> [--hex]` prints the trailer record by record (§10.1), with each record's type, length and place. The rows of `PARAMS`, `PRESENTATION`, `OUTPUTS` and `PORTS` print decoded, one row per line, and `--hex` adds each record's bytes |
| `mcp [--doc-table]` | Serve the verbs to an AI agent over MCP (stdio) |

The camera family (`on`, `off`, `stream`, `capture`, `status`, `caps`, `get`, `set`) runs under the node grammar `nxs <port> [<link>] <verb>`. It is specified in the [Integration & Operation Manual §5](../nxs-integration-manual/) and the [Cam Personality Reference](../nxs-cam-personalities/).

On a pod's link and on a smart camera, `caps`, `get` and `set` take the map's rows by name (§4.5). `caps` lists the APPLY rows that are not read-only as knobs, and `fps`, `gain_db` and `mode` for the rate, gain and mode rows. `set <knob> <value>` commits the knob's row in the row's unit (§6.4). `exposure` also takes a time, `4ms` or `4000us`, `gain_db` takes decibels, and `fps` takes a rate the laws judge, committed in milli-frames per second. Any other knob takes a whole number in its row's unit. `get <knob>` reads the row's `LIVE` value in the knob's unit, and under frame sync `get fps` reads the Hub's generator.

A stream, trigger or read-only row is no knob. `set mode <row>` switches the mode as `on --mode` does, and on a Hub's port `set sync` converts the trigger. Under frame sync a pod's head converts by a commit of its trigger row. `nxsd` copies a pod pair's gain by commits of the gain row, in millidecibels. A head with no unit that is not a smart camera keeps the host's register path.

`set orientation` applies live. The `calibrate` verbs persist their result by default. `--no-persist` leaves it in the running state (§8.2.7), reverting at power-cycle.

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

The C header of `libnxs`, `nxs.h`, and the documents the verbs print under `--json` keep their shape from 1.2.0 on. 1.1.0 previewed them, so a program built against its header rebuilds against 1.2.0. The rules:

- A struct in `nxs.h` keeps its size, its layout and the meaning of each field in every later release. A program built against an earlier header therefore keeps working against a later library. A new field arrives as a new struct with its own function beside the released one. `nxs_capture_pair_of` reads a synced pair's part beside `nxs_capture_of`, `nxs_capture_timing_of` reads a triggered link's frame timing beside it, and `nxs_unit_read_cam_runs` reads the camera-run counter beside `nxs_unit_read_diag`. A function keeps its signature and the meaning of its return values, and an enum keeps every value it has.
- Every `--json` document carries `contract`. This release prints contract 2, described by the `surface` schema the SDK ships. A release candidate previews it, and the final release fixes its keys. The schema lists every key an object may carry and refuses any other. A key added to any object therefore comes with a new contract number and that number's schema, as a renamed or removed key does. A program reads `contract` first and refuses a number it does not know.
- The 1.2.0 shape includes these facts. `nxs.h` declares no assembler and no compile entry point: a program compiles a personality with `nxs upload <name> -o <file>` and passes the image to `nxs_unit_upload` or `nxs_run`. `nxs_report` carries 16 run values, the image format's parameter cap. A frame's `timestamp_ns` is the sensor's start of frame on `CLOCK_MONOTONIC`. A unit in the bare `status --json` tree carries no `native` field. The `map_check` document's `unit` is a string, or null for a smart camera.

## 10. Personality authoring

A personality is a Python class, datasheet as code. Class attributes name the bus addresses and identity check (`I2C_ADDRS`, `WHO_AM_I_REG`, `WHO_AM_I_VALUES`) and per-bus communication profiles (§10.2). Methods define `probe()`, `configure()`, and a measure loop. Declared parameters, 16 at most, output fields, 16 at most, and ports, 16 at most, become the descriptors of §6.4, §6.6 and §10.1. The compiler traces the class into VM bytecode and packs it with the descriptors into an NXS image (bytecode ≤ 4096 bytes). Each output field's semantic category (§6.6) is inferred from its field name at compile time, and personalities do not declare it.

Click personalities are generated from a sensor datasheet by the `nxs-generate-click-personality` skill that ships with the SDK, then compiled and uploaded with `nxs upload`. The authoring reference is [`nxs-click-personalities.md`](../nxs-click-personalities/).

### 10.1 Image format version

The NXS image begins with a 13-byte header, in this order:

- a 4-byte magic, `NXS\0`, the ASCII bytes `N` `X` `S` then a NUL pad, `4E 58 53 00`
- a 1-byte **major** and a 1-byte **minor**
- a 1-byte **kind**: 0 CLICK, 1 CAMERA, 2 HUB, 3 MODULE, 4 GRAPH, 5 HOST. A CLICK image is a click personality, a CAMERA image a cam personality and a MODULE image a smart module's personality. A HUB image is the program of a device on the host's own bus. A HOST image is a host's description, its ports and its rows with no program. A GRAPH image is the compiled bring-up of a graph, a released hub image's sealed section under the plain records of one rig. The host library runs a HUB and a GRAPH image, and a unit refuses them and a MODULE image at upload
- a 1-byte **flags** field, bit 0 the bytecode section is sealed, bit 1 reserved
- the personality-name length and the parameter and output counts
- a 2-byte **probe length**, the offset inside the bytecode where `probe()` ends and `configure()` begins

A probe length past the end of the bytecode is refused at load. This version is distinct from `PROTO_VERSION` (§2). `PROTO_VERSION` is the register-map contract, while the NXS major/minor is the image format the firmware executes.

After the name comes the bytecode section. When plain, it is a 2-byte length and the bytes. When sealed, it is a 16-byte nonce, the 2-byte length, and the ciphertext (AES-128-CTR under a key the firmware holds). The device decrypts the ciphertext into its program buffer at load and never serves it back. The probe block, the parameters, the outputs, and the communication-profile trailer (§10.2) follow.

A descriptor trailer closes the image, at most 4096 bytes in all: a count byte, then records of type, length and bytes. The type is 1 byte and the length 2 bytes, little-endian. The device keeps the trailer as it is and serves a cam personality's through personality info (§6.11). Record types:

- 1 MODES: the index of the `mode` parameter, then each mode's value, geometry, timing, and name
- 2 CONTROLS, 3 LAWS, 4 CAPTURE, 5 INSTANCE_CAL (reserved)
- 6 IDENTITY: the 64-byte head every image kind carries, then a cam image's 16-byte tail, both laid out below. The head holds the address, the flags, the firmware version, the serial, the compatible and the product. An image carries no serial and firmware version `0.0.0`. The tail holds the register and value widths, the identity and alive registers and the default mode. A host names a block by the model its compatible names after the vendor
- 7 PROGRAM
- 8 TRIGGERS: the index of the `trigger` parameter and each conversion's value and name
- 9 SHIPPED, retired: the number stays reserved, no compiler writes it and every decoder skips it
- 10 STATUS: the status probes, register, format, decode table
- 11 RUN_PARAMS, retired: the number stays reserved, no compiler writes it and no host reads it
- 12 CAMERA_MAP: the camera law a pod converts the PARAMS rows with (§4.5). It carries the mode count, the gain factor and the indices of the 11 VM run values a commit stages. Then come the gain range in capture units, the frame-length capacity, and the exposure minimum and margin. A law row per mode follows, its line time and frame-length floor, and the mode-table rows the map serves close it (§4.4)
- 13 PARAMS: the parameters a personality declares, one 64-byte row each (§4.5) with its name, unit, id, type, kind, flags, default and values. A click image always carries it, and a cam image carries it beside CAMERA_MAP. A click personality's rows are its VM parameters, which the unit door also serves (§4.5). The camera door serves a cam personality's rows verbatim. A hub or host image carries the rows a declaration sets on its block and its public parameters' rows, and none when it declares neither
- 14 OUTPUTS: the output fields a sampling or module personality declares, one 64-byte row each (§6.6). A row holds the name, unit, semantic, type, flags, count, position, scale and offset. A field whose scale follows a parameter carries the scale at the parameter's compiled value
- 15 PORTS: the typed ports an image's block offers, one 32-byte row each, 16 at most, which a graph connects by type. Every image the compiler writes carries it, and a graph image carries none. The table below lays out a row
- 16 GRAPH_SOURCE: a graph image's source, 40 bytes. It names the hub program the records compose against by its name and the CRC-32 of its section as stored. Then come the declaration's digest, the hub's address, the owner and the flags of a homogeneous pair, a declared sync and a declared gain
- 17 GRAPH_LINKS: one 88-byte row per link of a graph image. A row carries the link's addresses, lanes, data type and address map. It names the personality a pod's slot holds, or the image the owner runs at a bare head, each by name and trailer CRC-32. It closes on the personality's parameter indices and every value a walk stages for the link
- 18 GRAPH_OUTPUTS: one 8-byte row per CSI output of the hub. A row carries the lanes, the rate, the pipes the output carries, the mode, the consumer and each link's virtual channel
- 19 GRAPH_WALKS: the run parameters every hub phase stages, then the walks of a graph image. A walk is a list of 8-byte steps. A step is a hub phase, a pod action, a call to the owner, a row commit or a pod's convergence
- 20 HUB_PHASES: a hub program's phases, one 17-byte row each with the phase's number and name. A hub program that offers ports carries it, and a graph image carries its program's
- 21 PRESENTATION: how the rows read, laid out below. One 8-byte entry per PARAMS row carries a display unit, a decimal exponent and a flags byte. Then come the names of the rows whose flags bit 0 is set, in row order. A host prints a row's value from this record alone. Every image that carries PARAMS carries it, its entries in the rows' order
- 0xE0 to 0xEF are vendor records the tool never interprets, and an unknown type is kept and skipped

A row of the PORTS record:

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `NAME` | 16 | ASCII, NUL-padded: the port's name, unique in the personality, such as `links.A` |
| 16 | `TYPE` | 1 | `0` csi, `1` gmsl, `2` i2c, `3` cyphal-can, `4` cyphal-serial, `5` usb, `6` uart, `7` head, `8` click |
| 17 | `DIRECTION` | 1 | `0` an input, which takes one source. `1` an output, which feeds the inputs wired to it. `2` a bus whose ports are peers |
| 18 | reserved | 14 | `0` |

A port connects to a port of its type, and a head output also feeds a gmsl or a csi input. A port carries no attribute of its own. An attribute is a row of the block named for the port, lower case with `_` for a dot: `csi_a_lanes` holds the lanes of `csi.A`.

A click image offers one port, its output `out` of type click, and a cam image its output `out` of type head. The hub image offers the inputs `links.A` and `links.B`, the outputs `csi.A` and `csi.B` and the control input `i2c`. A host image offers each camera connector as a csi input, `cam0`, with its I²C bus as an output beside it, `bus_cam0`. Its rows `cam0_lanes` and `cam0_driver` hold the connector's lanes and who drives the Hub behind it. A graph image offers none. A device that serves the map takes its own ports from its `MODULE_KIND` (§4.1):

| `MODULE_KIND` | Ports |
|---|---|
| `1` a unit, `2` a pod | `head` head input, `click` click bus, `out` head output, `i2c` i2c input, `can` cyphal-can bus, `serial` cyphal-serial input |
| `3` a smart camera | `out` head output, `i2c` i2c input |
| `4` a smart module | `csi` csi input, `i2c1` i2c output, `serial` cyphal-serial input |

The head of the IDENTITY record, 64 bytes:

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `ADDRESS` | 1 | The block's 7-bit bus address, `0` where it has none |
| 1 | `FLAGS` | 1 | Bit 0: the head takes the hub's trigger. Bit 1: the trigger pulse's width is the exposure |
| 2 | `FW_MAJOR` | 1 | The firmware version the block runs or was built against, `0` where it has none |
| 3 | `FW_MINOR` | 1 | |
| 4 | `FW_PATCH` | 1 | |
| 5 | `SERIAL_LEN` | 1 | Bytes of `SERIAL` in use, `0` for a block without one |
| 6 | reserved | 2 | `0` |
| 8 | `SERIAL` | 16 | The block's serial, raw bytes MSB first |
| 24 | `COMPATIBLE` | 32 | ASCII, NUL-padded: the block's compatible, the type a declaration names it by, such as `acme,des1` |
| 56 | `PRODUCT` | 8 | ASCII, NUL-padded: the product name the tool prints, such as `NXS Hub` |

The tail a cam image appends to the head, 16 bytes, so its IDENTITY record is 80 bytes:

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 64 | `REG_BITS` | 1 | The register address width in bits |
| 65 | `VAL_BITS` | 1 | The register value width in bits |
| 66 | `DEVICE_ID_REG` | 2 | u16: the identity register, `0xFFFF` for a head without one |
| 68 | `DEVICE_ID_WIDTH` | 1 | Bytes of the identity value |
| 69 | `DEVICE_ID` | 2 | u16: the identity value |
| 71 | `ALIVE_REG` | 2 | u16: the register a liveness read takes, `0xFFFF` for a head without one |
| 73 | `DEFAULT_MODE` | 1 | The `MODE_VALUE` the head runs when the declaration names none |
| 74 | reserved | 6 | `0` |

An entry of the PRESENTATION record, one per PARAMS row in row order:

| Offset | Field | Bytes | Meaning |
|---|---|---|---|
| 0 | `UNIT` | 6 | ASCII, NUL-padded: the unit a value is shown in, `dB` for a row served in `mdB` |
| 6 | `EXPONENT` | 1 | Signed: a shown value is the served value times ten to this power, `-3` for a row served in thousandths |
| 7 | `FLAGS` | 1 | Bit 0: the record's tail names this row's values |

The names follow the entries, for each row whose bit 0 is set, in row order. A row's names are a count byte, then per value a length byte and the name, 1 to 31 printable ASCII characters. They name an enum's values in the order of its values, and a range's from its min by its step. No two names of a row are alike. A gain row served as `0` to `48000` by `100` in `mdB` reads `0..48 by 0.1 dB` through an entry of unit `dB` and exponent `-3`. A stream row reads `off` and `on` through its names.

The layouts of records 16 to 20 are the `GraphSourceField`, `GraphLinkField`, `GraphOutputField`, `GraphWalksField`, `GraphStageField`, `GraphWalkField`, `GraphStepField` and `HubPhaseField` tables of `constants/nxs_map.yaml`. The tool composes a graph image from a released hub image and seals nothing. The hub's sealed section passes through byte for byte, and the records are plain.

The [Cam Personality Reference](../nxs-cam-personalities/) lists what each record carries.

LOAD runs an image only when all three hold:

- **major == the firmware's NXS major.** A differing major means the wire layout or an opcode's semantics changed, and the image is rejected.
- **a major-1 image's minor ≥ 1.** Format 1.0 predates the current header, and the firmware refuses it as an image of another major.
- **the image's minor ≤ the firmware's NXS minor.** The compiler stamps the format version of the wheel that built the image. A firmware older than that wheel refuses the image here. It never meets an opcode, an image kind or a trailer record past the gate.

`LOAD` refuses an image that fails any of them with `ENOTSUP`. `SAVE` holds the staged image to the same gate, so an image of another format version never reaches a slot (§6.5). The host reads both as `the unit does not take this image: it needs a newer firmware (nxs <unit> push-fw <file>)`.

The contract is one-directional. New firmware runs old images of the same major from its first minor on, 1.1 for major 1. Old firmware cleanly refuses an image that needs an opcode it lacks rather than mis-executing it. A new opcode, image kind or record type ships in a new minor, and an incompatible format change in a new major.

The image format version is the product version's major and minor. A 1.1.x wheel builds images of format **1.1**, and 1.1.x firmware runs them. The `nxs` tool refuses a compiled image of another format with its rebuild command. The tool recompiles every built-in personality on upload, and `nxs switch` re-provisions saved slots.

### 10.2 Communication profiles

A register personality declares one communication profile per bus it supports. The profile is the wire framing (address byte count, R/W bit polarity, dummy bytes, auto-increment scheme), clock ceiling, and SPI mode. The compiler bakes every declared profile into the image as a trailer. At load the firmware applies the profile matching the active `bus` parameter (§6.4) to the peripheral before `probe()` runs. A part whose SPI protocol deviates from the conventional bus is therefore reached without any per-part firmware code. Such a deviation is a 2-byte address phase, or the R/W bit cleared rather than set for a read.

Every supported bus's profile is present in the image. Switching a dual-bus part between I²C and SPI is therefore a `bus` write plus a reload, not a new image. A personality that declares no deviating profile runs the conventional register bus. That bus is a single address byte, the R/W bit in bit 7 set for a read, and implicit auto-increment.

An I²C profile also declares the register-address width, 1 or 2 bytes, the value width, 1, 2, or 4 bytes, and the byte order. The conventional profile is one address byte and one value byte. A personality whose profile declares 2-byte addresses may use the full 16-bit register operand. Every register opcode, `POLL_REG` included, moves values at the declared width.

## 11. Limits

| Quantity | Value |
|---|---|
| Host interface version | 2 |
| Map layout version | 1 |
| NXS image format version (major.minor) | 1.1, the product's major and minor |
| I²C target addresses | `0x30`, the unit door, and `0x31`, the camera door (§4) |
| Register pointer | 2 bytes. A read latches the first 2048 bytes at its first byte (§3.3) |
| Map span | `0x0000` to `0xFFFF`, closed by the personality-info region at `0x8000` (§4) |
| Upload and firmware chunk | 128 bytes of data after a 4-byte cursor (§6.1, §7.3) |
| Cyphal file-pull chunk | 256 bytes |
| Update slot capacity (firmware image) | 221,184 bytes, the 220 KiB update slot minus 2 KiB of bootloader swap bookkeeping and 2 KiB of swap working space |
| Sample record | 128 bytes (18-byte header + ≤ 110 data bytes, §6.3) |
| Sample FIFO | 2048 bytes of records, 10 bytes of header per record, burst read ≤ 256 bytes, the `fifo_depth` row 0–255 records (§6.3) |
| Personality bytecode | ≤ 4096 bytes (CLICK and CAMERA). A HUB or GRAPH image ≤ 16384 bytes, the host executor's budget |
| Serialized personality image (header + descriptors + bytecode) | ≤ 6144 bytes |
| Personality / parameter / output-field / port name | 15 characters, in a 16-byte field |
| Unit string | 6 characters, a row's `UNIT` and a `PRESENTATION` entry's (§4.5, §6.6, §10.1) |
| Value name | 31 characters, in the `PRESENTATION` record (§10.1) |
| Parameter rows per personality | 16. The unit door serves 64 rows, the running personalities' and the device's together. The camera door serves the camera personality's alone (§4.5) |
| Parameter value set | 16 values, 8 when a value passes 16 bits (§4.5) |
| Patch sites per parameter | 2 |
| Output rows per personality | 16 |
| Port rows per image | 16 (§10.1) |
| Communication profiles per image | 3 |
| Store slots | 8, each with a 4096-byte personality-info region (§6.5) |
| Camera program bundle | ≤ 4096 bytes, ≤ 48 sequences, ≤ 16 programs, ≤ 14 sequences per program (§6.11) |
| Descriptor trailer | ≤ 4096 bytes (§10.1) |
| Mode table | 16 modes (§4.4) |
| Camera program write retries | 5, 50 ms apart, for a run. 2, 1 ms apart, for an apply (§6.11) |
| Apply window | the painted `APPLY_RUN_MS`, then 20 ms of 1 ms polls (§6.4) |
| Run window | the painted run time, then 6000 ms of 10 ms polls (§6.4) |
| Command queue depth (I²C) | 8 |
| DFU staging erase stall | ~2.5 s |
| Session stale window | 5 s of holder silence (§6.1, §7.3, §7.5) |
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
| Subscriptions | 12 |
| TX transfer deadline | 1 s |
| File-pull read timeout | 1 s |
| File-pull retries | 5 |
| Cyphal/serial single-frame payload | 512 bytes (buffer size, not a wire ceiling) |
| Node-ID (compiled default) | 125. A commissioned node-ID persists on the device and overrides it |
| CAN MTU | 64 bytes on FD profiles, 8 bytes on Classic profiles |
| CAN bit-timing profiles | FD 1M/4M (default) and 1M/2M, Classic 1M, 500k, 250k, 125k, with sample points fixed 0.875 / 0.750 |

## 12. Error reporting

`VM_ERROR` (`0x0021`) reports the VM error byte, synced from `vm_status`: 0 when healthy, otherwise the code the faulting personality raised. The compiler's own codes are these. 17 is `TIMEOUT`, a `read_n`/`read_until` deadline, and 18 is `MISMATCH`, an `expect()` byte mismatch. 0xC0 is `WHO_AM_I_MISMATCH` and 0xC1 is `COMPANION_MISMATCH`. A personality may raise any other value as its own code.

Every other VM fault leaves the byte 0. `VM_STATE` = 2 with `VM_ERROR` = 0 is a fault the map cannot classify (`VM_IO_ERRORS` counts the I/O ones). `STATUS` bit 1 mirrors the VM error state (`VM_STATE` = 2), not the byte. When a personality code raised the fault, `VM_STATE` = 2 with `VM_ERROR` gives the detail.

`CMD_ERROR` (`0x0042`) reports host command results, the calibration commands (§6.9) included, as a positive errno. It reads `CMD_ERR_PENDING` (`0xFF`) from enqueue until an async op resolves (§5). The two registers have disjoint writers: a `vm_status` update can never overwrite a command result, and a command can never mask a VM error. A completing calibration procedure latches its verdict here too, but only while it holds the session. The store and DFU commands refuse to run alongside a session (`EBUSY`), so a procedure and a command result cannot collide. A command issued while a host-commanded procedure runs therefore reads `EBUSY` and retries rather than reading someone else's answer.

The boot-automatic gyro window (§6.9) refuses nothing: the pass yields to the claim and the command runs. Beyond each backend's own errnos (flash, store, validation), the transfer protocol reports:

| Errno | Value | Meaning |
|---|---|---|
| `EBUSY` | 16 | a session is live: another upload, a firmware push or a calibration procedure holds the device |
| `EPROTO` | 71 | a zero-size announce. A configure whose personality raised an error code of its own |
| `EFBIG` | 27 | the announced size exceeds the staging buffer. A camera run whose program is larger than the camera runner holds |
| `ENODATA` | 61 | `LOAD` on a stage short of the announce, where bytes were lost in transit. `DFU_FINISH` before any chunk was accepted, or when the image's declared length runs past the staged bytes |
| `ENOEXEC` | 8 | `LOAD` on bytes that are not a valid personality image. `DFU_FINISH` on staged bytes that are not an MCUboot image |
| `EBADF` | 9 | `ACTIVATE_SLOT` on a corrupt image, or a configure of a slot whose cam personality does not parse |
| `EFAULT` | 14 | a camera run whose personality's program faulted, at an instruction the run's other errnos do not name. The unit's log names it |
| `ENOSPC` | 28 | a DFU chunk that would run past the update slot's capacity (§11) |
| `ENOENT` | 2 | `SESSION_ABORT` with no session to release. `DFU_FINISH` or a `DFU_CHUNK` write with no session open (no `DFU_BEGIN`, or the session was evicted as stale). `ACTIVATE_SLOT` or `DELETE_SLOT` naming an empty slot. `ABORT` with no commit in flight |
| `EAGAIN` | 11 | the command was dropped at a full device queue before dispatch, so retry |
| `ENXIO` | 6 | a camera run whose personality names no I²C address or bus profile for its sensor |
| `ENODEV` | 19 | `CALIB_PERSIST` with no calibration bank |
| `EINVAL` | 22 | a commit that breaks a rule (§6.4), a malformed calibration record |
| `ENOTSUP` | 134 | `LOAD` and `SAVE` of an image of another format version (§10.1). The host reads it as `the unit does not take this image: it needs a newer firmware (nxs <unit> push-fw <file>)`. `SAVE` of a hub image (§6.5). `ACTIVATE_SLOT` on a slot of another format version, which the host reads as `the slot holds a personality image of another format version; reinstall it: nxs switch`. A cam personality whose I²C profile tops out below the pod bus's clock. The bus is shared with the register-map target and cannot be slowed for the run |
| `EIO` | 5 | a camera run's register operation failed past its retries (the sensor stopped answering the unit) |
| `ETIMEDOUT` | 116 | a camera run's hard `POLL_REG` did not match within its timeout |
| `EILSEQ` | 138 | a camera run's register read did not match the value its personality expects |
| `ECANCELED` | 140 | a camera run was aborted |
| `ESTALE` | 133 | a commit whose slot took another personality between the commit's acceptance and its run. The device reloads the rows |

The values are the device's own. Five differ from Linux's numbering: `ETIMEDOUT`, `EILSEQ`, `ECANCELED`, `ESTALE` and `ENOTSUP`. A Linux host translates them by this table.

A failed commit reports in the map's `ERROR` cell (§4.1). It reads `EINVAL` for a commit §6.4 refuses, else the errno of the run that failed, from the table above.

### 12.1 Fault counters

Six counters record faults the device absorbs without failing a command. A seventh counts the RUN commits accepted, and `RESET_CAUSE` holds the reset cause of this boot. Two cells hold an errno instead of a count: the measure loop's latest absorbed I/O error, and the failed transfer before the latest heal. Each fault counter saturates at 65535. They are should-be-zero counters, so a saturated value stays sticky evidence instead of wrapping back to a healthy-looking number. A host reads deltas across its observation window.

On I²C they are the sixteen u16 cells at `DIAG` (`0x1E00`), in index order, read in one transaction. The cells past the named ones read 0.

| Index | Counter | Counts | Cyphal register |
|---|---|---|---|
| 0 | `DRDY_COALESCED` | sample intervals missed because the VM was still busy when the sensor signalled data-ready. Counts from the personality load, and only once the personality has begun waiting, since an idle data-ready line registers nothing. Refreshes at the ~100 ms status cadence | `aliensense.nxs.drdy_coalesced_count` |
| 1 | `INGRESS_REJECTS` | host commands rejected by the transport arbiter (§7.5), counted at reject time | `aliensense.nxs.ingress_reject_count` |
| 2 | `QUEUE_OVERFLOWS` | host writes dropped at a full I²C command queue (§3) | — |
| 3 | `VM_IO_ERRORS` | measure-loop I/O errors the VM absorbed (~100 ms cadence) | `aliensense.nxs.io_err_count` |
| 4 | `PROBE_FAILURES` | probe give-ups (~100 ms cadence) | `aliensense.nxs.probe_failed_count` |
| 5 | `RUNS` | RUN commits accepted since boot, untouched by a refused one. A count, not a fault, wrapping past 65535 | — |
| 6 | `RESET_CAUSE` | the reset cause of this boot as the chip's flags. Bit 0 is the reset pin, 1 software, 2 brownout, 3 power-on, 4 the watchdog, 5 debug, 8 CPU lockup. Read once at boot and then cleared in the chip. A snapshot, not a count | — |
| 7 | `BUS_HEALS` | resets of the host-bus peripheral after a transfer the bus cut (§6.4) | — |
| 8 | `VM_IO_ERRNO` | the positive errno of the latest I/O error the measure loop absorbed, 0 before the first. A NAK or a lost arbitration reads `EIO`, a bus that never went idle `EBUSY`, a transfer the peripheral never finished `ETIMEDOUT` | `aliensense.nxs.io_errno` |
| 9 | `BUS_HEAL_ERRNO` | the positive errno of the failed transfer that preceded the latest heal, 0 before the first, in the same vocabulary | — |

The two errno cells use the device's numbering, the one `CMD_ERROR` reports in. A host decodes them with the device's table, never with its own: `ETIMEDOUT` is 116 on the device.

`nxs status` prints the fault counters (§9).

Serial acknowledgements carry the same codes as signed 16-bit results (0 = success, negative = error).


