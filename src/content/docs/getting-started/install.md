---
title: Install and first contact
sidebar:
  order: 2
---

Requires Python ≥ 3.10. The base install covers I²C and serial; the
`[cyphal]` extra adds pycyphal for Cyphal/serial and Cyphal/CAN. The
Cyphal DSDL ships vendored in the wheel, so the install is
self-contained.

The `nxs` wheel ships with your kit. If you need it again, or a newer
release, email [support@aliensense.com](mailto:support@aliensense.com).
Install it from the file: the name `nxs` on PyPI belongs to an unrelated
package, so `pip install nxs` or `uv tool install nxs` without a file path
installs the wrong thing.

With **uv** (native device access; the only option on macOS, where Docker
cannot reach USB):

```sh
uv tool install './nxs-<version>-py3-none-any.whl[cyphal]'   # omit [cyphal] for an I2C-only install
```

With **pip**, from a release wheel:

```sh
python3 -m pip install './nxs-<version>-py3-none-any.whl[cyphal]'
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
Integration & Operation Manual's first chapter; the manual ships with
the SDK release bundle.
