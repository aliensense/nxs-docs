---
title: "Custom click personality with an AI agent"
sidebar:
  order: 10
---

By the end of this guide, the NXS unit on your Jetson runs a click personality for an IAM-20680 Click. An AI agent wrote it from the datasheet, then uploaded, declared and tuned it from a chat. A click personality is a small Python module that says how to find the Click's sensor, configure it and read it. Its facts file, a YAML file beside it, lists its parameters. The unit is the small sensor computer that runs the personality and serves the samples in SI units.

```d2 title="Custom click personality with an AI agent at a glance"
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
  workstation: "Workstation\nClaude Code, the skill, nxs" {class: open}
  mcp: "nxs mcp on your Jetson\nthe nxs tools the agent calls" {class: open}
  jetson: "Jetson\nnxs on CAM0" {class: hw}
  hub: "NXS Hub\nlinks A and B" {class: hw}
  unit: "NXS unit\nIAM-20680 Click on the Shuttle" {class: hw}
  workstation -> mcp: "ssh"
  mcp -> jetson: "upload · switch · set · freeze"
  jetson <-> hub: "CAM0"
  hub <-> unit: "coax, link A"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Write the personality\n/nxs-generate-click-personality" {class: step}
  s2: "2. Run it\nupload · samples" {class: step}
  s3: "3. Declare it\nnxs personality install · switch · status" {class: step}
  s4: "4. Tune it\nsuite_set · switch · set · freeze" {class: step}
  s5: "5. Calibrate at the terminal\nnxs calibrate gyro · calibrate accel" {class: step}
  s1 -> s2 -> s3 -> s4 -> s5
}

have: "What you have" {
  class: group
  direction: down
  personality: "Your own click personality\nwritten, uploaded, declared and tuned from a chat" {class: result}
  calibration: "A calibration on the unit\nin every stream" {class: result}
}
```

## What you need

- **Hardware**: your Jetson and NXS unit with the IAM-20680 Click swapped in, as [Custom click personality](../custom-sensor/) begins.
- **Workstation**: the `nxs-generate-click-personality` skill and nxs, installed as [Custom click personality](../custom-sensor/) installs them.
- **Agent**: Claude Code on your workstation, connected to the nxs tools on your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/). The same session runs the skill.
- **Time**: about half an hour.

You install the personality into the personality store on your Jetson and calibrate the unit at the terminal. Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson.

## 1. Write the personality

In your Claude Code session, point the skill at the Click's product page and name the personality:

```
/nxs-generate-click-personality https://www.mikroe.com/6dof-imu-9-click — name it my_imu, do not copy the existing personality
```

The skill reads the datasheet and the Click's pin mapping, writes `my_imu.py` and `my_imu.yaml`, compiles them and prints its report. The end of the prompt keeps it from copying the personality that ships for this part, which step 2 compares yours with. Copy the directory to your Jetson:

```sh
host$ scp -r my_imu <user>@<jetson>:
```

## 2. Run it

Ask the agent to upload the personality and show you five samples:

```
Upload my_imu/my_imu.py to the unit at 200 Hz and 8 g, then show me five samples.
```

The agent calls `upload` with the file and the parameters, then `samples`:

```
upload   name=my_imu/my_imu.py  params=[sample_rate=200, accel_fs=8]
samples  count=5

Compiled MyImu (412 B of bytecode, 6 parameters) and uploaded it; the unit runs it
from memory. Five samples at 200 Hz: accel_z reads gravity, the gyro is still.
```

Then ask for the personality that ships for the same part, at the same parameters:

```
Upload iam20680 to the unit at 200 Hz and 8 g, then show me five samples.
```

Compare the two answers column by column, with the unit lying still and not moved between them. They agree within noise. If you calibrated this unit before under either name, run `nxs calibrate reset` on your Jetson first. A solve applies to the personality it was solved with.

## 3. Declare it

The personality store on your Jetson is owned by root, so you install the personality at the terminal, and you write the declaration there too. The declaration is your `suite.yaml`, the file that names each unit, the personality it runs and its settings. As [Custom click personality](../custom-sensor/) does, name the unit `imu-a` and declare `my_imu` at 200 Hz and 8 g.

```sh
orin$ nxs personality install ./my_imu
```

Then let the agent bring the unit to the file:

```
Apply the declaration and report the suite's state.
```

```
switch
status

imu-a took my_imu from the declaration: the store holds MyImu in slot 0 and the unit
measures with it. The declaration is in tune.
```

## 4. Tune it

A declared setting changes in the file, and `switch` then redeploys the personality compiled for it. The unit then boots at the new rate on its own. A device that drifted from an unchanged declaration is retuned in place instead. Ask the agent for a new sample rate:

```
Set imu-a's sample_rate to 100, apply it, and report the suite's state.
```

```
suite_get
suite_set  channel=imu-a  field=sample_rate  value=100
switch
status

sample_rate is 100 in the declaration; switch redeployed imu-a's personality
for it (deploy panel: MyImu). The declaration is in tune.
```

The agent reads the options first and picks a value that the personality offers. A value that the personality does not offer is refused with the list of offered values, as in [Getting started with an AI agent](../unboxing-mcp/).

You can also work the other way round. Turn the knob on the hardware while you experiment, then adopt the value you settle on into the file:

```
Set the unit's sample_rate to 250 on the hardware, then freeze what it runs into the declaration.
```

```
set     port=cam0  link=A  knob=sample_rate  value=250
freeze  unit=imu-a

imu-a runs at 250 Hz, and the declaration now says 250 where it said 100.
```

## 5. Calibrate at the terminal

Calibrate the unit at the terminal with the still measurement and the six poses, as [Custom click personality](../custom-sensor/) calibrates it. The result lives on the unit.

## Next steps

- Write a cam personality from a chat: [Custom cam personality with an AI agent](../custom-camera-mcp/).
- Run the same steps by hand, with the output nxs prints: [Custom click personality](../custom-sensor/).
