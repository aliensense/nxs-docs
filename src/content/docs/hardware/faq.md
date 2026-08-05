---
title: "NXS — Frequently Asked Questions"
sidebar:
  order: 4
# Copied from als-docs marketing/NXS (NXS_FAQ.md) at 72b40d8; als-docs copy retires after the site review.
---

**Version:** 0.7
**Last Modified:** August 5, 2026
**Status:** Draft for website FAQ section

> Sources: [als-docs/legal](https://github.com/aliensense/als-docs/tree/main/legal) (Terms of Sale v1.3, Legal FAQ v1.4), [als-docs/marketing/NXS](https://github.com/aliensense/als-docs/tree/main/marketing/NXS) (Product Description v0.3, Specs v0.1, User Datasheet v0.5), GTM communication (`mikroe-click-ros2-bridge.md`).
> Answers marked **[VERIFY]** are unvalidated claims carried over from the demand-test copy — confirm before publishing.

---

## Table of Contents

1. [Product & Use Cases](#product--use-cases)
2. [Sensors, Drivers & Integration](#sensors-drivers--integration)
3. [Competitive](#competitive)
4. [Orders, Warranty & Support](#orders-warranty--support)

---

## Product & Use Cases

### What is NXS?

NXS is a compact node that connects any MikroElektronika Click sensor (mikroBUS) or MIPI camera to your robot or autonomous system over a single long-distance cable. It handles the hardware interface, driver layer, and data transport — so your team works with sensor data.

### What are the two connection modes?

Same board, two modes:

- **GMSL — up to 15 m.** A single coax carries power, video, and sensor data together. For camera + sensor setups where both need to run over one cable.
- **CAN-FD — up to 40 m** (at reduced data rate). Sensor data only, no video. For distributed sensor networks across a chassis or structure.

### Who is NXS for?

Teams in robotics, autonomous vehicles, industrial automation, and research who need sensors or cameras placed away from the main compute unit — without writing firmware, porting drivers, or fighting cable-length limits. You don't need a firmware engineer on the team: plug in a Click board or MIPI camera, and the data arrives on your host in SI units, timestamped, ready to use.

### What are typical use cases?

- **Move an existing MIPI camera to GMSL distance** — keep your current camera module, place it up to 15 m from compute over a single coax, with power on the same cable. No camera redesign, no USB extenders.
- Sensor cable runs past USB's 5 m wall (robot arms, AGVs, chassis-length runs)
- Heterogeneous sensor mixes (IMU + distance + environmental + camera) on one integration path
- Camera + sensor over a single coax (GMSL with Power-over-Coax)
- Distributed sensor networks across a structure (CAN-FD, multi-node)

### Can I use NXS for camera only, or sensors only?

Yes. The two functions are independent: the video path is hardware serialization, and the sensor co-processor is firmware on the STM32 driving the mikroBUS socket. A unit can be deployed for video only, sensors only, or both.

### What do I need on the robot/host side — is anything else required?

That depends on which connector your robot or host computer has. Three cases:

- **Your robot has a GMSL connector (deserializer):** connect NXS directly over the coax. You get **both video and sensor data** on that single cable — no extra units, no additional hardware.
- **Your robot has only a CAN connector:** connect NXS over CAN-FD. Video cannot travel over CAN, but **sensor data** is delivered in full — SI-unit samples, microsecond timestamps, multi-node addressing. No extra hardware needed.
- **Your robot has only a UART port:** connect UART-to-UART (Cyphal/serial, 460800 baud). Same as CAN — **sensor data only, no video**. No extra hardware needed.
- **You want video but have no GMSL on the host:** you need the **NXS Hub** — a separate device that sits between your NXS nodes and the host computer. The Hub:
  - **Aggregates multiple GMSL streams** from NXS nodes and forwards the data to the host over MIPI.
  - **Supplies power** to the link (Power-over-Coax for the connected nodes).
  - **Hosts smart extension boards** through a dedicated Molex connector — add-on boards that preprocess data at the edge before it reaches the host. **[VERIFY — extension board specs, Molex part, supported preprocessing functions]**
  - **Protects the GMSL line from overvoltage**, keeping both your NXS nodes and your host hardware safe from electrical faults on the cable run.

One Hub serves multiple NXS nodes; you need one per host, not one per sensor. **[VERIFY — max number of NXS nodes per Hub]**

### Is NXS a development tool or production-ready?

NXS is an evaluation and prototyping module. It is **not** certified for safety-critical applications — including automotive safety systems, direct life support or medical devices, weapons systems, or any application where product failure could directly lead to death, personal injury, or severe physical or environmental damage. If you integrate NXS into a final product for commercial deployment, you are responsible for all certifications and regulatory approvals for that final product.

---

## Sensors, Drivers & Integration

### Which sensors work out of the box?

Eight sensor families ship with validated drivers, including the `iam20680` 6-axis IMU, the `ms5611` barometer/altimeter (Altitude 6 Click), and the `fxos8700` 6DOF eCompass (6DOF IMU 3 Click). The full validated-driver list is published with each release. **[VERIFY — complete supported list at launch]**

### What about a Click board that isn't on the list?

For any other mikroBUS Click sensor on I²C, SPI, UART, AN, or PWM, the **AI-agent skill generates the driver**. A driver is authored as a small Python class, compiled to a portable NXS image on your host, and uploaded to the device — the sensor's datasheet becomes the code. The device firmware itself is never rebuilt.

### Do I need to write firmware?

No. The driver is not compiled into firmware. The on-device virtual machine probes the sensor (cold-reset, WHO_AM_I check), configures it, and produces fixed-size samples. You upload a driver image; you never touch MCU firmware.

### Can I swap a sensor without recompiling anything?

Yes — pull one Click board, seat the next one, upload the matching driver image with the `nxs` tool. No recompile of device firmware.

### In what units do I get my data?

Physical SI units. Every driver declares per-field name, type, scale, offset, and unit — and samples are projected onto standard `uavcan.si.sample.*` subjects: acceleration (m/s²), angular velocity (rad/s), magnetic field (T), temperature (K), pressure (Pa). You decode samples to SI without holding the driver file.

### How fast can I stream samples?

Up to 250 Hz sustained over the serial link. Cyphal/CAN-FD runs 1 Mbit/s arbitration / 4 Mbit/s data with a 64-byte MTU.

### Does NXS work with ROS 2?

Yes. NXS publishes as a Cyphal node over CAN-FD or serial, and the `nxs` host tool bridges that output to ROS 2 topics on your host platform. Pre-built ROS 2 nodes publish microsecond-timestamped topics.

### What if I don't use ROS 2?

Two built-in paths, no ROS 2 required:

- **I²C register map over the GMSL tunnel** — samples, parameters, driver store, commissioning, and firmware update all work over the single coax path, without a CAN bus, serial cable, or Cyphal.
- **Cyphal (OpenCyphal) over CAN-FD or serial** — a standards-compliant node; stock tools like `yakut` and `yukon` work alongside ours.

Both work at the same time; use either or both.

### What is the `nxs` tool?

A single cross-transport host CLI (and Python SDK, `NxsClient`) that drives every operation over I²C, Cyphal/serial, or Cyphal/CAN: probe, upload/compile a driver, run/stop, read parameters and outputs, stream decoded samples, manage the driver store, set decimation, commission node-ID and subject-IDs, and push firmware.

### Can I run multiple NXS nodes on one bus?

Yes. Node-ID range is 0–127 (default 125), and subject-IDs are writable, persistent registers you can re-commission per node. Sharing a subject-ID across identical boards is intended.

### How is firmware updated?

Over the same host transports, via the `nxs` tool — including a recovery path if an update is interrupted.

### Is any of the software open source?

NXS includes open-source components, provided as-is under their respective licenses — see our [Third Party Licenses](/legal/third-party-licenses). The NXS application software is licensed under our [Software License Agreement](/legal/software-license).

### What if mikroBUS isn't enough — can I connect my own hardware?

Yes. Alongside the mikroBUS socket, NXS exposes an **auxiliary board-to-board connector** (X2, 30-pin DF40) that breaks out the MCU's interfaces directly: UART (USART3), the mikroBUS signal set (SPI, I²C, UART, PWM, AN, INT, RST), and fused 5 V power.

Use it to attach hardware the mikroBUS form factor can't host — for example:

- **VPU / AI accelerator modules** — offload vision inference at the sensor edge and let the results ride the same GMSL/CAN-FD link back to the host.
- **FPGA daughterboards** — custom preprocessing, triggering, or protocol handling ahead of the NXS co-processor.
- **Custom sensor front-ends** — any design that needs direct MCU UART/SPI/I²C access plus power, without conforming to the Click board outline.

The auxiliary board communicates with the NXS compute board over the same signals the mikroBUS socket uses, so the driver model, host transports (I²C register map, Cyphal), and the `nxs` tooling apply unchanged. Pinout and mating-connector details are in the NXS User Datasheet.

### What are the key specs?

| Parameter | Spec |
|---|---|
| Upstream link | GMSL3/2 (up to 15 m) and/or CAN-FD (up to 40 m) |
| Sensor interface | mikroBUS Click socket (SPI / I²C / UART / PWM / AN / INT / RST) |
| Image sensor | DF40 60-pin, MIPI CSI-2 (2 or 4 lane) |
| MCU | STM32G491 (Cortex-M4F @ 160 MHz) |
| Power input | 12 V (4.7–16 V tolerant); Power-over-Coax on GMSL |
| Timestamping | Microsecond per-sample timestamps (local clock); host-time translation via the bridge's synced stamps |
| Dimensions | 30 × 40 × 28 mm, 21 g |
| Housing | 6061 aluminum alloy, 4 × M2 mounting |

### What environment can it handle?

- Operating temperature: **−40 °C to +85 °C** (industrial grade)
- Storage: −40 °C to +125 °C
- ESD: ±2 kV (human-body model, connectors); ESD-protected high-speed lanes
- Automotive-grade FAKRA connectors and CAN transceiver

Handle the board by its edges, store it ESD-safe and dry, and protect it from moisture, conductive debris, and mechanical shock during operation.

### How is it powered?

From a 12 V source (tolerant 4.7–16 V) — no bench supply required in the field. On the GMSL link, the remote serializer side is powered by Power-over-Coax over the same single coax that carries video and sensor data.

### Will the link hold 15 m in a noisy (EMI) environment?

GMSL-class links are designed for automotive EMI environments, which are harsher than most robot installations. If the link does not hold in your environment, standard warranty/return terms apply.

### What certifications does NXS have?

CE / FCC Part 15B (Class A) / RoHS / WEEE — status per the product page. 

---

## Competitive

### How is NXS different from USB?

USB hits a hard wall at ~5 m, and the only fix the ecosystem offers is a shorter, higher-quality cable. NXS runs a single cable 15 m (GMSL) or 40 m (CAN-FD) — with power and data on the same line.

### How is NXS different from micro-ROS?

With micro-ROS you write the firmware yourself, serial reach is ~1 m, and community-reported failure modes include sessions that drop silently with no error or warning. With NXS the driver layer is pre-written (or AI-generated for new Clicks), reach is 15–40 m, and the node is a standard Cyphal citizen.

### How is NXS different from camera bridges (Arducam, e-con Systems, Luxonis OAK)?

Those are camera-only solutions — and with several of them you still write the ROS 2 wrapper yourself, or go through an OEM sales cycle instead of buying a board. NXS covers heterogeneous sensors (IMU, distance, environmental…) *and* camera, with the driver layer included. If you genuinely need camera-only at 15 m and nothing else, a camera-only SKU may serve that single job directly.

### How is NXS different from a CAN adapter (e.g. PEAK PCAN-USB)?

A CAN-USB adapter moves CAN frames to a host and leaves the ROS 2 wrapper to you. NXS *is* the sensor node: it acquires the sensor, timestamps samples in hardware, publishes standard SI subjects, and bridges to ROS 2 topics — no wrapper to build or maintain.

### Can I use MikroElektronika's own toolchain instead?

Mikroe's toolchain targets their own compilers (C, Basic, Pascal). NXS keeps the Click ecosystem you already own and adds the missing layer: long-distance transport plus pre-written drivers into ROS 2 / Cyphal.

---

## Orders, Warranty & Support

### How do I place an order?

Order through the product page, or contact sales@aliensense.com for quotations and volume orders. A quotation is valid for 30 days. An order is accepted when we issue a written order confirmation or deliver the products.

### What payment methods do you accept?

Major credit cards and bank transfer (business customers). Payment details are provided at checkout or on your quotation.

### Do you charge VAT?

Prices are exclusive of VAT, which is added at the applicable rate (currently 5% in the UAE). Business customers: provide your Tax Registration Number for VAT invoicing.

### What are the shipping options and delivery times?

- Standard international: 5–10 business days
- Express international: 2–5 business days

Costs are calculated at checkout by destination and weight. Delivery dates are estimates; risk passes to you upon delivery to the carrier.

### Do you ship internationally?

Yes, to most countries worldwide. We cannot ship to countries under  sanctions, and some products may have export restrictions — we comply with UAE, US, and EU export control laws. You are responsible for import duties, taxes, and customs fees; we provide accurate customs documentation.

### Can I cancel or modify my order?

- **Before shipping:** yes — contact orders@aliensense.com or +971 50 660 5479; we process within 1 business day.
- **After shipping:** the order cannot be cancelled; you can refuse delivery or return after receipt (see returns below).

### Do you offer educational or volume discounts?

Yes — contact sales@aliensense.com with your institution or volume requirements.

### If the price changes after I order?

If we increase the price after order acceptance but before delivery, you may cancel within 7 days of notice for a full refund. If we reduce the price within 14 days of delivery, you may request a refund of the difference within 14 days of the change (not applicable to limited-time promotions).

### What warranty does NXS carry?

Standard warranty: **1 year from delivery** (some products 2 years — check the product page), covering defects in materials and workmanship under normal use. Remedy: repair, replacement, or refund, at our option.

Not covered: misuse, abuse, accidents, negligence; unauthorized modification or repair (the warranty applies to the Unmodified Product); use in unsuited applications; normal wear and tear; consumables; improper installation or operation outside specifications; acts of nature.

### How do I make a warranty claim?

- **Web:** [aliensense.com/warranty](https://aliensense.com/warranty)
- **Email:** support@aliensense.com

Include: your contact details; pickup and ship-to addresses; product model, serial number, and invoice; a description of the issue; and whether you need an **immediate replacement**. We arrange pickup of the defective unit at our expense and ship the repaired/replacement unit back at our expense. If you request immediate replacement, we ship the replacement first and collect the defective unit afterward. Claims must be reported within 30 days of discovering the problem.

### Can I return a product if I'm not satisfied?

**Defective or non-conforming products:** contact us within 14 days of delivery for a return authorization; products must be in original condition, unused.

**Standard (non-defective) returns:** 30 days from delivery; unused, original packaging, all accessories; 15% restocking fee; customer pays return shipping; refund within 10 business days of receipt and inspection. Note: products are sold B2B, so the 14-day consumer return right does not apply.

**Non-returnable:** custom or made-to-order products; software licenses once activated; products damaged by the customer or missing original packaging/accessories.

To start a return: email returns@aliensense.com with your order number and reason; we'll issue an RMA number and instructions.

### What if my product arrives damaged?

1. Photograph the damaged product and packaging.
2. Keep all packaging.
3. Email support@aliensense.com within **48 hours** of delivery with your order number, photos, and a description.
4. We send a replacement or issue a full refund, including shipping costs.

### How do I get technical help?

- **Email:** support@aliensense.com
- **Docs & downloads:** product documentation, datasheets, and the `nxs` tooling on the product page

### Do you provide design consultation?

Yes — contact sales@aliensense.com for custom development and OEM/design-in inquiries.

### Where can I find the full specifications?

The **NXS User Datasheet** (integrator-level: electrical ratings, connector pinouts, register map, driver catalog) is available on the product page alongside the compliance documents (CE DoC, RoHS, FCC).

### Still have questions?

- General: info@aliensense.com · +971 50 660 5479
- Sales: sales@aliensense.com · Orders: orders@aliensense.com · Returns: returns@aliensense.com
- Aliensense Limited, Masdar City, Abu Dhabi, United Arab Emirates

---

<div hidden>

## Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-07-23 | Initial draft. Sources: als-docs legal (Terms of Sale v1.3, Legal FAQ v1.4), marketing/NXS (Product Description v0.3, Specs v0.1, User Datasheet v0.5), NXS GTM communication. Sections: Product & Use Cases, Sensors & Drivers, Integration & Software, Hardware & Environment, Competitive, Orders/Pricing/Shipping, Warranty & Returns, Support. Unvalidated claims tagged [VERIFY]. |
| 0.2 | 2026-07-23 | Copy review: removed filler/marketing phrases ("No firmware rebuild, no return to us", "hassle-free", "No CAN bus, no serial cable, no Cyphal", "just use"); folded facts into plain statements. |
| 0.3 | 2026-07-23 | Restructured from 8 sections to 4 (Product & Use Cases; Sensors, Drivers & Integration; Competitive; Orders, Warranty & Support). Added "move an existing MIPI camera to GMSL distance" as lead use case. Rewrote "Who is NXS for" around effort removed (no firmware, no driver porting, no cable-length fights). |
| 0.4 | 2026-07-23 | Added "What if mikroBUS isn't enough" Q&A on the auxiliary board-to-board connector (X2, 30-pin DF40: MCU UART, mikroBUS signal set, fused 5 V) for attaching VPUs, FPGA daughterboards, and custom front-ends. Pinout claim tagged [VERIFY]. |
| 0.5 | 2026-07-23 | Added "What do I need on the robot/host side" Q&A: direct connection when the robot already has a GMSL deserializer; NXS Hub otherwise (GMSL stream aggregation → MIPI, power supply, smart extension boards via Molex connector for edge preprocessing, GMSL overvoltage protection). Hub capacity and extension-board specs tagged [VERIFY]. |
| 0.6 | 2026-07-23 | Clarified host-side connection matrix: GMSL connector → video + sensor data direct; CAN-only → sensor data via CAN-FD, no video; UART-only → sensor data via Cyphal/serial, no video; Hub required only when video is needed without a host-side GMSL deserializer. |
| 0.7 | 2026-08-05 | GMSL naming policy: plain GMSL in prose; the Analog Devices term GMSL3/2 in spec/table rows and part-adjacent text (was GMSL2/3). |

</div>
