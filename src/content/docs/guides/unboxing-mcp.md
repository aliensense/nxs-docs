---
title: "Getting started with an AI agent"
sidebar:
  order: 8
---

You describe what you want in a chat instead of typing commands, and an AI agent runs `nxs` on your host and tells you what it found. Every call the agent makes is a real command that you could also type. At the end, the NXS hardware on your host has a saved setup that survives a reboot.

## What you need

- **Hardware**: the Hub on your Jetson's CAM0 connector with the unit on its link A, powered, its LED on the heartbeat, as [Getting started with the NXS unit](../unboxing/) connects them.
- **Software**: a Claude Code session on your workstation that lists the `nxs` tools, as [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/) leaves it. Claude Code is the agent, and it reaches your host over ssh to talk to `nxs mcp`. That server offers the `nxs` verbs as tools, with the same words and refusals you get at the terminal.
- **Time**: about fifteen minutes.

## 1. Ask what is connected

The Hub is the box that the coax plugs into, and it sits on one of your host's camera connectors. It carries two coax links, A and B. The unit is the small sensor computer at the other end of the coax, with the sensor board on top. Your host sees both on one I²C bus behind that connector. Ask the agent:

```
What is connected to this host?
```

The agent calls `probe`, which sweeps the camera buses without changing anything, and answers from what came back:

```
On /dev/i2c-cam0 there is an NXS Hub at address 0x6A and one NXS unit at 0x30,
serial 2f004b0032510f0011223344. Nothing is declared yet: there is no suite.yaml.
```

If the agent reports that no camera bus is booted, your Jetson has not rebooted since the deployment guide's `nxs switch`. Ask the agent to run `switch`, and reboot your Jetson when it reports that a reboot is needed.

:::note[Reading before writing]
The agent's instructions tell it to read before it writes. `probe` shows what is there, and `status` shows the declaration against it. `suite_get` shows the settings and the values each one may take. A request to change something starts with one of these.
:::

## 2. Identify the unit

Check that you and the agent mean the same box:

```
Blink the unit so I can find it.
```

The agent calls `identify`. The unit's LED strobes fast for ten seconds and then returns to its heartbeat. With several units on a bench, this is how you and the agent agree on which box you mean.

```
Its status LED is strobing now, for about ten seconds.
```

## 3. Read the sensor

A personality is a small compiled driver for the sensor on the unit's board. Your unit runs one and hands out samples in SI units. Ask for some:

```
Show me five samples from the unit.
```

The agent calls `samples` with `count: 5` and lays out what it got:

```
The unit runs the Fxos8700 personality and measures at 200 Hz. Five samples:

  n   accel_x   accel_y   accel_z   mag_x     mag_y      mag_z     temp
      m/s^2     m/s^2     m/s^2     tesla     tesla      tesla     K
  1   0.115     -0.048    9.807     1.23e-05  -3.10e-06  4.41e-05  298.15
  ...

accel_z reads gravity, so the unit is lying flat with its top up.
```

The values are in metres per second squared, tesla and kelvin. The unit describes each field it serves, and `nxs` decodes the samples from that description. The agent never needs to know the sensor.

## 4. Declare the rig

So far the agent has only looked. A declaration is a file, `suite.yaml`, that names the Hub, the unit behind link A, the personality it runs and its settings. Once the file exists, `nxs` holds the hardware to it and brings a replaced unit back to the same state. The file is `/etc/aliensense/suite.yaml`, and the `nxsd` daemon runs it at boot. Ask the agent to write it:

```
Declare this rig so the setup survives a reboot.
```

The agent calls `generate`, which writes down what answered and seeds the file from it. Then it calls `switch` to apply the file, and then `status`:

```
generate  dry_run=false
switch
status

Declared the Hub on cam0 and unit-cam0-a on its link A, running fxos8700.
suite.yaml is written; the port is up and the declaration is in tune.
```

No camera is declared, so `switch` asks for no reboot. The unit is named after where it hangs, `unit-cam0-a`. To name it after its role in your machine, such as `imu-front`, rename it in the file with any editor.

## 5. Tune a setting

The personality's parameters are part of the declaration, and each one accepts a fixed list of values. Ask for a range that the personality offers:

```
Set its accelerometer range to 8 g.
```

```
suite_get
suite_set  channel=unit-cam0-a  field=accel_fs  value=8
status

accel_fs is 8 g in the declaration; the unit still runs 4 g until the file is applied.
```

Now ask for one it does not:

```
Make it 6 g.
```

```
The personality offers 2, 4, and 8 g for accel_fs, so 6 is refused; I left it at 8.
```

The refusal comes from `nxs` itself. `nxs` never writes a value outside the offered list into the file, whichever way the request arrives. So an agent cannot declare a setting that the hardware would reject.

## 6. Apply the declaration

The file describes the setup, and `switch` makes your hardware match it. `switch` compares each declared unit with its entry and changes only what differs. A unit that already runs the declared personality takes a changed setting in place, as a retune with no re-upload. Ask the agent to apply it:

```
Apply the declaration and tell me whether everything is in tune.
```

```
switch
status

unit-cam0-a retuned accel_fs from 4 to 8 in place.
Status: unit-cam0-a on /dev/i2c-cam0@0x31 answers, running Fxos8700, and the
declaration is in tune.
```

If the declaration has findings, `switch` refuses, and the agent reports the refusal in the words `nxs` used. The file is now the record of your rig. `status` judges the hardware against it, and `switch` brings a swapped unit to the same state.

## Next steps

- To bring up two cameras and two sensors on the Hub from a chat, continue with [Multi-sensor dashboard with an AI agent](../multi-sensor-dashboard-mcp/).
- To run the same steps by hand and see the output `nxs` prints, follow [Getting started with the NXS unit](../unboxing/).
