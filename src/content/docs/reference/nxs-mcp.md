---
title: "NXS — MCP Tool Reference"
sidebar:
  order: 7
---

Applies to: NXS SDK 1.1.x · `nxs mcp` · the `mcp` extra · Model Context Protocol (stdio)

| Document set | |
|---|---|
| [Glossary](../nxs-glossary/) | one word for each thing |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, shipped personalities, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Click Personality Reference](../nxs-click-personalities/) | authoring personalities for unsupported sensors |
| [Cam Personality Reference](../nxs-cam-personalities/) | describing camera chains for the camera ports |
| **MCP Tool Reference** (this document) | operating and configuring through an AI agent |

## 1. Overview

`nxs mcp` serves the `nxs` verbs to an AI agent as tools. The agent calls `on`, `capture`, `set`, `status`. Each tool runs the same command line an operator types. The agent gets the same words, the same refusals, the same laws.

The machine's declaration is `suite.yaml`. It has three doors:

| Door | Who | How values are chosen |
|---|---|---|
| The file | an engineer with an editor | typed, and the shipped JSON Schema flags shape errors in the editor |
| `nxs tune` | an operator at the terminal | picked from offered options only |
| `nxs mcp` | an agent | picked from offered options only (`suite_get`, `suite_set`) |

All three are judged by the same findings, the ones a bare `nxs status` prints under `declaration:`. `switch` converges the units to the file, and `nxsd` the ports. A value the hardware cannot do is refused on every door. The refusal names the lawful values. Nothing is clamped silently.

MCP operates the hardware as well as the declaration. `nxs tune` reaches the hardware too: `--play` signals `nxsd`, and `i` in the panel strobes a unit's LED. `on` writes registers, and power-dips a port's camera heads when a link does not lock.

The agent must read before it writes. `caps` says what a sensor offers. `status` without a port says whether the declaration is lawful and which declared nodes answer. `status` with a port says what the hardware is doing now.

The server runs on the machine that owns the buses. An agent elsewhere reaches it over ssh.

```d2 title="The agent loop: the agent on a workstation reaches nxs mcp over ssh, and its tools read the rig, operate the hardware and write the declaration under the laws"
# The agent loop of the MCP Tool Reference: the agent on a workstation, ssh,
# nxs mcp on the host that owns the buses, the tools by their hardware
# effect, the laws every write passes, and the rig they reach.

vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

direction: down

classes: {
  hw: {style: {fill: "#e3ecf7"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14}}
  open: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 2; font-size: 14}}
  data: {style: {fill: "#fff0c2"; stroke: "#b07a00"; stroke-width: 2; font-size: 14}}
  third: {style: {fill: "#ececec"; stroke: "#6b6b6b"; stroke-dash: 3; font-size: 14}}
  group: {style: {fill: "#fafafa"; stroke: "#999"; font-size: 18}}
}

workstation: "Workstation" {
  class: group
  agent: "The agent\nClaude Code or Claude Desktop\nreads before it writes" {class: third}
}

host: "Host that owns the buses" {
  class: group
  mcp: "nxs mcp\nthe nxs verbs as tools, over stdio" {class: open}
  read: "Read the rig\nprobe · status · caps · get\nsuite_get · suite_schema\nhost_info · host_modes" {class: open}
  operate: "Operate the hardware\nidentify · samples · on · off\ncapture · set · upload" {class: open}
  declare: "Write the declaration\ngenerate · suite_set · switch\nreload · freeze" {class: open}
  laws: "The laws\na refusal names the fact and the lawful values\nno register-level access · a live sibling is protected\na kernel-owned hub is read-only · a timeout per tool" {class: data}
  suite: "suite.yaml\nthe declaration" {class: data}
  nxsd: "nxsd\nbrings the declared ports up" {class: open}
  boot: "/boot\nthe boot table" {class: data}
}

rig: "Rig" {
  class: group
  hub: "NXS Hub\nlinks A and B" {class: hw}
  pods: "Pods\nheads and units" {class: hw}
  hub <-> pods: "coax"
}

workstation.agent -> host.mcp: "ssh"
host.mcp -> host.read
host.mcp -> host.operate
host.mcp -> host.declare
host.read -> rig.hub: "reads registers"
host.operate -> host.laws: "judged by"
host.laws -> rig.hub: "knobs and programs"
host.declare -> host.suite: "generate · suite_set · freeze"
host.declare -> host.nxsd: "reload"
host.declare -> host.boot: "switch"
host.declare -> rig.pods: "switch retunes the units"
host.suite -> host.nxsd: "read at boot"
host.nxsd -> rig.hub: "brings the ports up"
```

## 2. Installation

On the Jetson (or any host with the buses):

```sh
orin$ pipx inject aliensense-nxs 'aliensense-nxs[mcp]'
orin$ nxs mcp --doc-table
```

The second command prints the Tools table of §3 and exits. It proves the extra is installed. Without it, `nxs mcp` says so and exits.

Claude Code on a workstation, reaching the Jetson over ssh (key-based login, the Jetson user in the `i2c` and `video` groups). An ssh command runs no login profile, so name the user install's executable by its path, quoted so the Jetson expands `$HOME`, not the workstation:

```sh
host$ claude mcp add nxs -- ssh <user>@<jetson> '$HOME/.local/bin/nxs' mcp
```

Claude Desktop, in its MCP configuration file:

```json
{
  "mcpServers": {
    "nxs": {"command": "ssh", "args": ["<user>@<jetson>", "$HOME/.local/bin/nxs", "mcp"]}
  }
}
```

An agent on the Jetson itself uses `"command": "nxs", "args": ["mcp"]`.

Smoke test from the client: list the tools. 20 names appear, in the order of §3. Then call `status` with no port. Its `declaration` carries `in_tune: true` or the findings, and each declared node its presence. The buses are read and nothing is written.

## 3. Tools

| Tool | Purpose | Arguments | Hardware effect | Refuses when |
|---|---|---|---|---|
| `probe` | the units that answer, on every bus or a port's | port?, link? | none (reads identity registers) | no ACK rows, or an unknown port, which lists the ports |
| `generate` | the rig as it answers: ports, hubs, links, sensors, units | dry_run? | walks every camera port and bus. With dry_run false it writes hardware.yaml, the report of what answered, and seeds suite.yaml when there is none. A unit on a bare bus running nothing is named by trying every personality on it | no hub and no camera port, or the wiring file is not writable |
| `status` | the declaration against the rig, or a port's presence and health | port?, link? | none (reads identity and status registers) | hub does not answer |
| `identify` | strobe a unit's LED to find the box | unit? | the unit's LED strobes ~10 s | unit does not answer |
| `samples` | read decoded samples from a unit | unit?, count? | reads the sample window. Over Cyphal it sets the output decimation for the read and puts the previous value back | no personality measuring, or the unit does not answer |
| `caps` | what the sensor offers, with the laws | port, link? | none (reads facts) | no hub serves the port, or nothing installed describes its sensor |
| `on` | bring a link or the whole port up | port, link?, sensor?, mode?, fps?, dry_run? | writes the program, trains links, follows video lock, counts two seconds of frames on every camera link | the laws refuse the mode or rate, the hub does not answer, video did not lock, or the links do not deliver the rate |
| `off` | park the whole port | port | sensors to standby, CSI gate closed, viewers stopped, each pod's head parked | kernel-owned hub |
| `capture` | headless delivery proof | port, link, frames?, timeout_s? | opens a capture session on the up link, the tool's viewer on it stopped first | the link is not up, or the frames were not delivered |
| `get` | read a knob: the port's sync, the sensor's, the unit's | port, link, knob | none (reads sensor registers) | unknown knob lists the knobs |
| `set` | change a knob under the laws, sync being the port's frame sync | port, link?, knob, value, dry_run?, fps?, exposure_us? | writes sensor registers, or the link's unit for a knob that is its personality's parameter. Sync starts or stops the hub's generator, and a sync or fps change counts two seconds of frames | an unlawful value, with the lawful alternatives. A sync or rate the links do not deliver, the previous one restored. A live sibling link, for a camera knob. The port is not up |
| `suite_get` | the declaration as options | — | none | no camera port on the host and no declaration |
| `suite_schema` | the rig's rules as JSON Schema | — | none | the declaration does not parse |
| `suite_set` | set declared values from their options, one or a batch | channel?, field?, value?, section?, sets? | writes suite.yaml once (a timestamped backup, created when absent) | a value not among the options, a field that repeats without its section, or a knob a set moved that the batch does not name |
| `switch` | apply the saved declaration to the units | dry_run?, accept_new_serial? | retunes or re-uploads the personality on units whose entry differs | the declaration is out of tune, or a declared unit does not answer |
| `reload` | apply the saved declaration to the ports | — | nxsd reconverges changed ports | the declaration is out of tune, or nxsd is not running |
| `freeze` | adopt live tuning into the declaration: the units', or the camera ports' | unit?, ports?, port?, dry_run? | writes suite.yaml | unit unreachable, or a port no host bus answers to |
| `upload` | compile and upload a personality to a unit (or compile only) | name, port?, link?, unit?, params?, slot?, compile_only? | a click personality runs, and a cam personality lands in a store slot | an unknown name, a source that does not compile, a full store, or several units that answer with none named |
| `host_info` | the capture host and what it booted | — | none (reads the device tree and boot config) | never |
| `host_modes` | the booted capture table of a port | port | none (reads the device tree) | an unknown port, or a silent device tree |

Arguments marked `?` are optional. `fps` is the rate `set` runs the port's frame sync at (`knob: sync`, `value: fsync`). Without it the declared rate applies, else 30 fps. `exposure_us` is refused with the fact that sets the exposure. Under frame sync that is the trigger pulse's low time at the rate, in free run the capture stack's loop.

`port` is a port name (`cam1`). `link` is a link name (`A`, `B`). `knob` names come from `caps`. `channel`, `section`, and `field` come from `suite_get`.

`unit` is a declared unit name. When it is omitted, `identify` and `samples` address the one unit answering on the host's camera buses. So a unit can be found and read before it is declared.

Read tools return the same JSON the command line prints with `--json`: `probe`, `generate`, `status`, `samples`, `caps`, `suite_get`, `suite_set`, `reload`. Every such document carries `contract: 2`, and the SDK's tests validate every surface against the shipped `surface` schema. `suite_schema` returns the rig schema itself, a JSON Schema document with no `contract` member. Live tools return the verb's text.

A refused call is a tool error. Its text is the verb's refusal: the fact on one line, then one line per lawful alternative. A JSON tool's refusal is the document `{"refused": {"fact": …, "alternatives": […]}}`, so a program reads the alternatives without parsing a sentence. The agent asks for one of them.

A finding in a `status` document has the same parts. `where` is the declaration path it names, and `text` is the sentence the command line prints, beside `fact` and `alternatives`.

### 3.1 Schemas and refusals

Each format has one role. The declaration file is YAML, because a person edits it. Every tool result and every `--json` document is JSON. The contract between them is JSON Schema 2020-12. The shipped `suite` schema covers the file, the `surface` schema the results, and the rig schema that `suite_schema` returns covers one rig. A declaration rendered as JSON loads and validates identically, so an agent may write either.

The rig schema is the declaration schema narrowed by what is on this rig. Each port lists only the keys its nodes bring, and any other key is refused. Wiring values are constants, and a declaration may leave them out.

A link's `camera` is a sensor an installed cam personality describes, and its `mode` is one of the modes that sensor's program carries. Its `fps` is inside that mode's range on the port, a single value for a part whose mode runs at one rate. A unit's `config` admits the keys its personality takes. A violation names the key it broke and the values that key admits.

The schema is necessary and not sufficient. It judges names, values, and the combinations inside one link. `status` judges what spans nodes, such as two cameras on one port or the lanes against the hub's output.

Findings and refusals follow the shape of the Linux kernel's netlink extended ACK. That ACK carries the message, the offset of the invalid attribute, and the policy for a rejected attribute: here `fact`, `where`, and `alternatives`. `suite_schema` is the counterpart of netlink's policy dump, which gives the supported attributes with the ranges of values the kernel accepts ([netlink introduction](https://docs.kernel.org/userspace-api/netlink/intro.html)).

## 4. Workflows

### 4.1 Declare first

Edit the declaration, validate it, apply it.

1. Call `suite_get`: every channel, its fields, the values each may take.
2. Call `suite_set` with `channel: cam1/A`, `field: fps` and `value: 25`, one value from the offered list. A batch goes in `sets` (`cam1:HUB=maxim,max96792a`, `cam1/A:SENSOR=framos,imx900`), applied in order and saved once. It saves the declaration with a timestamped backup, and the result carries the findings.
3. Call `status` with no port. It answers `declaration.in_tune: true`, or findings that name the lawful alternatives, each under the node it concerns.
4. Call `switch`: it retunes or re-uploads every declared unit whose personality or settings differ from its entry. It leaves a matching unit alone. Call `reload`: `nxsd` reconverges only the ports whose declaration changed. It also reconverges the ports a by-hand `on` brought up away from theirs.

A stream on an untouched port keeps running. A changed rate, or a mode of another bit depth, moves the port's boot table. `switch` then installs the port's overlay and ends with `REBOOT NEEDED`, and the port runs the new declaration once the operator reboots. A frame-sync rate is counted on the running port first, and one the links do not deliver is refused before the table.

A field name that exists in two sections of a channel (two personalities on one unit carry `sample_rate`) is refused. Pass `section` with the section's label (`imu-a/iam20680`). A set that moves another knob (a mode whose rate the laws pull) is refused unless the batch names that knob after it.

A channel with `declared: false` is a port the platform names, or a unit that answered with no declaration entry yet. `presence` says whether a hub or a unit answers on it. Its `DECLARE` section carries the knobs that write the entry. A port carries `HUB`: an installed hub, or `connector` for a camera wired to the host's connector. Each of its links (the channel `cam1/A`) carries `SENSOR` and `POD`. A unit or a pod carries `PERSONALITY`.

`suite_set` on those knobs declares the node, and creates the declaration when absent. The link's camera knobs (`mode`, `fps`), the port's `SYNC` and `GAIN` knobs and a personality's parameters appear under their nodes on the next `suite_get`.

### 4.2 Tune live, then freeze

Change values on the hardware, verify, then write what works into the declaration.

1. Call `on` with `port: cam1`, `link: A`. The link comes up. The result reads `video locked`, and the delivery check that counted two seconds of its frames, `cam1: verified 30.0 fps (A 30.0)`.
2. Call `set` with `knob: exposure`, `value: 8ms`, applied under the sensor's laws.
3. Call `capture` with `frames: 1700`: sixty seconds of frames must arrive. `on` counted two seconds of frames, and this count proves the stream holds for a minute. A locked link proves nothing.
4. Call `freeze`: the units' live parameters become the declaration. It leaves a camera's exposure alone. In free run the capture stack's loop sets it, and a declaration fixes it only as `camera.exposure_us` together with `camera.gain_db`.

### 4.3 Verify a capture

`capture` opens a headless Argus session with the CSI-gate choreography the viewers use. Four frames prove the path. 1700 frames (~60 s) is the steadiness oracle. The result names delivered frames against requested ones.

`on`, `set sync` and `set fps` count two seconds of frames on the links they change. `status` with the port carries the last count that passed as `verified`. On a frame-synced pair `ae` names who decides the gain. When `nxsd` copies no gain for a followed pair (`ae.mode: follow`, `ae.following: false`), `status` fails. The tool error carries the document, and `sudo systemctl restart nxsd` brings the follower back.

### 4.4 Recover a link

After a pulled cable or a head holding stale state the video does not lock. `on` recovers once by itself: it power-dips the heads on that port, resets and retrains them, then follows video lock again. A running stream on the sibling link stops. When `on` still ends with `video did not lock`, check the cabling and call `on` again.

### 4.5 A new sensor

1. Call `host_modes` with `port: cam1`: the booted capture table. The capture stack cannot capture a sensor mode missing here yet.
2. Call `switch` to realize the declaration. When the booted table lacks a declared mode, it generates the port's overlay. The sources are the hub directory and the installed cam personalities, and the overlay goes under the `aliensense_gen` boot label. The result ends with `REBOOT NEEDED`, and nothing reboots. The operator reboots.
3. Call `on` with `port: cam1`, `link: A`, `sensor: imx335`: the link with that sensor. The port remembers the sensor, and later calls omit it. `on` stops with `REBOOT NEEDED` when the booted table lacks the mode and has installed the overlays itself.
4. Call `capture` with `port: cam1`, `link: A`, `frames: 60` to prove delivery at the declared rate through the capture stack. `status` is the verdict, declared against actual.

### 4.6 Validate a declaration before writing it

A whole declaration, written by an agent or pushed from a fleet server, is checked against the rig's own rules before it reaches the file.

1. Call `suite_schema`: the rig's rules as JSON Schema (§3.1).
2. Check the declaration against it locally, with any JSON Schema 2020-12 validator. A violation names the key and the values it admits. Take one of them.
3. Call `suite_set` with the knobs in `sets`, saved once, or write the file for a whole declaration.
4. Call `status` with no port: the findings the schema cannot see, each with `where`, `fact`, and `alternatives`. `declaration.in_tune: true` is the pass.
5. Call `switch` for the units, `reload` for the ports.

The schema stops a wrong name or an out-of-range value before anything is written. It approves no arithmetic across nodes, so step 4 is never skipped.

### 4.7 Discover the rig

1. Call `generate` with `dry_run: true`, the default. It lists every camera port with the nodes that answered on it (the hub, each link's serializer, sensor, and unit). After the ports come the units on the bare buses. It writes nothing.
2. Read `unanswered`. A port carries it when the wiring or the platform names a hub and nothing answers at its address. That hub stays out of `hardware.yaml`. With its power and cabling checked, call `generate` again.
3. Call `generate` with `dry_run: false`. It writes `hardware.yaml` from the walk, a report that no verb reads, and seeds `suite.yaml` when there is none. It names a unit on a bare bus running nothing by trying every personality on it. `hardware`, `seeded`, and `kept` in the result say what it wrote.
4. Call `status` with no port: the declaration against what answered.

A declared hub that does not answer is a finding in step 4: `cam1: the hub does not answer at 0x6a`, with the power and cabling check as the alternative. A declared camera no installed cam personality describes is a finding that names the installed sensors.

## 5. Safety and limits

- **Refusals are results.** `on` with `fps: 500` answers `link A: 500 fps is outside 1920x1080 RAW10's 1.50–160.49 fps (the datasheet frame law's range with 1 camera on 2 CSI lanes)` and names the whole rates at the ends, `fps 160` and `fps 2`, as its alternatives. The agent asks for a rate inside the range. Retrying 500 gets the same answer. A rate inside the range that the rig does not deliver is refused the same way, after `on` or `set` counts two seconds of frames. The answer is `cam0: 60 fps asked, 58.1 delivered on A, 57.9 on B`, naming the whole rate at or under the lowest.
- **Register-level access does not exist.** No tool writes a named register. Every write goes through a declared knob or a captured program.
- **Live siblings are protected.** `set` on one link refuses while the other link streams, because isolating a link's control window would drop the sibling's video. Park first (`off`), or set before `on`. A unit's parameter (a Click's rate) is no camera knob: `set` writes it to the link's unit and parks nothing.
- **`on`'s recovery is destructive on purpose.** When video does not lock it power-dips every head on the port. Nothing else does.
- **A kernel-owned hub is read-only.** With `hub: {driver: kernel}` in the declaration, `on`, `off` and `set` refuse. `status` still answers from directly readable registers.
- **A hub change keeps the link sensors.** Every hub offers every installed cam personality, so a port whose hub changes keeps its link sensors. A sensor no installed cam personality describes is not among the options. A sensor set on a port with no hub is refused with `set cam1:HUB first, in the same --set batch or before`. `sets` carries both in one call, the hub first: `cam1:HUB=…`, then `cam1/A:SENSOR=…`.
- **The declaration is optional.** Ports resolve from the platform (udev aliases, the mux channel ids). `reload` and `freeze` need a declaration, and `switch` without one runs the host's steps alone. On a host that boots no camera bus it installs the boot table that starts them and ends `REBOOT NEEDED`, else it names `nxs generate`. `suite_get` lists the platform's ports and what answered without one, `suite_set` declares into one, and the live tools never read it.
- **`switch` writes `/boot`.** On a host that boots no camera bus it writes the camera kernel package's multiplexer overlay into one boot label (`aliensense_gen`). When the booted table lacks a declared mode, or its rows miss the declared rate and bit depth, the generated overlay goes in too. It copies that overlay into `/boot/camera-dtbos`, adds it to the same label and backs up `extlinux.conf`. The operator's own labels are untouched, and nothing reboots.
- **Time.** `on` takes seconds to a minute (training). `capture` with 1700 frames takes about a minute. `on` with a recovery takes up to several minutes. The server applies a timeout per tool and reports it as a refusal.

## 6. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `nxs mcp needs: pipx inject aliensense-nxs 'aliensense-nxs[mcp]'` | the `mcp` package is not installed | run the line the message names. In an environment pip made, it names `pip install 'aliensense-nxs[mcp]'` |
| `on` answers `REBOOT NEEDED` | the booted capture table lacks the sensor mode, and `switch` regenerated and installed the overlay | reboot the Jetson, then call `on` again |
| `on` answers `<port>/<link>: … boots on no row of this port's table (…)` | the mode is of another pixel format than the port's declaration runs, so its table carries no row for it | declare the mode on every link (`links.<link>.camera.mode`) and call `switch`, or call `on` with a mode the answer names |
| `on` answers `MISMATCH: declared …, answers as …` | another sensor sits behind the link | call `on` with the detected `sensor`, or fix the declaration |
| the client lists no tools, or `Connection closed` at initialize | the server did not start: ssh asked for a password, or the client launched ssh with a minimal environment that hides the key agent (`SSH_AUTH_SOCK`) | run the ssh command by hand. Use the dedicated key the deploy guide restricts to the server, named by `IdentityFile` in `~/.ssh/config`, or hand the agent through in the client's `env`. Claude Desktop passes no agent socket |
| `hub … does not answer` | deserializer unpowered, wrong bus, wrong module SKU in the boot config | `probe` without a port, and DEPLOY.md §2 of the camera kernel package |
| `capture` fails, `Failed to create CaptureSession` | `nvargus-daemon` wedged by an earlier raw session | `sudo systemctl restart nvargus-daemon`, and `capture` restarts it once by itself |
| `video did not lock` after `on` | a head holding stale state | `on` recovers once by itself. Check the cabling, then `on` again (§4.4) |
| `suite_set` refuses `ambiguous` | two sections of the channel carry the field | pass `section` |
| `suite_set` refuses `… — name the knob in the same --set batch` | a set moved a dependent knob (a mode change pulled the rate) | add the moved knob to `sets` after the set that moved it |
| `reload` answers `played: false` | `nxsd` is not running, or the declaration is out of tune | `status` with no port, and start `nxsd` |
| `nxs cam1 A stream` shows nothing for the agent | viewers need a display | agents use `capture`, and viewers are for a person at the screen |
