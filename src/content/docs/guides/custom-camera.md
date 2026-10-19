---
title: "Custom cam personality"
sidebar:
  order: 6
---

An image sensor that nxs has never seen needs a cam personality. A cam personality is a YAML facts file, a small Python class and the vendor's register tables beside them. The facts file digitizes the sensor's datasheet, and the class programs the sensor. You write the personality with an AI coding agent from the datasheet and the vendor's setting file. Then you check and compile it on your workstation and install it on your Jetson. At the end your sensor streams on your Jetson at a rate nxs has verified, and the `nxsd` daemon brings it up at every boot.

```d2 title="Custom cam personality at a glance"
vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 0
  }
}

grid-columns: 3
grid-gap: 40

classes: {
  hw: {style: {fill: "#e3ecf7"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14}}
  open: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 2; font-size: 14}}
  data: {style: {fill: "#fff0c2"; stroke: "#b07a00"; stroke-width: 2; font-size: 14}}
  third: {style: {fill: "#ececec"; stroke: "#6b6b6b"; stroke-dash: 3; font-size: 14}}
  step: {style: {fill: "#ffffff"; stroke: "#3b5f8a"; stroke-width: 2; font-size: 14; border-radius: 6}}
  result: {style: {fill: "#d9efd9"; stroke: "#2f7d3a"; stroke-width: 3; font-size: 15; bold: true}}
  group: {style: {fill: "#fafafa"; stroke: "#999"; font-size: 18}}
}

connect: "What you connect" {
  class: group
  direction: down
  files: "Datasheet and\nthe vendor's setting file" {class: data}
  workstation: "Workstation\nClaude Code, git, Python 3.10+" {class: hw}
  jetson: "Jetson\nnxs installed" {class: hw}
  hub: "NXS Hub\nlinks A and B, on CAM0" {class: hw}
  pod: "Camera pod\nyour sensor head on an NXS unit" {class: hw}
  files -> workstation: "read by the skill"
  workstation -> jetson: "scp"
  jetson <-> hub: "camera connector"
  hub <-> pod: "coax, link A"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Install the skill\ngit clone, then /nxs-generate-cam-personality" {class: step}
  s2: "2. Check and compile\nnxs personality check, nxs upload -o" {class: step}
  s3: "3. Install the personality\nscp, then nxs personality install" {class: step}
  s4: "4. Bring the sensor up\nnxs cam0 A on --sensor cam1, capture --frames 60" {class: step}
  s5: "5. Declare the camera\nnxs tune --set, nxs switch, reboot" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5
}

have: "What you have" {
  class: group
  direction: down
  stream: "Your sensor streams on the Jetson\nat a rate nxs verified" {class: result}
  boot: "nxsd brings it up at every boot\nthe declaration is the record" {class: result}
}
```

## What you need

- **Hardware**: your Jetson and the NXS Hub, set up as in [Getting started with the NXS unit](../unboxing/). The Hub is the GMSL deserializer board on your Jetson's camera connector. It carries two coax links, A and B. nxs calls that connector a port, here `cam0`.
- **Camera pod**: your sensor on a camera pod, connected to link A in place of the sensor unit. A camera pod is an NXS unit with the camera head it carries and its serializer. The NXS unit is a small sensor computer, and it runs the personality's Python class to program the sensor.
- **Declaration**: the pod declared as the unit `unit-cam0-a` in `suite.yaml`, with no camera node on it yet. `suite.yaml` is your declaration, the file that names each part of your rig as a node. It names the personality each unit runs and the settings it runs with.
- **Sensor files**: the sensor's datasheet and the vendor's setting file. The setting file is the register sequence that programs each mode. It comes as a kernel driver's mode tables or as an application note's setting list.
- **Workstation**: a computer with Claude Code, git, and Python 3.10 or newer.
- **Time**: about an hour, plus the reboot.

:::note[A camera on the connector]
Your sensor can also sit on your Jetson's camera connector with nothing between them. Then the declaration names no Hub and no pod, as step 5 shows, and `nxs cam0 A on --sensor cam1` runs the personality on your Jetson itself. The install in step 3 is the same, since every port offers an installed cam personality. Begin `probe()` with the part's software reset where it has one, and declare the embedded-data lines it emits in the capture rows ([Cam Personality Reference](../../reference/nxs-cam-personalities/)).
:::

Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson.

## 1. Install the skill

The `nxs-generate-cam-personality` skill for Claude Code reads a datasheet and a setting file. It picks the law family that nxs serves the sensor with, and writes the personality. Install it once on your workstation, with nxs beside it so the skill can compile what it writes:

```sh
host$ git clone --depth 1 https://github.com/aliensense/nxs
host$ mkdir -p ~/.claude/skills && cp -r nxs/skills/nxs-generate-cam-personality ~/.claude/skills/
host$ python3 -m venv ~/nxs-venv
host$ source ~/nxs-venv/bin/activate
host$ python3 -m pip install aliensense-nxs
host$ claude
```

:::note
pip takes the wheel that fits the workstation: the platform wheel on Linux, and the pure wheel on a Mac. The pure wheel, `aliensense_nxs-X.Y.Z-py3-none-any.whl`, carries the compiler and the checks the skill runs. pip installs the latest release. If your Jetson runs another, install the version that `nxs --version` prints there, `aliensense-nxs==X.Y.Z`. Start `claude` from the shell where the virtual environment is active.
:::

In the Claude Code session, point the skill at the datasheet and the setting file, and give the personality a name:

```
/nxs-generate-cam-personality ./cam1-datasheet.pdf ./cam1_settings_v3.txt — name it cam1
```

The skill extracts the address, the register widths, the identity register, and the modes with their geometry, lanes and rates. It also extracts the stream gate, the register that starts and stops the stream. It splits the setting file into a shared table and one table per mode, and writes `cam1.yaml` and `cam1.py`. Then it compiles the personality and prints its report card:

```
nxs personality: cam1 — cam

  files     ./cam1/cam1.py · ./cam1/cam1.yaml
  tables    ./cam1/cam1_init.yaml · ./cam1/cam1_mode_full.yaml · ./cam1/cam1_mode_bin.yaml
  family    generic
  address   0x36 · registers 16-bit · values 8-bit
  modes     mode_full 1920x1080 RAW10 2-lane 30 fps · mode_bin 960x540 RAW10 2-lane 60 fps
  trigger   freerun
  budget    109 B bytecode of 4096 · trailer 458 B of 4096

  nxs personality check ./cam1
  nxs upload ./cam1/cam1.py -o cam1.nxs
  nxs personality install ./cam1
  nxs cam0 A on --sensor cam1
  nxs cam0 status
  nxs cam0 A capture --frames 60
```

The card lists the files, the sensor's facts and the budget, and ends with the commands you run next. The `family` line names the law family, the set of laws nxs uses for the sensor. `generic` is for a part whose runtime controls are direct register writes and whose modes run at the rate their tables set. `sony_imx` is for a part with that family's register vocabulary. Such a part gets the timing law, the exposure and gain conversions, and the trigger.

The skill never invents a register value. Without a setting file, it stops and says so.

:::note[Three files, one fact each]
The YAML is the facts: the address, the registers, the modes and the controls. It also holds the capture facts your Jetson's device tree needs. The Python is the behaviour: the identity check and the tables, in order. The tables are the vendor's rows, verbatim. The laws belong to nxs, so the personality carries no arithmetic that a datasheet did not state.
:::

## 2. Check and compile

Before you install the personality, check it and compile it on your workstation. `nxs personality check` reads the personality the way nxs will and names anything wrong with its shape, including a mode whose table is missing. `nxs upload -o` compiles it without a device and prints the budget:

```sh
host$ nxs personality check ./cam1
host$ nxs upload ./cam1/cam1.py -o cam1.nxs
```

```
personality cam1: cam · acme,cam1 · 2 mode(s)
  ok — bench proof: nxs <port> <link> on --sensor cam1, then capture --frames 60
Compiled Cam1: 109B bytecode, 2 params → 671B cam image
  probe                                       16 B
  configure (shared)                          30 B
  action in [0] block                         14 B
  mode dispatch                               16 B
  mode=0 block                                12 B
  mode=1 block                                12 B
  action in [1] block                          4 B
  action in [2] block                          4 B
  action in [3, 4, 5] block                    0 B
  halt                                         1 B
  bytecode                                   109 B of 4096 (2%)
  params                                       2 of 16
  descriptor trailer                         458 B of 4096
Wrote cam1.nxs: 671B image
```

The first two lines are the check: a cam personality for `acme,cam1` with two modes, and nothing wrong with its shape. The rest is the compile, with the bytes each block of the program costs. The compiler adds the `action` parameter from the stream gate, and its blocks configure, park and start the sensor. The budget is the unit's: the program must stay under 4096 bytes and the descriptor trailer under 4096 bytes. If a personality goes over either cap, the compile stops with `CompileError` and names the cap. Remove a whole mode from the personality, never a row of a table, and compile again.

## 3. Install the personality

Copy the directory to your Jetson and install it. The personality store is root-owned, so the install asks for your password:

```sh
host$ scp -r cam1 <user>@<jetson>:
orin$ nxs personality install ./cam1
```

```
installed cam1 (cam) into /opt/aliensense/personalities/cam1; next: nxs <port> <link> on --sensor cam1
```

The personality sits in the store at `/opt/aliensense/personalities/cam1`, and every port offers it. So `nxs cam0 caps` lists its modes, and your declaration may name `acme,cam1` as a sensor. `nxs describe acme,cam1` prints the parameters a camera node of that type takes, its modes by name among them.

## 4. Bring the sensor up

Bring the link up on the new personality, on link A of port `cam0`:

```sh
orin$ nxs cam0 A on --sensor cam1
```

```
link A: the pod runs cam1, mode mode_full, trigger freerun
the port is cold: constructing it
pod A: cam1 uploaded to slot 1
pod A: configure (cam1)
pod A: start (cam1)
link A: acme,cam1 1920x1080 RAW10 @ 30 fps
up A: ok
video locked
cam0: verified 30.0 fps (A 30.0)
next: nxs cam0 A stream
```

`on` compiles the personality, uploads it into the pod's store, and hands the pod the bus so the pod programs the sensor. The personality's start then writes the stream gate the YAML names. The pod held nothing, so `on` uploaded cam1 into slot 1, and the unit ran its configure and its start in `mode_full`. Then `on` counted two seconds of frames and verified that link A delivers 30.0 fps. A rate the link does not deliver is refused with the rate it delivered. Next, check the port and count 60 frames:

```sh
orin$ nxs cam0 status
orin$ nxs cam0 A capture --frames 60
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: acme,cam1 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-a (cam1, head ok)
cam0 on /dev/i2c-cam0, sync free_run
cam0: verified 30.0 fps 20 s ago (A 30.0)
…
cam0/A: 60/60 at 30.0 fps
```

`status` shows `acme,cam1` at 1920x1080 RAW10 and 30.0 fps on the pod, with its head answering. The capture got 60 of 60 frames at 30.0 fps. Run `nxs cam0 stream` to open a viewer on the picture.

If you see a colour cast in the picture, the `pixel_phase` was transcribed wrong. Check it in the YAML.

If the stream never locks, the lane count or the link rate does not match the mode's table. Check the mode's lanes and rate in the YAML against its table.

:::note[The capture stack's table]
A sensor your Jetson has never booted with needs a boot table with its modes. The first time, `on` installs the table and stops with `REBOOT NEEDED`. After the reboot, the same command brings the link up.
:::

## 5. Declare the camera

Give link A its camera in your declaration with `nxs tune`, the sensor and its mode in one batch:

```sh
orin$ nxs tune --set cam0/A:CAM=acme,cam1 --set cam0/A:mode=mode_full
```

```
set cam0/A:DECLARE:CAM = acme,cam1
set cam0/A:camera:mode = mode_full
saved (backup suite.yaml.bak-20261007-101500)
IN TUNE ✓
```

`nxs tune` offers `acme,cam1` because the personality is installed, and `mode_full` because the personality names that mode. It saved `suite.yaml` and kept the previous file beside it, and `IN TUNE` means the file holds on your rig. The file gains a camera node on link A, wired into the pod's head:

```yaml
nodes:
  camera-cam0-a:
    type: acme,cam1
    parameters:
      mode: mode_full
connections:
  camera-cam0-a.out:
    - unit-cam0-a.head
```

For a camera on the connector, the port has no Hub and link A has no pod. Declare it in one batch, with the port's knob first:

1. Set the port's hub knob with `cam0:HUB=connector`.
2. Set link A's sensor with `cam0/A:CAM=acme,cam1` in the same batch.

```sh
orin$ nxs tune --set cam0:HUB=connector --set cam0/A:CAM=acme,cam1
```

The saved file has no Hub node and no pod. The camera node feeds your Jetson's port directly, as `camera-cam0-a.out: [host.cam0]`. A sensor set without the hub knob is refused with `set cam0:HUB first`.

Apply the declaration:

```sh
orin$ nxs switch
```

```
cam0: boot table installed
cam0: installed /boot/camera-dtbos/tegra234-p3767-camera-p3768-aliensense_universal-cam0-2lane-overlay.dtbo
cam0: FDT /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb named in aliensense_gen: the boot entry it copies names /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb
cam0: boot label aliensense_gen (DEFAULT) written; reboot to apply: sudo reboot; original extlinux.conf at /boot/extlinux/extlinux.conf.bak-nxs
REBOOT NEEDED
```

The pod already holds cam1, so `switch` prints no line for it. `switch` installed the port's boot table, and your Jetson must reboot before the port comes up:

```sh
orin$ sudo reboot
```

After the reboot, `nxsd` brings the port up on its own, and the declaration is the record from now on. Check the port and count frames:

```sh
orin$ nxs cam0 status
orin$ nxs cam0 A capture --frames 60
```

```
cam0: hub maxim,max96792a ok, capture stack ready
cam0/A: acme,cam1 1920x1080 RAW10 30.0 fps, up, pod unit-cam0-a (cam1, head ok)
cam0 on /dev/i2c-cam0, sync free_run
cam0: verified 30.0 fps 20 s ago (A 30.0)
…
cam0/A: 60/60 at 30.0 fps
```

Your sensor is now one of the sensors nxs serves. If you replace the pod, `switch` brings the new pod to the declaration. `status` judges the sensor, and `nxsd` runs it at boot and publishes its frames on ROS 2 like any other camera's.

## Next steps

- Do the same steps from a chat: [Custom cam personality with an AI agent](../custom-camera-mcp/).
- Look up the facts file's keys, the law families and the validation gates in the [Cam Personality Reference](../../reference/nxs-cam-personalities/).
- Look up the verbs of the Python class in the [Click Personality Reference §4.14](../../reference/nxs-click-personalities/).
