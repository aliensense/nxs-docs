---
title: "NVIDIA Jetson deployment with an AI agent"
sidebar:
  order: 7
---

`nxs mcp` offers the setup and check verbs of `nxs` to an AI agent as tools, over the Model Context Protocol (MCP). The tools use the same words and the same refusals as the verbs. The server runs on your Jetson, which owns the buses, and the agent reaches it over ssh from your workstation, where you chat. At the end, a Claude Code session on your workstation starts the server and lists its tools.

```d2 title="NVIDIA Jetson deployment with an AI agent at a glance"
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
  workstation: "Your workstation\nClaude Code, where you chat" {class: third}
  key: "ssh key ~/.ssh/nxs-mcp\ncommand=\"nxs mcp\", no forwarding, no terminal" {class: data}
  jetson: "Jetson, deployed\nnxs mcp serves the tools" {class: open}
  buses: "The camera buses\nthe Jetson owns them" {class: hw}
  workstation -> key: "claude mcp add nxs"
  key -> jetson: "ssh <user>@<jetson>"
  jetson -> buses: "the same verbs, the same refusals"
}

do: "What you do" {
  class: group
  direction: down
  s1: "1. Serve the tools on your Jetson\npipx inject aliensense-nxs 'aliensense-nxs[mcp]'" {class: step}
  s2: "2. Register the server with Claude Code\nssh-keygen, authorized_keys, claude mcp add nxs" {class: step}
  s1 -> s2
}

have: "What you have" {
  class: group
  grid-columns: 1
  grid-gap: 30
  tools: "A Claude Code session that starts the server\nand lists its 20 tools" {class: result}
}
```

## What you need

- **Jetson**: set up with the [NVIDIA Jetson deployment guide](../deploy-jetson/) and reachable over ssh.
- **Workstation**: Claude Code installed, and a dedicated ssh key for the agent, which you make in step 2.
- **Time**: 5 minutes.

## 1. Serve the tools on your Jetson

`nxs mcp` needs one extra on top of `nxs`, the MCP library. On your Jetson, add the extra to the `nxs` install:

```sh
orin$ pipx inject aliensense-nxs 'aliensense-nxs[mcp]'
```

Then print the server's reference table, which shows what each tool touches on the hardware and when it refuses:

```sh
orin$ nxs mcp --doc-table
```

```
| Tool | Purpose | Arguments | Hardware effect | Refuses when |
|---|---|---|---|---|
| `probe` | the units that answer, on every bus or a port's | port?, link? | none (reads identity registers) | no ACK rows, or an unknown port, which lists the ports |
| `generate` | the rig as it answers: ports, hubs, links, sensors, units | dry_run? | walks every camera port and bus. With dry_run false it writes hardware.yaml, the report of what answered, and seeds suite.yaml when there is none. It writes a declaration of api 2 or the 1.0 form again in api 3, the earlier file kept beside it. A unit on a bare bus running nothing is named by trying every personality on it | no hub and no camera port, or the wiring file is not writable |
| `status` | the declaration against the rig, or a port's presence and health | port?, link? | none (reads identity and status registers) | hub does not answer |
...
```

The agent reads this table as its reference before it acts. A printed table proves the extra is installed. Without the extra, `nxs mcp` says so and exits.

## 2. Register the server with Claude Code

On your workstation, make an ssh key for the agent alone:

```sh
host$ ssh-keygen -t ed25519 -N '' -f ~/.ssh/nxs-mcp
```

Then restrict the key to the server on your Jetson. Whatever command a client asks for, ssh then runs `nxs mcp` and nothing else, with no forwarding and no terminal. ssh logs in to your Jetson once to add the key there:

```sh
host$ printf 'command="$HOME/.local/bin/nxs mcp",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' "$(cat ~/.ssh/nxs-mcp.pub)" | ssh <user>@<jetson> 'cat >> ~/.ssh/authorized_keys'
```

Then tell Claude Code on your workstation to start the server over that key whenever a session opens:

```sh
host$ claude mcp add nxs -- ssh -i ~/.ssh/nxs-mcp <user>@<jetson>
```

Open a session:

```sh
host$ claude
```

The `command=` option on the key runs the server by its full path, so the client asks for no command and ssh runs no profile. An agent has no need for a key that could run anything on your Jetson.

In the session, ask the agent what it can do:

```
What nxs tools do you have?
```

```
20 tools: probe, generate, status, identify, samples, caps, on, off, capture, get,
set, suite_get, suite_schema, suite_set, switch, reload, freeze, upload,
host_info, host_modes.
```

The agent lists the 20 tools the server offers. Listing them starts the server and touches nothing else.

:::note[No tools listed, or `Connection closed`]
The server did not start. The usual cause is ssh asking for a password or a key passphrase that the agent cannot type. Run `ssh -i ~/.ssh/nxs-mcp <user>@<jetson>` by hand: it must start the server without a prompt, and print nothing until you interrupt it.
:::

:::tip[Other clients]
Claude Desktop, and any MCP client that launches a command, takes the same server: the command is `ssh`, the arguments `<user>@<jetson>`, `$HOME/.local/bin/nxs`, `mcp`. An agent running on the host itself launches `nxs mcp` directly. The configuration snippets are in the [MCP Tool Reference](../../reference/nxs-mcp/).
:::

## Next steps

- Take your first box from the plug to a stream, from a chat: [Getting started with an AI agent](../unboxing-mcp/).
- See what each tool touches and when it refuses, with worked prompts, in the [MCP Tool Reference](../../reference/nxs-mcp/).
