---
title: Connectors and Pinouts
description: Centralized connector and pinout reference for RedBrain CAN/SYNC, mikroBUS, and mezzanine interfaces.
---

This page centralizes the connector-level information used most often during integration. Hardware pages link here to avoid drift.

## CAN/SYNC Connector (Thalamus A)

<details>
<summary>12-pin CAN/SYNC connector pinout</summary>

| Pin | Signal | Purpose |
|---|---|---|
| 1 | CAN_AUX_L | Auxiliary CAN-FD low |
| 2 | CAN_AUX_H | Auxiliary CAN-FD high |
| 3 | SYNC_B | Differential sync line B |
| 4 | SYNC_A | Differential sync line A |
| 5 | V_FIELD | Field power output |
| 6 | V_FIELD | Field power output |
| 7-10 | GND | Ground |
| 11 | CAN_MAIN_L | Main CAN-FD low |
| 12 | CAN_MAIN_H | Main CAN-FD high |

</details>

## mikroBUS Shuttle (Axon)

<details>
<summary>Axon mikroBUS Shuttle signals</summary>

| Pin | Signal | Purpose |
|---|---|---|
| 1 | AN | Analog input |
| 2 | RST | Reset line |
| 3 | CS | SPI chip select |
| 4 | SCK | SPI clock |
| 5 | MISO | SPI MISO |
| 6 | MOSI | SPI MOSI |
| 7 | 3V3 | 3.3 V |
| 8-9 | GND | Ground |
| 10 | 5V | 5 V |
| 11 | SDA | I2C SDA |
| 12 | SCL | I2C SCL |
| 13 | TX | UART TX |
| 14 | RX | UART RX |
| 15 | INT | Interrupt |
| 16 | PWM | PWM output |

</details>

## Mezzanine Summary

<details>
<summary>Cerebrum <-> Thalamus A interface summary</summary>

- CSI lanes for two camera channels
- Camera control I2C lines
- CAN_MAIN and CAN_AUX lines
- Sync/PPS signals for deterministic timing
- 3.3 V and 12 V extension rails plus ground returns
- USB high-speed pair for board-side MCU path

</details>

<details>
<summary>Cerebrum <-> Thalamus B interface summary</summary>

- CSI lanes for four camera channels
- Control and ID I2C lines
- CAN_MAIN and CAN_AUX lines
- Sync/PPS and auxiliary GPIO lines
- 3.3 V, 5 V, and 12 V rails with dedicated returns
- USB high-speed pair for board-side MCU path

</details>

## Integration Rules of Thumb

- Enable termination only at physical bus ends.
- Label harnesses with logical link IDs used in YAML.
- Validate pin-1 orientation before first power-on.

:::caution
Connector references here are integration-focused summaries. Use your controlled hardware release package for manufacturing and final harness release artifacts.
:::
