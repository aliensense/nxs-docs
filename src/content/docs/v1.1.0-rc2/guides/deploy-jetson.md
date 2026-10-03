---
title: NVIDIA Jetson deployment guide
sidebar:
  order: 2
slug: v1.1.0-rc2/guides/deploy-jetson
---

Your Jetson Orin Nano developer kit, freshly flashed with JetPack 6.2.1 or JetPack 7.2.1, owns the buses your NXS hardware answers on, so the `nxs` host tool runs there. At the end your Jetson has `nxs`, the camera kernel package, the programs for your camera hardware, and a bus with a stable name on each of its two camera connectors, with nothing connected yet. You run every command in a terminal on the Jetson, over ssh or on its desktop.

## What you need

* **Hardware**: a Jetson Orin Nano developer kit flashed with JetPack 6.2.1 or JetPack 7.2.1, on the network, with a terminal.
* **Network**: a connection for `pipx` to fetch the host tool, or the offline bundle for your JetPack from the [release page](https://github.com/aliensense/nxs/releases/latest), which holds the wheel, the kernel package and the assets.
* **Software**: on JetPack 7.2.1, NVIDIA's camera hotfix package, a 4.5 MB download you fetch in step 3.
* **Time**: about 25 minutes, most of it spent on downloads and one reboot.

## 1. Install the host tool

`nxs` is one Python package with a compiled core, and `pipx` installs it for your user without touching the system Python. Install `pipx`:

```sh
sudo apt install -y pipx
```

Then install the host tool with it:

```sh
pipx install --system-site-packages aliensense-nxs
```

```
  installed package aliensense-nxs 1.1.0, installed using Python 3.12.3
  These apps are now globally available
    - nxs
    - nxsd
done! ✨ 🌟 ✨
```

The output lists the two commands the package installs: `nxs` and the `nxsd` daemon. If `pipx` adds a note that `~/.local/bin` is not on your `PATH`, leave it: Ubuntu puts that directory on your `PATH` at your next login once it exists, and you log in again below. The `--system-site-packages` flag keeps Ubuntu's GStreamer bindings visible to the camera viewer. If your Jetson is offline, unpack the bundle and install its wheel the same way: `pipx install --system-site-packages ./aliensense_nxs-1.1.0-py3-none-manylinux_2_35_aarch64.whl`.

Your NXS hardware answers on I²C buses, and the bus device nodes belong to the `i2c` group. Add yourself to that group so `nxs` can reach the hardware without `sudo`:

```sh
sudo usermod -aG i2c "$USER"
```

Log out and back in, because the `i2c` group and `pipx`'s `~/.local/bin` apply to new logins. Then check the install:

```sh
nxs --version
```

```
nxs 1.1.0 (v1.1.0)
```

`nxs` reports version 1.1.0 and runs from your path.

## 2. Install the camera kernel package

The Hub is the GMSL deserializer board that plugs into one of your Jetson's camera connectors. A link is one of the Hub's two coax connections, A and B. JetPack's kernel does not know the Hub's video path. Two kernel modules and a set of device tree overlays teach it the deserializer and the sensors on each link.

The modules and overlays ship as one Debian package per Jetson Linux release, named after that release. On JetPack 7.2.1, which is Jetson Linux 39.2.1, download the package:

```sh
curl -fsSLO https://github.com/aliensense/nxs-jetson/releases/download/39.2.1/nxs-jetson_39.2.1_arm64.deb
```

Then install it:

```sh
sudo apt install ./nxs-jetson_39.2.1_arm64.deb
```

apt may end with `N: Download is performed unsandboxed as root as file '…/nxs-jetson_39.2.1_arm64.deb' couldn't be accessed by user '_apt'`. The note is harmless: apt's own `_apt` user cannot read a package in your home directory, so apt reads it as root, and the package installs the same.

On JetPack 6.2.1, which is Jetson Linux 36.4.4, download the package:

```sh
curl -fsSLO https://github.com/aliensense/nxs-jetson/releases/download/36.4.4/nxs-jetson_36.4.4_arm64.deb
```

Then install it:

```sh
sudo apt install ./nxs-jetson_36.4.4_arm64.deb
```

On either JetPack, check the install:

```sh
dpkg -s nxs-jetson | grep -E '^(Package|Version|Status)'
```

```
Package: nxs-jetson
Status: install ok installed
Version: 39.2.1
```

`install ok installed` tells you the package is in place, and `Version` matches your Jetson Linux release, `36.4.4` on JetPack 6.2.1. The package's modules are built for that release's kernel and no other. `uname -r` prints `5.15.148-tegra` on JetPack 6.2.1 and `6.8.12-1021-tegra` on JetPack 7.2.1, and the install refuses a package built for the other release. The package installs the modules and overlays only. `nxs switch` writes the boot entry that loads them: in step 5 the overlay that starts the camera buses, and the camera tables once you declare a camera. The declaration is the file `suite.yaml`, where you describe how you want your hardware set up.

If you see `no camera kernel package for 6.8.12-1021-tegra`, your Jetson booted a kernel without the package, so install the package with the commands above. `nxs switch` and `nxs <port> status` print this message, with the `sudo apt install` line as the next step.

## 3. Install NVIDIA's camera hotfix (JetPack 7.2.1)

If your Jetson runs JetPack 6.2.1, it does not need the hotfix, so skip this step. On JetPack 7.2.1 the capture daemon refuses its configuration mode, which the tool runs to build a camera port's tuning when the port comes up. A port is a camera connector on your Jetson, named `cam0` or `cam1`. You restore the mode with a camera hotfix from NVIDIA's public Jetson Customer IQ Migration Tools package. Download the package:

```sh
curl -fsSLO https://developer.download.nvidia.com/embedded/L4T/r39_Release_v2.1/Jetson_customer_iq_migration_tools_r39.2.1_JP_7.2.1_GA.zip
```

Check the download against its SHA-256 digest:

```sh
echo "15976d2e1cdd78d042436c50d743233e101a647b1515ec04517398c5a5b2118c  Jetson_customer_iq_migration_tools_r39.2.1_JP_7.2.1_GA.zip" | sha256sum -c
```

```
Jetson_customer_iq_migration_tools_r39.2.1_JP_7.2.1_GA.zip: OK
```

`OK` means the file is the one NVIDIA published. Unpack it:

```sh
unzip -q Jetson_customer_iq_migration_tools_r39.2.1_JP_7.2.1_GA.zip
```

Keep a copy of the stock camera library, outside the directories the library loader scans. The copy is your way back to NVIDIA's stock library if you remove the hotfix: copy it back over `/usr/lib/aarch64-linux-gnu/nvidia/libnvscf.so` and run `sudo ldconfig`. `nxs` never reads it.

```sh
sudo cp -a /usr/lib/aarch64-linux-gnu/nvidia/libnvscf.so /var/backups/libnvscf.so.stock
```

Unpack the hotfix over the system:

```sh
sudo tar -xjf Jetson_customer_iq_migration_tools/camera_hotfix/camera_hotfix.tbz2 -C / --no-same-owner --no-overwrite-dir
```

Refresh the library cache:

```sh
sudo ldconfig
```

Restart the capture daemon on the patched library:

```sh
sudo systemctl restart nvargus-daemon
```

Then check that the hotfix files are in place:

```sh
ls /usr/sbin/nvcfg2nito /var/nvidia/nvcam/settings/template.nito
```

```
/usr/sbin/nvcfg2nito  /var/nvidia/nvcam/settings/template.nito
```

The `ls` output shows both files in place. The tarball replaces the capture daemon's camera library and adds the converter that the tuning build runs. The stock library stays in `/var/backups/libnvscf.so.stock`.

If you see `the capture daemon's configuration mode on L4T 39.2.1 needs NVIDIA's camera hotfix (/usr/sbin/nvcfg2nito is absent)`, your Jetson is missing the hotfix, so install it with the commands above. `nxs switch` and `nxs <port> status` print this message once a camera port is declared, and the line under it tells you to install the hotfix.

## 4. Install the assets

The assets are one download, separate from `nxs` and versioned with it, that holds the programs for your camera hardware. An NXS unit is a small sensor computer that runs a sensor's program on its own processor. A pod is an NXS unit at the far end of a link, with the camera head it carries. A camera personality is the program for one image sensor, and the NXS unit on the camera's pod runs it. The Hub's and the serializer's programs are images that `nxs` runs on your Jetson. The assets also carry the pod firmware and the license.

Install them with `nxs assets install`, which fetches the set for its own version:

```sh
nxs assets install
```

```
fetching https://github.com/aliensense/nxs/releases/download/v1.1.0/nxs-assets-1.1.0.tar.gz
Accept the license? [y/N] y
installed the assets 1.1.0 under /opt/aliensense
```

The last line tells you that version 1.1.0 of the assets is installed under `/opt/aliensense`. The assets always carry the version of your `nxs`: `nxs assets install` fetches the set for that version, and `nxs` refuses assets of another release. `nxs` asks you to accept the license once per host. If your Jetson is offline, download `nxs-assets-1.1.0.tar.gz` from the release page and pass its path: `nxs assets install ~/nxs-assets-1.1.0.tar.gz`.

If you see `assets 1.0.3 in nxs-assets-1.0.3.tar.gz, tool 1.1.0`, `nxs` refused the tarball because it belongs to another release. Download `nxs-assets-1.1.0.tar.gz`, which matches your `nxs` version.

## 5. Start the camera buses

Each camera connector reaches the NXS hardware through an I²C multiplexer on the carrier board, and a stock JetPack does not start it, so the connectors have no bus yet. The camera kernel package carries the multiplexer as a device tree overlay, which applies at boot. Your Jetson also numbers its I²C buses by boot order, and the numbers can change between boots. The `nxs` udev rule gives each connector's bus a stable name, `/dev/i2c-cam0` and `/dev/i2c-cam1`, so the port names hold from one boot to the next. Run `nxs switch`, which installs both with everything else your Jetson needs. With nothing declared yet, it installs only the host's files and the multiplexer's boot entry, and asks for your password once per root step:

```sh
nxs switch
```

```
host: state store /var/lib/aliensense
host: declaration directory /etc/aliensense
host: udev rules installed
host: tab completion installed
host: nxsd enabled
host: camera bus mux installed under aliensense_gen (FDT /boot/dtb/kernel_tegra234-p3768-0000+p3767-0005-nv-super.dtb)
REBOOT NEEDED
```

The `host:` lines list what `nxs switch` set up, including the udev rules that name the ports. The declaration directory, `/etc/aliensense`, is where your declaration goes: the file that describes your hardware, which `nxsd` reads at boot. The directory belongs to the `i2c` group, so you write there without `sudo`. On an image that carries Ubuntu's crash reporter, a further line reads `host: the capture daemon's crash reports quieted`: it keeps the crash reporter from raising a dialog each time `nxs` restarts the daemon. JetPack 7.2.1 carries none, and prints no such line. Tab completion covers every verb, flag and argument choice in the next shell you open. If you use zsh, it reads the same completion file after you run `autoload -U bashcompinit && bashcompinit`. The camera bus line names the boot entry `nxs` wrote, `aliensense_gen`, and the device tree it boots, your module's own. `aliensense_gen` is now the default entry, and your stock entry stays beside it in `/boot/extlinux/extlinux.conf`. `REBOOT NEEDED` tells you the buses exist only once the entry has booted, so reboot:

```sh
sudo reboot
```

:::note[The boot entry names no FDT]
If `nxs switch` stops with `host: the boot entry names no FDT and …`, `nxs` could not tell which of your module's device trees your Jetson boots. The line lists the candidates. Name yours with `nxs switch --fdt <dtb>`, where `<dtb>` is one of the files it lists.
:::

:::note[The boot entry booted without its overlays]
If `nxs switch` stops with `host: the boot entry aliensense_gen booted without its overlays` after the reboot, the entry `nxs` wrote booted, but the launcher applied none of its overlays, most often because the entry's device tree is not your module's. The line under it shows what `fdtoverlay` says. Name your module's tree with `nxs switch --fdt <dtb>`, then reboot again.
:::

:::note[sudo refused]
If you see `host: writing /boot needs root, and sudo refused`, `nxs` ran where sudo could not ask for your password. Run `nxs switch` in a terminal.
:::

## 6. Check the setup

After the reboot, log in again. `nxs probe` sweeps every I²C bus and prints the NXS hardware that answers. Run it with nothing connected:

```sh
nxs probe
```

```
no hubs, units, or sensors answered (7 buses swept)
no suite.yaml yet, and nothing to declare — connect a unit and run nxs probe again
```

`7 buses swept` counts every I²C bus on your Jetson that `nxs` read, the two camera buses among them. Nothing is connected, so nothing answered. Check that both camera buses have their names:

```sh
ls /dev/i2c-cam*
```

```
/dev/i2c-cam0  /dev/i2c-cam1
```

The two names are your ports, `cam0` and `cam1`. That completes the deployment: your Jetson has `nxs`, its kernel knows the Hub, the camera buses are up with stable names and the assets are in place. When you declare a camera, `nxs switch` adds the port's camera table to the same boot entry and asks for one more reboot. NXS units without a camera need no further reboot.

:::note[No camera bus is booted]
If `nxs probe` prints `no camera bus is booted`, or a port's command prints `the host's ports: none`, your Jetson has not booted the entry from step 5 yet. Run `nxs switch`, and reboot when it prints `REBOOT NEEDED`.
:::

## Next steps

* Connect your first box to the Hub and get a stream in two minutes: [Getting started with the NXS unit](../unboxing/).
* Give an AI agent the `nxs` tools on your Jetson: [NVIDIA Jetson deployment with an AI agent](../deploy-jetson-mcp/).
