---
title: "NXS glossary"
sidebar:
  order: 8
---

Applies to: NXS v1.1 · product version 1.1.x · `nxs` tool 1.1.x

| Document set | |
|---|---|
| [Device Reference](../nxs-device-reference/) | interfaces, performance and limits, shipped personalities, versioning |
| [Interface Description](../nxs-host-interface/) | transports, register map, commands, procedures |
| [Integration & Operation Manual](../nxs-integration-manual/) | design-in, host setup, workflows |
| [Click Personality Reference](../nxs-click-personalities/) | authoring personalities for unsupported sensors |
| [Cam Personality Reference](../nxs-cam-personalities/) | describing camera chains for the camera ports |
| [MCP Tool Reference](../nxs-mcp/) | operating and configuring through an AI agent |
| **Glossary** (this document) | one word for each thing |
| [Technical Specifications](../nxs-specifications/) | capability summary tables |

One word for each thing. Every released document uses a term as this glossary defines it, and a guide defines a term in one sentence at its first use. The Not column lists the words the documents do not use for the thing.

## 1. Nouns

| Term | Definition | Not | Scope |
|---|---|---|---|
| unit | The NXS unit: a small sensor computer at the far end of a coax link, with a mikroBUS socket and a camera head connector. It runs a personality for each sensor it carries and serves samples in SI units. | NXS module, sensor module, the module, v2 module, v1.0 module, v2 modules, v1.0 modules | released |
| Hub | The GMSL deserializer board on a camera connector of the host. It carries two coax links, A and B. | deserializer board, des board, GMSL board | released |
| hub directory | The directory that describes a Hub to `nxs`: its `hub.yaml`, the facts files and programs of its deserializer and serializer, its flows and its default wiring. The wheel carries the product's own. A hub directory owns no cam personality, since every port offers every installed one. | pack, descriptor pack | released |
| owner | The node that masters a Hub's I²C bus, the one source of the hub node's `i2c` port. Only the owner writes the Hub, its pods and its heads. | | released |
| link | One of the Hub's two coax connections, A or B. | coax channel | released |
| block | One part of the graph that declares its own ports and rows: the host, a Hub, a unit, a camera, a Click or a module. The tool knows a block from its description alone. | | released |
| description | What a block offers: its identity, its ports and its rows, each row with how it reads. The records of the block's image carry it, and a unit serves its own live. `nxs describe <type>` prints it. | | released |
| node | One block of the rig in the declaration. It carries a `type`, which resolves to the block's description and fixes its kind, and its parameters. | | released |
| port | A block's connection point, with the type and direction its description declares. The host's camera connectors, `cam0` and `cam1`, are ports, and a verb names a camera chain by its connector: `nxs cam0 on`. | | released |
| port attribute | A property of a port that a row of its block states, the row named for the port: `csi_a_lanes` states the lanes of `csi.A`. Both ends of a connection agree on every attribute they state. | | released |
| connection | A declared path from one node's port to a port of another node. The declaration lists them under `connections`, keyed by the source port. | | released |
| pod | A unit at the far end of a link, with the camera head it carries and its serializer. | camera module | released |
| head | The image sensor board of a camera, the one a pod carries or one on a link or port without a unit. | sensor board, camera board | released |
| native head | A head that programs its own sensor and serves the capture cells of the map alone. Its cam personality is of the `native` law family and describes the rows and the modes it serves (host interface §6.12). | FPGA head, FPGA camera, self-programming head | released |
| smart camera | The product word for a camera built on a native head. It answers the camera door alone at `0x31` on its port's own bus, with no unit door, pod, link or Hub between it and the host. | | released |
| row | A parameter row: the 64-byte descriptor of one parameter of a block, with its name, unit, id, type, kind, flags, default and values. A block's `PARAMS` record carries one row per parameter. The map serves every running personality's rows at the unit door and a cam personality's at the camera door (host interface §4.5). | | released |
| presentation | How a row's values read: a display unit, a decimal exponent and a name per value where the values have names. The `PRESENTATION` record carries one entry per row, and the tool prints a row's values from it alone, the gain in dB for a row served in millidecibels (host interface §10.1). | | released |
| pin | An identity field a declaration asserts on a block: `address`, `serial` or `firmware`. A pin is a parameter of the node, not a row of the block. | | released |
| parameter id | The standard meaning of a parameter row, from the locked `ParamId` registry. Id `0` is a custom row, which the host offers by its name (host interface §4.5). | | released |
| trigger code | The value of a trigger row, from the locked `TriggerCode` registry. `0` is free run, `1` fast, where the pulse width is the exposure, and `2` sequential (host interface §4.5). | | released |
| commit | On the map, the one write that applies the staged rows. It runs from the highest staged row's cell through `MASK` and `COMMIT`, and its rows share one owner and one kind (host interface §6.4). | | released |
| Click | A mikroBUS board with a sensor, on the unit's socket. | click board, sensor click | released |
| Shuttle | The mikroBUS Shuttle that seats a Click on the unit's socket. | | released |
| host | The computer that runs `nxs` and owns the camera buses: a Jetson, a Raspberry Pi or a Linux workstation. | host machine, host computer | released |
| passive host | A host that takes a Hub's stream while a module owns the Hub's bus. It makes no transfer on that bus, and its overlay carries the mode table the camera door would serve. | | released |
| personality | The compiled program a unit runs for a sensor: a click personality for a Click, a cam personality for a head. It is an image in the unit's store, sealed when it ships in the assets. | sensor driver, sensor's driver | released |
| declaration | The file `suite.yaml` that names the rig in `api: 3`: its nodes, each a type with its parameters in the rows' display form, and the connections between their ports. `nxs switch` realizes it, and `nxsd` runs it at boot. | manifest, config file, suite file | released |
| assets | The sealed cam personalities, the Hub's image and the pod firmware, one download versioned with `nxs`, installed under `/opt/aliensense`. | descriptor tarball, asset bundle | released |
| store | The eight slots on a unit that hold its personalities. At boot the unit runs the first slot that holds a click personality. | slot table, flash store | released |
| slot | One place in the store, numbered 0 to 7. | | released |
| sealed image | A compiled personality or a Hub program as the assets ship it: its bytecode encrypted, run by the executor without its source. | | released |
| executor | The program that runs a sealed image. On a unit it is the VM that runs the pod's sensor, on the host it is `libnxs`. | | released |
| capture stack | The host's camera pipeline from the kernel to the frames an application reads. On a Jetson it is the kernel modules, the device tree, Argus and the ISP. | camera stack, video stack | released |
| boot table | The host's table of boot entries, `extlinux.conf` on a Jetson. `nxs switch` writes one entry in it, labelled `aliensense_gen`, with the device tree overlays of the declared ports. | | released |
| alias | The address a pod answers at behind a link, 0x32 on link A and 0x34 on link B. The link's letter fixes it, and a declaration states none. Also the stable name of a camera bus, `/dev/i2c-cam0`, that the udev rule of `nxs switch` gives a connector. | | released |
| daemon | `nxsd`, the service that brings the declared ports up at boot, keeps them at the declaration, runs the followers, and keeps the declared units disciplined and bridged to ROS 2. | background service | released |
| frame sync | The trigger pulse from the Hub that starts every exposure on both heads of a pair, at one rate. | fsync, frame synchronisation, frame synchronization, hardware sync | released |
| pair | Two heads on one Hub under frame sync, a leader and a follower, at one exposure and one gain. | | released |
| follower | The daemon's loop that copies the leader head's gain to the other head of a pair, once a frame. | slave | all |
| rig | The hardware a declaration describes: the host, its Hubs, pods and units. | | released |
| sample | One reading of a Click's outputs, in SI units, with the unit's timestamp. | | released |
| frame | One image from a head, with its timestamp, exposure and gain. | | released |

## 2. Verbs

A step uses one of these verbs, in the imperative.

| Verb | Use for | Not |
|---|---|---|
| run | a command at a shell | execute, invoke |
| write | a value, a line or a file, by hand or by a command | enter, type |
| read | a value or a line a command prints | retrieve, fetch |
| connect | a cable or a lead to its socket | hook up, attach, wire |
| seat | a board on its socket, pushed flat | mount, insert |
| plug | a connector into its port | insert |
| upload | a personality to a unit's store | flash |
| install | software or a file on the host | deploy |
| set | a parameter or a knob to a value | configure, adjust |
| save | a slot or a declaration | persist |
| reboot | the host | |
| wait | for a line, a LED state or a time | |
| check | a state, by reading it | verify, validate, confirm |
| open | a file, a page or a terminal | launch |
| edit | a file in place | modify |
| copy | a file or a line | duplicate |
| press | a key | hit |
| ask | the agent, in words | prompt, tell |

## 3. Names

A name is written as the product writes it, and it may open a sentence in lower case.

| Name | Kind |
|---|---|
| `nxs` | the host tool and its command |
| `nxsd` | the daemon |
| `libnxs` | the runtime library |
| `pip` | Python's installer |
| `pipx` | the installer that gives `nxs` an environment of its own |
| `uv` | the installer the manual's quick start uses |
| `systemd` | the host's service manager |
| `udev` | the host's device manager |
| `apt` | the host's package manager |
| `ssh` | the remote shell |
| `yakut` | the Cyphal command-line tool |
| `ros2` | the ROS 2 command |

## 4. Technical terms

A technical term is one phrase, as the field names it, and passes the word rules whole.

| Term | Note |
|---|---|
| map | the one flat register map a unit serves at two I²C addresses, with a 16-bit pointer and no selector. It carries the header, the parameter rows with their values and ranges, the commit cells, the mode table, the output rows and the unit's regions (host interface §4) |
| unit door | the unit's first I²C address, 0x30, where the map serves every cell: the tool's and the daemon's door |
| camera door | the unit's second I²C address, 0x31, where the map serves the capture cells alone, the capture stack's door to the device. The only door a smart camera serves |
| edge enhancement | the ISP stage that sharpens edges |
| noise reduction | the ISP stage that filters noise |
