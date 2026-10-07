---
title: NXS glossary
sidebar:
  order: 8
slug: v1.1.0/reference/nxs-glossary
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
| link | One of the Hub's two coax connections, A or B. | coax channel | released |
| port | A camera connector of the host that a Hub or a direct camera sits on, named `cam0` or `cam1`. | | released |
| pod | A unit at the far end of a link, with the camera head it carries and its serializer. | camera module | released |
| head | The image sensor board of a pod. | sensor board, camera board | released |
| Click | A mikroBUS board with a sensor, on the unit's socket. | click board, sensor click | released |
| Shuttle | The mikroBUS Shuttle that seats a Click on the unit's socket. | | released |
| host | The computer that runs `nxs` and owns the camera buses: a Jetson, a Raspberry Pi or a Linux workstation. | host machine, host computer | released |
| personality | The compiled program a unit runs for a sensor: a click personality for a Click, a cam personality for a head. It is an image in the unit's store, sealed when it ships in the assets. | sensor driver, sensor's driver | released |
| declaration | The file `suite.yaml` that names the rig: its ports, links, pods, units and personalities. `nxs switch` realizes it, and `nxsd` runs it at boot. | manifest, config file, suite file | released |
| assets | The sealed cam personalities, the Hub's and the serializer's images and the pod firmware, one download versioned with `nxs`, installed under `/opt/aliensense`. | descriptor tarball, asset bundle | released |
| store | The eight slots on a unit that hold its personalities. At boot the unit runs the first slot that holds a click personality. | slot table, flash store | released |
| slot | One place in the store, numbered 0 to 7. | | released |
| sealed image | A compiled personality or a Hub program as the assets ship it: its bytecode encrypted, run by the executor without its source. | | released |
| executor | The program that runs a sealed image. On a unit it is the VM that runs the pod's sensor, on the host it is `libnxs`. | | released |
| capture stack | The host's camera pipeline from the kernel to the frames an application reads. On a Jetson it is the kernel modules, the device tree, Argus and the ISP. | camera stack, video stack | released |
| boot table | The host's table of boot entries, `extlinux.conf` on a Jetson. `nxs switch` writes one entry in it, labelled `aliensense_gen`, with the device tree overlays of the declared ports. | | released |
| alias | The address a unit answers at behind a link, `alias: 0x31` in the declaration. Also the stable name of a camera bus, `/dev/i2c-cam0`, that the udev rule of `nxs switch` gives a port. | | released |
| daemon | `nxsd`, the service that brings the declared ports up at boot, keeps them at the declaration and runs the followers. | background service | released |
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
| edge enhancement | the ISP stage that sharpens edges |
| noise reduction | the ISP stage that filters noise |
