---
title: "Custom sensor personality"
sidebar:
  order: 5
---

By the end of this guide, the NXS unit connected to your Jetson runs a personality that you wrote for an IAM-20680 Click, a six-axis IMU, and holds a calibration solved with that personality. A personality is a small Python module that says how to find the sensor, configure it and read it, plus a YAML file that lists its parameters. The unit is the small sensor computer that runs the personality and serves the samples in SI units.

## What you need

- **Hardware**: your Jetson, the Hub and the unit as [Getting started with the NXS unit](../unboxing/) leaves them, with the unit declared and streaming. The Hub is the GMSL deserializer board on one of your Jetson's camera connectors, and nxs calls that connector a port, here `cam0`. The unit is on link A, one of the two coax links the Hub carries.
- **Sensor**: an IAM-20680 Click, to replace the FXOS8700 Click. A personality for this part ships with nxs, so you can check your own work against it at every step.
- **Workstation**: a computer with Claude Code, git and Python 3.10 or newer. Claude Code is the AI coding agent that helps you write the personality.
- **Software**: nxs on your Jetson, as [NVIDIA Jetson deployment](../deploy-jetson/) installs it. Step 2 installs it on the workstation.
- **Time**: about 45 minutes, or an hour with the calibration.

Commands that start with `host$` run on your workstation. Commands that start with `orin$` run on your Jetson.

## 1. Swap the Click

Slot 0 of the unit's store still holds the FXOS8700 personality, and you are about to remove the Click it drives. Clear the store first, so that the unit boots with nothing loaded:

```sh
orin$ nxs store clear
```

```
note: unit 'unit-cam0-a' is suite-managed — this change reverts on `nxs switch`; keep it with `nxs tune --freeze --unit unit-cam0-a`
Personality store cleared.
```

The `note:` line says that your declaration names this unit, so `nxs switch` would put back what the declaration says. Every change you make to the unit by hand prints it, until step 5 declares the new Click. The declaration is your `suite.yaml`, the file that names each unit, the personality it runs and its settings.

Power the Hub off, swap the FXOS8700 Click for the IAM-20680 Click on the Shuttle, and power the Hub on. The LED settles into a slow single flash, which means that no personality is loaded.

`nxs generate` walks the rig and reports what answers on each port:

```sh
orin$ nxs generate
```

```
scan: can0 is down — bring it up at the device's bit timing before it can answer
cam0 (/dev/i2c-cam0, 2-lane): HUB maxim,max96792a @0x6A ok
  A (window 0x21): SER maxim,max96793 ok · no head (no identity register; no ACK) · NXS unit @0x31 serial 20313447504650150053005d fw v1.1.0-rc1-26-gdeb1b2c7
  B (window 0x22): link not locked, nothing behind it
cam1 (/dev/i2c-cam1, 4-lane): nothing answers
  hub maxim,max96792a @0x6A does not answer and is not written (check its power and cabling, then generate again)
wrote /etc/aliensense/hardware.yaml (2 port(s))
kept /etc/aliensense/suite.yaml; next: nxs tune
```

The unit answers at 0x31 on link A, behind the serializer, with no camera beside it. It runs nothing until you upload a personality in step 3. The first line is the CAN sweep: the Jetson's own CAN interface is down, and no unit in this guide uses CAN. The `cam1` lines are the Jetson's other camera connector, empty here. `generate` rewrote `hardware.yaml`, its record of what answered, and kept your `suite.yaml`, which still names `fxos8700`. `nxs status` reports that drift until step 5.

## 2. Generate the personality

The personality that ships for this part is what you would write by hand from the datasheet. Instead of reading the datasheet yourself, hand it to the `nxs-generate-sensor-personality` skill, which ships with the SDK. This Claude Code skill reads a datasheet or a Click product page, extracts the registers, the configuration sequence and the output format, and writes the personality pair. Install it once:

```sh
host$ git clone --depth 1 https://github.com/aliensense/nxs
host$ mkdir -p ~/.claude/skills && cp -r nxs/skills/nxs-generate-sensor-personality ~/.claude/skills/
host$ python3 -m venv ~/nxs-venv
host$ source ~/nxs-venv/bin/activate
host$ python3 -m pip install aliensense-nxs==1.1.0
host$ claude
```

:::note
pip takes the wheel that fits the workstation: the platform wheel on Linux, and on a Mac the pure wheel, `aliensense_nxs-1.1.0-py3-none-any.whl`. The pure wheel carries the compiler and the checks the skill runs, and none of the runtime library that reaches a unit. Install the version that `nxs --version` prints on your Jetson. The virtual environment keeps nxs apart from the system Python, and `claude` started from that shell finds it.
:::

nxs on your workstation gives the skill the compiler, so the skill can prove that what it wrote compiles before it hands it to you. In the Claude Code session, point the skill at the Click's product page and give the personality a name:

```
/nxs-generate-sensor-personality https://www.mikroe.com/6dof-imu-9-click — name it my_imu, do not copy the existing driver
```

The skill identifies the part from the page, then reads its datasheet and the Click's pin mapping, which give it the registers, the bus and the interrupt pin. mikroe.com may refuse the session's fetch of the page, and the session then looks the datasheet up by the part number. The end of the prompt keeps the session from copying the personality that ships for this part, which step 3 uses as your yardstick. The skill writes the pair, compiles it and reports, in about ten minutes:

```
nxs personality: my_imu

  files     ./my_imu/my_imu.py · ./my_imu/my_imu.yaml
  bus       i2c (default) · spi
  trigger   drdy · 100 Hz
  outputs   accel_x/y/z (m/s^2) · gyro_x/y/z (rad/s) · temp (K)
  params    sample_rate=100 · accel_fs=8 · gyro_fs=2000 · accel_bw=218 · gyro_bw=176

  nxs upload ./my_imu/my_imu.py --config bus=spi
  nxs stream --hz 100
  nxs set sample_rate 250
  nxs store save 0
  nxs personality install ./my_imu
```

Read the report as a summary of the datasheet. It shows the buses the part offers, the pin that signals a new sample and the default rate, the seven outputs already mapped to SI units, and the five parameters with their defaults. The commands under it are the skill's suggestions. This guide runs its own in the next steps. The report differs from run to run, as the skill's choices do. The two files are in the directory where you started `claude`:

```sh
host$ ls my_imu
```

```
my_imu.py	my_imu.yaml
```

:::note[Why two files]
The Python is the behaviour: probe, configure, measure. The YAML is the facts: the parameter table, with the values each accepts. nxs reads the YAML on its own, without importing or compiling the Python. That is how `nxs status` and `nxs tune` know a personality's options before it ever runs.
:::

`nxs personality check` reads the pair the way nxs will and names anything wrong with it:

```sh
host$ nxs personality check ./my_imu
```

```
personality my_imu: unit · params sample_rate, accel_fs, gyro_fs, accel_bw, gyro_bw
  ok — bench proof: nxs upload, then the validation contract
```

`ok` means the files agree with each other and with the schema, and the Python compiles for every bus it declares. It does not prove that the personality reads the sensor correctly. The bench does.

## 3. Run it

Copy the directory to your Jetson and upload the Python file. The upload finds the YAML file beside it:

```sh
host$ scp -r my_imu <user>@<jetson>:
orin$ nxs upload ./my_imu/my_imu.py --param sample_rate=200 accel_fs=8
```

```
note: unit 'unit-cam0-a' is suite-managed — this change reverts on `nxs switch`; keep it with `nxs tune --freeze --unit unit-cam0-a`
Compiled MyImu: 104B bytecode, 6 params → 678B driver image
Uploaded and running.
```

The sizes depend on what the skill wrote, so yours differ. The unit now runs your personality. Stream five samples from it:

```sh
orin$ nxs stream --count 5
```

```
Streaming MyImu — 7 fields, 14B/sample, every_nth=1 (ctrl-C to stop)

                                         accel_x     accel_y     accel_z        temp      gyro_x      gyro_y      gyro_z
                                         (m/s^2)     (m/s^2)     (m/s^2)        (°C)     (rad/s)     (rad/s)     (rad/s)
[     - Hz] n= 4995 ts=2496318244          -9.51      0.8619      -1.951       31.72   0.0004874   0.0005859  -0.0004714
[ 199.6 Hz] n= 4996 ts=2496323255         -9.529      0.8356      -1.944       31.73    0.001553  -0.0004794  -0.0004714
[ 199.5 Hz] n= 4997 ts=2496328267         -9.582      0.8763      -1.973        31.7   0.0004874   0.0005859  -0.0004714
[ 199.6 Hz] n= 4998 ts=2496333277         -9.562      0.8164      -1.978        31.7  -0.0005779   -0.001545  -0.0004714
[ 199.6 Hz] n= 4999 ts=2496338288         -9.553       0.826      -1.966       31.71   0.0004874   0.0005859    0.001659

Stopped after 5 samples in 25ms (199.6 Hz avg)
```

Each row carries the sample's number `n`, which counts from the personality's start, and its timestamp `ts`, in microseconds on the unit's clock. The rate in front is what those timestamps give, from the second row on: 199.6 Hz for the 200 Hz you asked for, since the sensor's own clock paces the samples. The temperature prints in degrees Celsius, and `--units si` prints the kelvin the unit serves.

A personality that streams plausible numbers can still be subtly wrong. A scale can be off by a power of two, one axis can have its sign flipped, or a range parameter can write the wrong register. The personality that ships for the same part is your yardstick. Run it with the same settings and compare the two streams column by column:

```sh
orin$ nxs upload iam20680 --param sample_rate=200 accel_fs=8
orin$ nxs stream --count 5
```

```
note: unit 'unit-cam0-a' is suite-managed — this change reverts on `nxs switch`; keep it with `nxs tune --freeze --unit unit-cam0-a`
Compiled Iam20680: 104B bytecode, 6 params → 691B driver image
Uploaded and running.
Streaming Iam20680 — 7 fields, 14B/sample, every_nth=1 (ctrl-C to stop)

                                         accel_x     accel_y     accel_z        temp      gyro_x      gyro_y      gyro_z
                                         (m/s^2)     (m/s^2)     (m/s^2)        (°C)     (rad/s)     (rad/s)     (rad/s)
[     - Hz] n= 1833 ts=2620042466       -0.09577     -0.1389        10.1       31.71    -0.03409   -0.007457   -0.004261
[ 199.6 Hz] n= 1834 ts=2620047477       -0.09577    -0.09098       10.12       31.72    -0.03409   -0.006392   -0.005326
[ 199.6 Hz] n= 1835 ts=2620052488        -0.1245     -0.1628       10.11        31.7    -0.03409   -0.006392   -0.005326
[ 199.6 Hz] n= 1836 ts=2620057499       -0.09577     -0.1532       10.04       31.73    -0.03302   -0.006392   -0.005326
[ 199.6 Hz] n= 1837 ts=2620062510       -0.09577     -0.1149       10.02       31.71    -0.03302   -0.007457   -0.005326

Stopped after 5 samples in 25ms (199.6 Hz avg)
```

With the unit lying still on the bench, not moved between the two reads, you see gravity on one axis and near zero on the others, and the two streams agree within noise. If you calibrated this unit before under the name `MyImu`, run `nxs calibrate reset` first: a solve applies to the personality it was solved with, so it would shift the `my_imu` columns and not the `iam20680` ones. The validation contract in the [Personality Authoring Reference](../../reference/nxs-personality-authoring/#3-the-validation-contract) lists everything to compare: identity, parameters against the datasheet, canonical units, an independent decode, physical plausibility and a parameter round-trip.

## 4. Add a field

You can read and change a personality's Python by hand. This version reads only the accelerometer. It also raises a flag on the unit itself whenever an axis hits its rail, so your Jetson never has to scan for saturation at 200 Hz. Everything the unit computes per sample is written in `measure`, and the compiler turns it into bytecode that the unit runs. Save it as `my_accel.py`:

```python
from nxs import RegisterDriver, Sample


class MyAccel(RegisterDriver):
    """IAM-20680, accelerometer only, with an on-device clip flag."""

    BUSES = ('i2c',)
    I2C_ADDRS = [0x68, 0x69]
    WHO_AM_I_REG = 0x75
    WHO_AM_I_VALUES = [0xA9]
    PINS = {'drdy': 'mkbus_int'}
    ACCEL_FS = {2: 0x00, 4: 0x08, 8: 0x10, 16: 0x18}
    ACCEL_BASE_SCALE = 9.80665 / 32768.0
    RAIL = 32767

    def __init__(self):
        super().__init__()
        self._read_responses = {self.WHO_AM_I_REG: [self.WHO_AM_I_VALUES[0]]}

    def probe(self):
        who = self.read(self.WHO_AM_I_REG)
        assert who in self.WHO_AM_I_VALUES

    def configure(self, config):
        self.declare_param('sample_rate', [50, 100, 200, 500], 200, unit='Hz')
        self.declare_param('accel_fs', [2, 4, 8, 16], 8, unit='g')
        sample_rate = config.get('sample_rate', 200)
        accel_fs = config.get('accel_fs', 8)
        self.write(0x6B, 0x80)
        self.sleep_ms(200)
        self.write(0x6B, 0x01)
        self.sleep_ms(70)
        self.write(0x19, 1000 // sample_rate - 1, param=('sample_rate', sample_rate))
        self.write(0x1A, 0x01)
        self.write(0x1C, self.ACCEL_FS[accel_fs], param=('accel_fs', accel_fs))
        self.write(0x1D, 0x07)
        self.write(0x37, 0x00)
        self.write(0x38, 0x01)
        self.set_output([
            {'name': 'accel_x', 'scale': self.ACCEL_BASE_SCALE, 'scale_param': 'accel_fs'},
            {'name': 'accel_y', 'scale': self.ACCEL_BASE_SCALE, 'scale_param': 'accel_fs'},
            {'name': 'accel_z', 'scale': self.ACCEL_BASE_SCALE, 'scale_param': 'accel_fs'},
            {'name': 'clipped', 'type': 'uint8', 'scale': 1.0, 'unit': ''},
        ])
        self.set_sample_size(7)

    @RegisterDriver.measure_loop(trigger='drdy')
    def measure(self):
        ax = self.read(0x3B, 2, signed=True)
        ay = self.read(0x3D, 2, signed=True)
        az = self.read(0x3F, 2, signed=True)
        clipped = 0
        if ax >= self.RAIL:
            clipped = 1
        if ax <= -self.RAIL:
            clipped = 1
        if ay >= self.RAIL:
            clipped = 1
        if ay <= -self.RAIL:
            clipped = 1
        if az >= self.RAIL:
            clipped = 1
        if az <= -self.RAIL:
            clipped = 1
        return Sample(accel_x=ax, accel_y=ay, accel_z=az, clipped=clipped)
```

`probe` reads the identity register, so the unit refuses to run the personality on another part. `configure` writes the sensor's registers from the datasheet and declares the outputs with their scales. It wakes the part, lets it settle for 70 ms and sets the rate divider, SMPLRT_DIV, which divides the part's 1 kHz internal rate only under CONFIG's filter codes 1 to 6. So it writes CONFIG with code 1, as the shipped personality does. The gyroscope keeps running, since in standby the part ignores the divider and samples at 1 kHz. `scale_param` ties the accelerometer scale to the range parameter, so a range change rescales the output. `measure` runs on the unit once per data-ready interrupt, and the six comparisons against the raw rail run there too. That is why the flag costs your Jetson nothing.

Beside the code, the personality needs its descriptor, the YAML file that names the parameters nxs offers. The descriptor carries the same two rows you declared, and their order fixes their wire indices, so the entries never change order. Save it as `my_accel.yaml` next to `my_accel.py`:

```yaml
meta:
  driver: my_accel
params:
  - {name: sample_rate, values: [50, 100, 200, 500], default: 200, unit: Hz}
  - {name: accel_fs, values: [2, 4, 8, 16], default: 8, unit: g}
```

Upload the pair by naming the Python file. The upload picks up the descriptor beside it:

```sh
orin$ nxs upload ./my_accel.py
```

```
note: unit 'unit-cam0-a' is suite-managed — this change reverts on `nxs switch`; keep it with `nxs tune --freeze --unit unit-cam0-a`
Compiled MyAccel: 251B bytecode, 3 params → 543B driver image
Uploaded and running.
```

:::note
If you see `no parameter descriptor`, the upload found no descriptor beside the code and stopped. The upload will not guess a parameter surface that a device would then be asked to honour. Save the YAML file next to the Python file and upload again.
:::

The upload reports three parameters: the two you declared and `bus`. Every register personality carries `bus`, so that a part with an SPI option can be compiled for either bus. The new field appears in the unit's self-description, which `status` prints at the end when you address the unit:

```sh
orin$ nxs --unit unit-cam0-a status
```

```
NXS @ i2c /dev/i2c-cam0@0x31
  Serial:       20313447504650150053005d
  FW:           v1.1.0-rc1-26-gdeb1b2c7
  Personality:  MyAccel
  ...
  Outputs:      4 field(s), 7 byte(s) per sample
     #  name          type     order   semantic            scale      offset  unit
     0  accel_x       int16    big     accel_x         0.0023942           0  m/s^2
     1  accel_y       int16    big     accel_y         0.0023942           0  m/s^2
     2  accel_z       int16    big     accel_z         0.0023942           0  m/s^2
     3  clipped       uint8    big     generic                 1           0
```

The `...` stands for the lines between, the unit's run state, store, sample count and fault counters. The scale is the 8 g range's, 8 × 9.80665 / 32768 m/s² per count. `clipped` is the last row, a `uint8` field with no unit. Stream five samples:

```sh
orin$ nxs stream --count 5
```

```
Streaming MyAccel — 4 fields, 7B/sample, every_nth=1 (ctrl-C to stop)

                                         accel_x     accel_y     accel_z     clipped
                                         (m/s^2)     (m/s^2)     (m/s^2)          ()
...
```

While the unit lies still, `clipped` reads 0, and the rows are about 5000 µs apart in `ts`, the 200 Hz of the default `sample_rate`. The flag reads 1 on a sample where an axis reaches the end of its ±8 g range, as it does for a few milliseconds when the unit is dropped or knocked hard. A host that watches for saturation then reads one byte a sample instead of comparing three axes with the rail.

## 5. Declare it

Until now your personality lived in a directory. The personality store on your Jetson gives it a name that the declaration can use, and it lets you run `nxs upload my_imu` from any directory. The store is owned by root, so the copy asks for your password:

```sh
orin$ nxs personality install ./my_imu
```

```
installed my_imu (unit) into /opt/aliensense/personalities/my_imu; next: nxs upload my_imu
```

Replace the content of `/etc/aliensense/suite.yaml` with:

```yaml
ports:
  cam0:
    hub: maxim,max96792a
    links:
      A:
        unit: {name: imu-a, alias: 0x31}
units:
  - name: imu-a
    module: nxs
    links: [{transport: i2c, link: cam0/A}]
    sensors: [{personality: my_imu, config: {sample_rate: 200, accel_fs: 8}}]
```

The file names the unit after its role, `imu-a`, both in the port's link entry and in the unit's own entry, and it declares `my_imu` with the settings it runs at. `nxs status` on its own reads the file and the personality's YAML, and it reports any setting that the personality does not offer as a finding. `nxs switch` then brings the unit to the declared state:

```sh
orin$ nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 1 installed)
ports:
  cam0  /dev/i2c-cam0  hub maxim,max96792a
    HUB: id 0xB6 ok
    CSI: 2-lane (port and booted overlay agree)
    link A SER: present
    link A SEN: none declared (no ACK at 0x1a)
    link A NXS@0x31: present
    link A NXS@0x31: sensor personality MyAccel
    imu-a  i2c /dev/i2c-cam0@0x31  ok  serial 20313447504650150053005d  fw v1.1.0-rc1-26-gdeb1b2c7
      outputs: accel_x accel_y accel_z clipped
      ! drift: driver
```

The port's lines check the Hub, the CSI lane count against the booted overlay, and each node on link A: the serializer, the camera head the file declares none of, and the unit with the personality it runs. The unit still runs MyAccel, which step 4 uploaded, while the file declares `my_imu`, so `status` reports a `driver` drift.

```sh
orin$ nxs switch
```

```
✓ imu-a (i2c /dev/i2c-cam0@0x31)
    recorded serial 20313447504650150053005d
    deploy panel: MyImu
    active: MyImu (running)
    time sync seeded (±229 µs)
```

`switch` records the unit's serial under its new name, saves `my_imu` in the unit's store and starts it, then seeds the unit's time sync. `running` means the unit measures with the personality it just took, and from the next boot it loads it from its store. Run `status` again:

```sh
orin$ nxs status
```

```
declaration: IN TUNE
personalities: /opt/aliensense/personalities (2 shipped, 1 installed)
ports:
  cam0  /dev/i2c-cam0  hub maxim,max96792a
    HUB: id 0xB6 ok
    CSI: 2-lane (port and booted overlay agree)
    link A SER: present
    link A SEN: none declared (no ACK at 0x1a)
    link A NXS@0x31: present
    link A NXS@0x31: sensor personality MyImu
    imu-a  i2c /dev/i2c-cam0@0x31  ok  serial 20313447504650150053005d  fw v1.1.0-rc1-26-gdeb1b2c7
      outputs: accel_x accel_y accel_z temp gyro_x gyro_y gyro_z
```

The drift is gone, and the unit serves the seven outputs of `my_imu`. From now on, `nxs switch` is how the unit gets its personality. That holds after you replace the unit or update its firmware, and on a new robot built from the same file.

## 6. Calibrate

An IMU straight from the reel has a gyro bias, and each accelerometer axis has small scale and offset errors. The IMU is also mounted at some angle to the machine. Calibration lives on the unit, not on the host. You solve it once, and every stream after that carries the correction, whichever host reads it.

Start with the mounting. The `orientation` parameter says how the unit sits relative to the machine. Here the unit is rotated ninety degrees about its vertical axis:

```sh
orin$ nxs --unit imu-a stream --count 3
orin$ nxs --unit imu-a set orientation YAW_90
```

```
orientation = YAW_90 (applied and persisted)
```

The unit applies the orientation and saves it.

The gyro bias is what the gyroscope reads when nothing moves. Put the unit down and leave it alone while it measures:

```sh
orin$ nxs --unit imu-a calibrate gyro
```

```
hold still — the device is measuring gyro bias
━━━━━━━━━━ 100%
✓ applied on-device + persisted
```

The accelerometer fit needs gravity from six directions, with each axis pointing up and then down. You hold eight still poses in any order: the six, then a corner pointing up and the same corner pointing down, the two check poses. The wizard records each pose by itself once the unit has been still for a moment, so you only move the unit between poses:

```sh
orin$ nxs --unit imu-a calibrate accel
```

```
accel calibration — 8 still poses, any order:
  +X -X +Y -Y +Z -Z   each axis pointing up, then down
  check               resting on a corner: every axis reads 0.40-0.80 g
  flipped             the same corner pointing down (every axis reversed)
✓ +Z  (1.027 g)
✓ +X  (0.993 g)
✓ -Z  (0.979 g)
✓ -X  (1.008 g)
✓ -Y  (1.014 g)
✓ +Y  (0.989 g)
✓ check  (0.961 g)
✓ flipped  (1.041 g)
solve: scale (0.9995, 0.9999, 0.9975), offset (-0.067, -0.141, +0.234) m/s^2, check poses 1.58% off g
✓ applied + persisted (tag MyImu)
```

The `solve` line is the result. It gives a scale and an offset per axis, and how far the two check poses land from one g after the correction. A fit whose check poses land within 3 % of one g is applied. Past that bound the wizard uploads nothing, since a pose moved while it was recorded, and you run the wizard again.

```sh
orin$ nxs --unit imu-a calibrate show
```

```
orientation  YAW_90
accel  solved    active (MyImu)
gyro   solved    active (MyImu)
mag    identity  unguarded
encoder zero +0.0000 rad  unguarded
```

The tag next to a solved calibration names the personality it was solved with. A solve belongs to the sensor and the personality that read it. If you run a different personality, the unit keeps the record but applies only the mounting orientation until a matching personality runs again.

Stream three samples with the correction applied:

```sh
orin$ nxs --unit imu-a stream --count 3
```

```
Streaming MyImu — 7 fields, 14B/sample, every_nth=1 (ctrl-C to stop)

                                         accel_x     accel_y     accel_z        temp      gyro_x      gyro_y      gyro_z
                                         (m/s^2)     (m/s^2)     (m/s^2)        (°C)     (rad/s)     (rad/s)     (rad/s)
[     - Hz] n=52208 ts=264627343         0.07728    -0.03631        9.84       33.15    0.002735  -0.0001918   -0.001044
[ 199.6 Hz] n=52209 ts=264632354         0.07728    -0.09853       9.802       33.19      0.0038   0.0008735   2.131e-05
[ 199.6 Hz] n=52210 ts=264637365         0.02222    -0.05785       9.825       33.19    0.002735   -0.001257   2.131e-05

Stopped after 3 samples in 15ms (199.6 Hz avg)
```

With the unit lying flat, gravity reads about 9.81 m/s² on `accel_z` and the gyroscope reads a few thousandths of a rad/s, its noise once the bias is gone.

## Next steps

- Write a personality for an image sensor that nxs has never seen: [Custom camera personality](../custom-camera/).
- Run the same steps from a chat: [Custom sensor personality with an AI agent](../custom-sensor-mcp/).
