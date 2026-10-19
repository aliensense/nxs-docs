---
title: "Getting started with an AI agent"
sidebar:
  order: 8
---

You describe what you want in a chat instead of typing commands. An AI agent runs `nxs` on your host and tells you what it found. Every call the agent makes is a real command that you could also type. At the end, the NXS hardware on your host has a saved setup that survives a reboot.

```d2 title="Getting started with an AI agent at a glance"
# Getting started with an AI agent: what you connect, what you do, what you have.

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
  agent: "Workstation\nClaude Code, the agent" {class: third}
  mcp: "Jetson\nnxs mcp serves the nxs verbs as tools" {class: open}
  hub: "NXS Hub\non CAM0, links A and B" {class: hw}
  unit: "NXS unit\nits Click on top" {class: hw}
  agent -> mcp: "ssh"
  mcp <-> hub: "port cam0"
  hub <-> unit: "coax, link A"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Ask what is connected\nprobe" {class: step}
  s2: "2. Identify the unit\nidentify" {class: step}
  s3: "3. Read the sensor\nsamples" {class: step}
  s4: "4. Declare the rig\ngenerate · switch · status" {class: step}
  s5: "5. Tune a setting\nsuite_get · suite_set" {class: step}
  s6: "6. Apply the declaration\nswitch · status" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5 -> s6
}

have: "What you have" {
  class: group
  direction: down
  setup: "A saved setup\nthat survives a reboot" {class: result}
  calls: "Every call a real nxs command\nthat you could also type" {class: result}
}
```

## What you need

- **Hardware**: the Hub on your Jetson's CAM0 connector with the unit on its link A, as [Getting started with the NXS unit](../unboxing/) connects them. The Hub has power, and the unit's LED shows the heartbeat.
- **Software**: a Claude Code session on your workstation that lists the `nxs` tools, as [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/) leaves it. Claude Code is the agent, and it reaches your host over ssh to talk to `nxs mcp`. That server offers the `nxs` verbs as tools, with the same words and refusals you get at the terminal.
- **Time**: about fifteen minutes.

## 1. Ask what is connected

The Hub is the GMSL deserializer board on one of your host's camera connectors, and the coax plugs into it. It carries two coax links, A and B. The unit is the small sensor computer at the other end of the coax, with its Click on top. A Click is a mikroBUS board with a sensor, seated on the unit's socket. Your host sees the Hub and the unit on one I²C bus behind that connector. Ask the agent:

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

A click personality is the compiled program that the unit runs for the sensor on its Click. Your unit runs one and hands out samples in SI units. Ask for some:

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

So far the agent has only looked. Your rig is the hardware on this host: the Hub and the unit behind link A. A declaration is a file, `suite.yaml`, that names the Hub, the unit behind link A, the personality it runs and its settings. Once the file exists, `nxs` holds the hardware to it and brings a replaced unit back to the same state. The file is `/etc/aliensense/suite.yaml`, and the `nxsd` daemon runs it at boot. Ask the agent to write it:

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

No camera is declared, so `switch` asks for no reboot. The unit is named after where it hangs, `unit-cam0-a`. To name it after its role in your machine, such as `imu-front`, edit the file with any editor. Rename the unit's node and each connection that names it.

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

The file describes the setup, and `switch` makes your hardware match it. `switch` compares each declared unit with its node in the file and changes only what differs. A setting the file changed reaches the unit as its personality uploaded again with the new value and saved in its store. A unit that strayed from an unchanged file is retuned in place. Ask the agent to apply it:

```
Apply the declaration and tell me whether everything is in tune.
```

```
switch
status

unit-cam0-a retuned accel_fs from 4 to 8 in place.
Status: unit-cam0-a on /dev/i2c-cam0@0x32 answers, running Fxos8700, and the
declaration is in tune.
```

If the declaration has findings, `switch` refuses, and the agent reports the refusal in the words `nxs` used. The file is now the record of your rig. `status` judges the hardware against it, and `switch` brings a swapped unit to the same state.

## Next steps

- To bring up two cameras and two sensors on the Hub from a chat, continue with [Multi-sensor dashboard with an AI agent](../multi-sensor-dashboard-mcp/).
- To run the same steps by hand and see the output `nxs` prints, follow [Getting started with the NXS unit](../unboxing/).
