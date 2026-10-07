---
title: Guides
sidebar:
  order: 0
slug: v1.1.0/guides
---

For the first person who opens the box. Each guide is one hardware set
and one path through it: what you are about to do, the command, the
output it prints, and what it means. Nothing here explains what the
Reference section explains; a guide stops where a specification begins.

The chapters are numbered in the reader's order. **1. Deploy with NVIDIA
Jetson** puts the host tool on a Jetson Orin Nano, names the ports, and
connects the first unit. **2. Unboxing** takes that unit from the first
probe to a stream and a declaration, then the same commands over CAN and
serial. **3. Connect an agent** serves the tool's verbs to Claude Code
over MCP, and **4. Unboxing with an agent** repeats the first hour from a
chat. **5. Custom sensor** writes a patch from a datasheet, runs it beside
a shipped one, changes it in Python, calibrates it, and tunes it through
the agent. **6. Cameras on NVIDIA Jetson** installs the camera kernel
package, the boot table, and the descriptor pack, and **7. Dual camera**
brings two cameras up on one Hub with a unit riding link A. A chapter
never points into a section of another: a step two chapters need is its
own chapter.

These pages are mirrored from the firmware repository at every release;
fixes go to its `docs/guides/` and arrive with the next release.
