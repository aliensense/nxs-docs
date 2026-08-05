---
title: Install and first contact
sidebar:
  order: 2
---

Requires Python ≥ 3.10. The base install covers I²C and serial; the
`[cyphal]` extra adds pycyphal for Cyphal/serial and Cyphal/CAN. The
Cyphal DSDL ships vendored in the wheel, so the install is
self-contained.

With **uv** (native device access; the only option on macOS, where Docker
cannot reach USB):

```sh
uv tool install 'nxs[cyphal]'      # omit [cyphal] for an I2C-only install
```

With **pip**, from a release wheel:

```sh
python3 -m pip install 'nxs-<version>-py3-none-any.whl[cyphal]'
```

Verify:

```sh
nxs --version
```

## First contact

With the unit powered and the host wired to it (see the hardware
section for connectors), the first three commands are:

```sh
nxs probe
nxs upload iam20680 --param sample_rate=250
nxs stream
```

`probe` confirms the device answers. `upload` compiles a shipped driver
and loads it onto the VM. `stream` decodes live samples using the
device's self-description — SI units, no per-sensor host code.

Transport selection, addresses, and per-transport wiring are the
Integration & Operation Manual's first chapter, in the
[Reference](/reference/nxs-integration-manual/) section.
