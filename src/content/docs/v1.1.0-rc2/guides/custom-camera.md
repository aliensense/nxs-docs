---
title: Custom camera personality
sidebar:
  order: 6
slug: v1.1.0-rc2/guides/custom-camera
---

An image sensor that nxs has never seen needs a camera personality: a YAML descriptor that digitizes the sensor's datasheet, a small Python class that programs the sensor, and the vendor's register tables beside them. You write one with an AI coding agent from your sensor's datasheet and the vendor's setting file, then check and compile it on your workstation and install it on your Jetson. At the end your sensor streams on your Jetson at a rate nxs has verified, and the `nxsd` daemon brings it up at every boot.

## What you need

* **Hardware**: your Jetson and the NXS Hub, set up as in [Getting started with the NXS unit](../unboxing/). The Hub is the GMSL deserializer board on your Jetson's camera connector, and it carries two coax links, A and B. nxs calls that connector a port, here `cam0`.
* **Camera pod**: your sensor on a camera pod, connected to link A in place of the sensor unit. A camera pod is a sensor head on an NXS unit with its serializer. The NXS unit is a small sensor computer, and it runs the personality's Python class to program the sensor.
* **Declaration**: the pod declared as the unit `unit-cam0-a` in `suite.yaml`, with no `camera:` key yet. `suite.yaml` is your declaration, the file that names each unit on your rig, the personality it runs and the settings it runs with.
* **Sensor files**: the sensor's datasheet and the vendor's setting file. The setting file is the register sequence that programs each mode, as a driver's mode tables or an application note's setting list.
* **Workstation**: a computer with Claude Code, git, and Python 3.10 or newer.
* **Time**: about an hour, plus the reboot.

Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson.

## 1. Install the skill

The `nxs-generate-camera-personality` skill for Claude Code reads a datasheet and a setting file, picks the law family that nxs serves the sensor with, and writes the personality. Install it once on your workstation, with nxs beside it so the skill can compile what it writes:

```sh
host$ git clone --depth 1 https://github.com/aliensense/nxs
host$ mkdir -p ~/.claude/skills && cp -r nxs/skills/nxs-generate-camera-personality ~/.claude/skills/
host$ python3 -m venv ~/nxs-venv
host$ source ~/nxs-venv/bin/activate
host$ python3 -m pip install aliensense-nxs==1.1.0
host$ claude
```

:::note
pip takes the wheel that fits the workstation: the platform wheel on Linux, and on a Mac the pure wheel, `aliensense_nxs-1.1.0-py3-none-any.whl`, which carries the compiler and the checks the skill runs. Install the version that `nxs --version` prints on your Jetson, and start `claude` from the shell where the virtual environment is active.
:::

In the Claude Code session, point the skill at the datasheet and the setting file, and give the personality a name:

```
/nxs-generate-camera-personality ./cam1-datasheet.pdf ./cam1_settings_v3.txt — name it cam1
```

The skill extracts the address, the register widths, the identity register, the modes with their geometry, lanes and rates, and the stream gate, the register that starts and stops the stream. It splits the setting file into a shared table and one table per mode, writes the pair, `cam1.yaml` and `cam1.py`, then compiles the pair and prints its report card:

```
nxs personality: cam1 — camera

  files     ./cam1/cam1.py · ./cam1/cam1.yaml
  tables    ./cam1/cam1_init.yaml · ./cam1/cam1_mode_full.yaml · ./cam1/cam1_mode_bin.yaml
  family    generic
  address   0x36 · registers 16-bit · values 8-bit
  modes     mode_full 1920x1080 RAW10 2-lane 30 fps · mode_bin 960x540 RAW10 2-lane 60 fps
  trigger   freerun
  budget    100 B bytecode of 4096 · trailer 374 B of 2048

  nxs personality check ./cam1
  nxs upload ./cam1/cam1.py -o cam1.nxs
  nxs personality install ./cam1
  nxs cam0 A on --sensor cam1
  nxs cam0 status
  nxs cam0 A capture --frames 60
```

The card lists the files, the sensor's facts and the budget, and ends with the commands you run next. The `family` line names the law family, the set of laws nxs uses for the sensor. `generic` is for a part whose runtime controls are direct register writes and whose modes run at the rate their tables set. `sony_imx` is for a part with that family's register vocabulary, and such a part gets the timing law, the exposure and gain conversions, and the trigger. The skill never invents a register value. Without a setting file, it stops and says so.

:::note[Three files, one fact each]
The YAML is the facts: the address, the registers, the modes, the controls, and the capture facts your Jetson's device tree needs. The Python is the behaviour: the identity check and the tables, in order. The tables are the vendor's rows, verbatim. The laws belong to nxs, so the pair carries no arithmetic that a datasheet did not state.
:::

## 2. Check and compile

Before you install the pair, check it and compile it on your workstation. `nxs personality check` reads the pair the way nxs will and names anything wrong with its shape, including a mode whose table is missing. `nxs upload -o` compiles the pair without a device and prints the budget:

```sh
host$ nxs personality check ./cam1
host$ nxs upload ./cam1/cam1.py -o cam1.nxs
```

```
personality cam1: camera · acme,cam1 · 2 mode(s)
  ok — bench proof: nxs <port> <link> on --sensor cam1, then capture --frames 60
Compiled Cam1: 100B bytecode, 1 params → 534B camera image
  probe                                       16 B
  configure (shared)                          18 B
  mode dispatch                               33 B
  mode=0 block                                16 B
  mode=1 block                                16 B
  halt                                         1 B
  bytecode                                   100 B of 4096 (2%)
  params                                       1 of 8
  descriptor trailer                         374 B of 2048
Wrote cam1.nxs: 534B image
```

The first two lines are the check: a camera personality for `acme,cam1` with two modes, and nothing wrong with its shape. The rest is the compile, with the bytes each block of the program costs. The budget is the unit's: the program must stay under 4096 bytes and the descriptor trailer under 2048 bytes. If a pair goes over either cap, the compile stops with `CompileError` and names the cap; remove a whole mode from the personality, never a row of a table, and compile again.

## 3. Install the personality

Copy the directory to your Jetson and install it. The personality store is root-owned, so the install asks for your password:

```sh
host$ scp -r cam1 <user>@<jetson>:
orin$ nxs personality install ./cam1
```

```
installed cam1 (camera) into /opt/aliensense/personalities/cam1; next: nxs <port> <link> on --sensor cam1
```

The personality now sits in the store at `/opt/aliensense/personalities/cam1`. It joins the nxs descriptor pack as an extension, so `nxs cam0 caps` lists its modes and your declaration may name `acme,cam1` as a sensor.

## 4. Bring the sensor up

Bring the link up on the new personality, on link A of port `cam0`:

```sh
orin$ nxs cam0 A on --sensor cam1
```

```
cam0/A: pod unit-cam0-a holds nothing, uploading cam1 ... ok
link A: unit runs Cam1 (slot 1) configure, mode mode_full
up A: ok
video locked
cam0: verified 30.0 fps (A 30.0)
next: nxs cam0 A stream
```

`on` compiles the pair, uploads it into the pod's store, hands the pod the bus so the pod programs the sensor, and starts the stream with the stream gate the YAML names. The pod held nothing, so `on` uploaded cam1 and the unit ran it from slot 1 in `mode_full`. Then `on` counted two seconds of frames and verified that link A delivers 30.0 fps. A rate the link does not deliver is refused with the rate it delivered. Next, check the port and count 60 frames:

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

`status` shows `acme,cam1` at 1920x1080 RAW10 and 30.0 fps on the pod, with its head answering, and the capture got 60 of 60 frames at 30.0 fps. Run `nxs cam0 stream` to open a viewer on the picture.

If you see a colour cast in the picture, the `pixel_phase` was transcribed wrong. Check it in the YAML.

If the stream never locks, the lane count or the link rate does not match the mode's table. Check the mode's lanes and rate in the YAML against its table.

:::note[The capture stack's table]
A sensor your Jetson has never booted with needs a boot table with its modes. The first time, `on` installs the table and stops with `REBOOT NEEDED`. After the reboot, the same command brings the link up.
:::

## 5. Declare the camera

Give link A its camera in your `suite.yaml`, then apply the file:

```yaml
ports:
  cam0:
    hub: maxim,max96792a
    links:
      A:
        camera: {sensor: 'acme,cam1', mode: mode_full}
        unit: {name: unit-cam0-a, alias: 0x31}
```

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

Your sensor is now one of the sensors nxs serves. If you replace the pod, `switch` brings the new pod to the declaration. `status` judges the sensor, `nxsd` runs it at boot, and the ROS 2 launch publishes its frames like any other camera's.

## Next steps

* Do the same steps from a chat: [Custom camera personality with an AI agent](../custom-camera-mcp/).
* Look up the descriptor keys, the law families and the validation gates in the [Camera Personality Reference](../../reference/nxs-camera-personalities/), and the verbs of the Python class in the [Personality Authoring Reference §4.14](../../reference/nxs-personality-authoring/).
