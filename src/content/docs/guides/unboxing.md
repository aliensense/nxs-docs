---
title: "Getting started with the NXS unit"
sidebar:
  order: 3
---

An NXS unit is a small sensor computer that runs its sensor's driver, so your host gets samples in SI units and needs no code for the sensor. You connect the unit from the box, with its FXOS8700 Click, to your host and see the first samples on your screen in two minutes. At the end, your host restores the setup at every boot, and you can reach the unit by name.

## What you need

- **Host**: set up as in the [NVIDIA Jetson deployment guide](../deploy-jetson/), with `nxs` installed, the assets in place and the camera buses up with their port names. The assets are the camera and Hub programs that ship as one download, versioned with `nxs`.
- **NXS box**: the unit, a mikroBUS Shuttle with an FXOS8700 Click (an accelerometer and magnetometer) and a coax cable.
- **NXS Hub**: in its own box, with its power lead.
- **Time**: two minutes to the first samples, twenty minutes in all.

:::note[Ports and links]
The Hub is the GMSL deserializer board. It plugs into one of your host's camera connectors and carries two coax links, A and B. `nxs` calls that connector a port, `cam0` or `cam1`, and addresses hardware as `nxs <port> <link> <verb>`. You connect the Hub to CAM0, so your port is `cam0`. If your Hub is on CAM1, read `cam1` wherever you see `cam0`. Nothing else changes.
:::

## 1. Connect the hardware

Put the Click on the unit, then connect the unit to your host through the Hub:

1. Seat the Click on the Shuttle, then the Shuttle on the unit's mikroBUS socket. Push until both sit flat.
2. Run the coax from the unit to link A of the Hub.
3. Plug the Hub into CAM0 and connect its power lead. The unit draws its power over the coax.

The unit has one green LED, and it tells you what the unit is doing before your host can. While the unit boots, the LED flashes once a second. Within a few seconds the flash turns into a heartbeat, a short pulse followed by a longer one. A personality is the compiled driver that the unit runs for its sensor. The heartbeat means the personality in slot 0 found the Click and is measuring.

:::tip[Reading the LED]
If you see a fast blink, about five times a second, the personality loaded but the sensor did not answer. Almost always the Click is not fully seated. Push it down and the unit recovers by itself. If you see a slow single flash that never turns into the heartbeat, no personality is loaded. Upload the shipped one with `nxs upload fxos8700`, and `nxs store save 0` keeps it. The heartbeat counts the jobs the unit runs, so a unit that also runs a camera shows two heartbeats back to back.
:::

## 2. Find the unit

Check that your host sees the Hub and the unit. `nxs probe` sweeps every camera bus and prints what answers:

```sh
nxs probe
```

```
/dev/i2c-cam0:
  NXS Hub @0x6A (hub maxim,max96792a)
  NXS unit @0x30 serial 2f004b0032510f0011223344
no suite.yaml yet — write down what answered: nxs generate
```

Two devices answered on the `cam0` bus: the Hub at address 0x6A and your unit at 0x30 behind link A, with its serial number. Make sure that you and `nxs` are looking at the same box:

```sh
nxs cam0 A identify
```

```
Identify: status LED strobing on i2c /dev/i2c-cam0@0x30 (~10 s)
```

The unit's LED strobes fast for ten seconds and then returns to its heartbeat. With several units on a bench, this is how you tell them apart.

:::note[Nothing answered?]
If you see `no hubs, units, or sensors answered`, check the Hub's power lead and the coax at both ends. Also check that the LED on the unit is flashing. If you see `no camera bus is booted`, your Jetson has not rebooted since the deployment guide's `nxs switch`: run `nxs switch`, and reboot when it prints `REBOOT NEEDED`.
:::

## 3. Read the sensor

Your unit keeps its personalities in a store with eight slots and boots whatever is in slot 0. It shipped with the FXOS8700 personality there:

```sh
nxs store ls
```

```
Personality store: 1/8 populated
  [0] Fxos8700  (driver, 7 outputs, 4 params) ← active
```

The personality has seven outputs and four parameters. The outputs are three accelerometer axes, three magnetometer axes and a temperature. Two parameters tune the sensor, a sample rate and an accelerometer range. The other two say how the Click is wired: the bus it talks on and the polarity of its reset line. Stream five samples:

```sh
nxs stream --count 5
```

```
Streaming Fxos8700 — 7 fields, 13B/sample, every_nth=1 (ctrl-C to stop)

                                         accel_x     accel_y     accel_z       mag_x       mag_y       mag_z        temp
                                         (m/s^2)     (m/s^2)     (m/s^2)     (tesla)     (tesla)     (tesla)        (°C)
[     - Hz] n= 6126 ts=...                0.1963    -0.03352       9.855    3.39e-05    -1.7e-05   -7.34e-05       21.12
[ 200.0 Hz] n= 6127 ts=...                0.1915    -0.02394       9.864    3.32e-05   -1.74e-05   -7.44e-05       21.12
[ 200.0 Hz] n= 6128 ts=...                0.1915   -0.009577       9.869     3.3e-05   -1.72e-05   -7.45e-05       21.12
[ 200.0 Hz] n= 6129 ts=...                0.1867    -0.02394       9.864    3.34e-05   -1.73e-05    -7.4e-05       21.12
[ 200.0 Hz] n= 6130 ts=...                0.1724    -0.03352       9.855     3.3e-05   -1.64e-05   -7.51e-05       21.12

Stopped after 5 samples in 25ms (200.0 Hz avg)
```

These are your first samples, in metres per second squared, tesla and degrees Celsius. Each line also shows the unit's sample counter, a timestamp from the unit's clock and the rate the unit measures at. The rate is read from the timestamps, so it needs two samples and the first row shows none. The unit describes every field it serves, with its scale, offset and unit, so `nxs` prints them without knowing anything about the FXOS8700.

## 4. Declare and switch

So far you have talked to the unit directly. A declaration is a file, `suite.yaml`, that names each unit, the personality it runs and the settings it runs with. `nxs` holds the hardware to the file, and the `nxsd` daemon runs it at boot. Let `nxs generate` write your first one from what answered:

```sh
nxs generate
```

```
scan: can0 is down — bring it up at the device's bit timing before it can answer
cam0 (/dev/i2c-cam0, 2-lane): HUB maxim,max96792a @0x6A ok
  A (window 0x21): SER maxim,max96793 ok · no head (no identity register; no ACK) · NXS unit @0x30 serial 2f004b0032510f0011223344 fw v1.1.0
  B (window 0x22): link not locked, nothing behind it
cam1 (/dev/i2c-cam1, 4-lane): nothing answers
  hub maxim,max96792a @0x6A does not answer and is not written (check its power and cabling, then generate again)
wrote /etc/aliensense/hardware.yaml (2 port(s))
seeded /etc/aliensense/suite.yaml (1 unit(s)); next: nxs tune
```

The report walks both camera connectors. On `cam0` the Hub answers, link A carries its serializer and your unit, with no camera head, and nothing is connected to link B. Nothing is connected to `cam1` either, so `nxs generate` writes no Hub there. The first line is about your Jetson's CAN interface, which this guide does not use.

`nxs generate` wrote `hardware.yaml`, which records what is wired, and seeded your declaration beside it. Both live in `/etc/aliensense`, where `nxsd` reads the declaration at boot. The deployment guide's `nxs switch` made that directory for the `i2c` group, so you edit the file without `sudo`. Print the declaration:

```sh
cat /etc/aliensense/suite.yaml
```

```
# Written by `nxs generate` from what it found. This file is yours to
# edit, by hand or with `nxs tune`: names, personalities, settings. The wiring
# lives in hardware.yaml beside it and is rewritten on every run.
ports:
  cam0:
    bus: /dev/i2c-cam0
    hub:
      compatible: maxim,max96792a
      driver: nxs
    links:
      A:
        unit:
          name: unit-cam0-a
          alias: 0x31
  cam1:
    bus: /dev/i2c-cam1
units:
- name: unit-cam0-a
  module: nxs
  links:
  - transport: i2c
    link: cam0/A
  serial: 2f004b0032510f0011223344
  sensors:
  - personality: fxos8700
```

The unit is named after where it hangs, `unit-cam0-a`, and it runs the personality for its Click, `fxos8700`. `alias` is the address the Hub presents the unit at once the port is up, and `serial` ties the entry to this unit. The empty connector, `cam1`, is listed with its bus alone. Apply the file:

```sh
nxs switch
```

```
cam0: nxsd reconverging
✓ unit-cam0-a (i2c /dev/i2c-cam0@0x31)
    converged
    time sync seeded (±229 µs)
```

The first line is the port: `switch` hands it to `nxsd`, which brings it up. The lines under the tick are your unit, now at its alias: it already runs what the file declares, and its clock is set against your Jetson's. No camera is declared, so `switch` installs no camera table and you do not need to reboot: the one reboot a unit on the Hub needs, the one that starts the camera buses, came with the deployment guide. The port comes up at once, and from now on `nxsd` brings it up at every boot. Run `nxs status` with no arguments to judge the file against the hardware:

```sh
nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 0 installed)
ports:
  cam0  /dev/i2c-cam0  hub maxim,max96792a
    HUB: id 0xB6 ok
    CSI: port 2-lane (booted overlay: device tree silent)
    link A SER: present
    link A SEN: none declared (no ACK at 0x1a)
    link A NXS@0x31: present
    link A NXS@0x31: sensor personality Fxos8700
    unit-cam0-a  i2c /dev/i2c-cam0@0x31  ok  serial 2f004b0032510f0011223344  fw v1.1.0
      outputs: accel_x accel_y accel_z mag_x mag_y mag_z temp
  cam1  /dev/i2c-cam1
```

`IN TUNE` means your declaration holds on this hardware: every setting in it is one your hardware offers, and your unit runs its declared personality. The lines between the port and your unit are the port's own health: the Hub answers, link A is alive, and the unit behind it runs the FXOS8700 personality. The `CSI` and `SEN` lines are about cameras, and you have declared none. Your unit now answers at the alias the port gave it, 0x31, and by name. `nxs --unit unit-cam0-a stream --count 5` prints the same samples as before.

:::note[The same values as a panel]
`nxs tune` without flags opens a panel in your terminal. It shows the rig as a tree, with one line for each unit and camera port, declared or not. You can declare a Hub that you plug in later from the panel. `↑↓` move over the nodes and over the knobs of the node under the cursor. `←→` step a knob through the values the descriptors offer. `s` saves and names `nxs switch` as the next command, and `q` quits.
:::

## 5. Change a setting

Every personality declares its parameters and the values each one accepts. Run `caps` on your unit to print that table with the current setting of each parameter:

```sh
nxs --unit unit-cam0-a caps
```

```
Personality: Fxos8700
  sample_rate: [400, 200, 100, 50, 25]  current=200  default=100  unit=Hz
  accel_fs: [2, 4, 8]  current=4  default=4  unit=g
  bus: [0, 1]  current=0  default=0
  reset_active: [0, 1]  current=1  default=1
```

The accelerometer range, `accel_fs`, accepts 2, 4 or 8 g and is set to 4 g. `set` changes a parameter on the running personality. It re-runs the personality's configuration so the new value reaches the sensor's registers, and nothing is uploaded. Set the range to 8 g:

```sh
nxs --unit unit-cam0-a set accel_fs 8
```

```
accel_fs: 4 → 8
```

`nxs` refuses a value that is not in the list and prints the list, so a typo cannot put the sensor into a state the personality does not know. A `set` lasts until the unit reboots. To keep it, write it into the declaration and run `nxs switch`. In `suite.yaml`, the `sensors` line becomes `sensors: [{personality: fxos8700, config: {accel_fs: 8}}]`. `nxs switch` then retunes the running personality to the file in place, with no re-upload. From then on the file is the record. `nxs status` reports the drift whenever the file and the unit differ, and the next `nxs switch` repairs it.

:::tip
`nxs upload` takes any personality that `nxs` knows, or a `.py` file of your own, and `nxs store save 0` keeps it. To write a personality from a datasheet, see [Custom sensor personality](../custom-sensor/).
:::

## Next steps

- To bring up two cameras and two sensors on the same Hub in one dashboard, continue with [Multi-sensor dashboard on ROS 2](../multi-sensor-dashboard/).
- To run the same steps from a chat with an AI agent, see [Getting started with an AI agent](../unboxing-mcp/).
