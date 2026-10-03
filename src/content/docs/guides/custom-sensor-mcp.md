---
title: "Custom sensor personality with an AI agent"
sidebar:
  order: 10
---

By the end of this guide, the NXS unit connected to your Jetson runs a personality for an IAM-20680 Click that an AI agent wrote from the datasheet, then uploaded, declared and tuned from a chat. A personality is a small Python module that says how to find the sensor, configure it and read it, plus a YAML file that lists its parameters. The unit is the small sensor computer that runs the personality and serves the samples in SI units.

## What you need

- **Hardware**: your Jetson and NXS unit with the IAM-20680 Click swapped in, as [Custom sensor personality](../custom-sensor/) begins.
- **Workstation**: the `nxs-generate-sensor-personality` skill and nxs, installed as [Custom sensor personality](../custom-sensor/) installs them.
- **Agent**: Claude Code on your workstation, connected to the nxs tools on your Jetson as in [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/). The same session runs the skill.
- **Time**: about half an hour.

You install the personality into the personality store on your Jetson and calibrate the unit at the terminal. Commands that start with `host$` run on your workstation, and commands that start with `orin$` run on your Jetson.

## 1. Write the personality

In your Claude Code session, point the skill at the Click's product page and name the personality:

```
/nxs-generate-sensor-personality https://www.mikroe.com/6dof-imu-9-click — name it my_imu, do not copy the existing driver
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

Then ask for the personality that ships for the same part, `iam20680`, at the same parameters. Compare the two answers column by column, with the unit lying still and not moved between them. They agree within noise. If you calibrated this unit before under the name `MyImu`, run `nxs calibrate reset` on your Jetson first: a solve applies to the personality it was solved with.

## 3. Declare it

The personality store on your Jetson is owned by root, so you install the personality at the terminal, and you write the declaration there too. The declaration is your `suite.yaml`, the file that names each unit, the personality it runs and its settings. As [Custom sensor personality](../custom-sensor/) does, name the unit `imu-a` and declare `my_imu` at 200 Hz and 8 g.

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

A declared setting changes in the file, and `switch` then retunes the running personality in place. Ask the agent for a new sample rate:

```
Set imu-a's sample_rate to 500, apply it, and report the suite's state.
```

```
suite_get
suite_set  channel=imu-a  field=sample_rate  value=500
switch
status

sample_rate is 500 in the declaration; switch retuned imu-a from 200 to 500 in place,
with no re-upload. The declaration is in tune.
```

The agent reads the options first and picks a value that the personality offers. A value that the personality does not offer is refused with the list of offered values, as in [Getting started with an AI agent](../unboxing-mcp/).

You can also work the other way round. Turn the knob on the hardware while you experiment, then adopt the value you settle on into the file:

```
Set the unit's sample_rate to 250 on the hardware, then freeze what it runs into the declaration.
```

```
set     port=cam0  link=A  knob=sample_rate  value=250
freeze  unit=imu-a

imu-a runs at 250 Hz, and the declaration now says 250 where it said 500.
```

## 5. Calibrate at the terminal

Calibrate the unit at the terminal with the still measurement and the six poses, as [Custom sensor personality](../custom-sensor/) calibrates it. The result lives on the unit.

## Next steps

- Write a camera personality from a chat: [Custom camera personality with an AI agent](../custom-camera-mcp/).
- Run the same steps by hand, with the output nxs prints: [Custom sensor personality](../custom-sensor/).
