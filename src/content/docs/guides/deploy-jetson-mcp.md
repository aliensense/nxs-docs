---
title: "NVIDIA Jetson deployment with an AI agent"
sidebar:
  order: 7
---

`nxs mcp` offers the setup and check verbs of `nxs` to an AI agent as tools, over the Model Context Protocol (MCP), in the same words and with the same refusals. The server runs on your Jetson, which owns the buses, and the agent reaches it over ssh from your workstation, where you chat. At the end, a Claude Code session on your workstation starts the server and lists its tools.

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
| `probe` | the units that answer, on every bus or a port's | port?, link? | none (reads identity registers) | no ACK rows; unknown port lists the ports |
| `generate` | the rig as it answers: ports, hubs, links, sensors, units | dry_run? | walks every camera port and bus; with dry_run false it writes hardware.yaml (the report of what answered), seeds suite.yaml when there is none, and names a unit on a bare bus running nothing by trying every personality on it | no pack and no camera port; the wiring file is not writable |
| `status` | the declaration against the rig; a port's presence and health | port?, link? | none (reads identity and status registers) | hub does not answer |
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
The server did not start, and the usual cause is ssh asking for a password or a key passphrase that the agent cannot type. Run `ssh -i ~/.ssh/nxs-mcp <user>@<jetson>` by hand: it must start the server without a prompt, and print nothing until you interrupt it.
:::

:::tip[Other clients]
Claude Desktop, and any MCP client that launches a command, takes the same server: the command is `ssh`, the arguments `<user>@<jetson>`, `$HOME/.local/bin/nxs`, `mcp`. An agent running on the host itself launches `nxs mcp` directly. The configuration snippets are in the [MCP Tool Reference](../../reference/nxs-mcp/).
:::

## Next steps

- Take your first box from the plug to a stream, from a chat: [Getting started with an AI agent](../unboxing-mcp/).
- See what each tool touches and when it refuses, with worked prompts, in the [MCP Tool Reference](../../reference/nxs-mcp/).
