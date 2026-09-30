# **Tabby Server Stats Plugin**

A plugin for [Tabby Terminal](https://github.com/Eugeny/tabby) that displays real-time server statistics (CPU, RAM, Disk, Network) and **custom metrics** when connected via SSH / Local Shell.

## **Features**

* **Real-time Monitoring**: Displays CPU usage, RAM usage, Disk usage, and Network upload/download speeds out of the box.  
* **CPU sparkline (MobaXterm-like)**: Optional compact CPU history mini-chart in the bottom bar — thin vertical bars (configurable 20–60), newest on the right, with the current % beside it. Switch between the classic progress bar and the sparkline in settings.  
* **RAM as used / total**: Optionally show memory as `3.2G/8.0G` (color-coded by load) instead of a percentage bar/chart, in both display modes.  
* **Per-mount disk usage**: Optionally monitor all local mount points instead of just `/`. The bottom bar compactly shows `/` plus the fullest local mounts (e.g. `DISK / 42% │ /data 81%`) with the full list on hover; uses machine-parseable `df` (bytes), and filters out virtual/pseudo and network filesystems.  
* **I/O Wait (optional)**: First-class CPU I/O-wait %, computed in the core from the `/proc/stat` delta — no extra command, no `sleep`. Enable it in settings (Linux).  
* **Uptime & Load (optional)**: Time since boot and the 1-minute load average, read along with the base sample (one extra process on the host, whether or not both are shown) and formatted client-side — works on Linux *and* macOS.  
* **Logged-in users & SSH sessions (optional)**: Distinct users from `who`, and established inbound SSH connections counted on the port this session actually uses (`$SSH_CONNECTION`, falling back to 22), via `ss` where available and `netstat` elsewhere. Their commands are only sent while the toggle is on.  
* **Never runs out of room**: When the metrics stop fitting, the bottom bar stays one row tall and scrolls — ‹ › buttons plus mouse wheel — or wraps onto more rows if you prefer.  
* **Lightweight & responsive**: Polls **only the active tab**, computes CPU/network rates client-side from cheap `/proc` counters (no remote `sleep`; network sums physical interfaces only, so Docker/veth/bond traffic is not double-counted, and rates are timed by the server clock), and reuses a single self-throttling poll loop — so background SSH tabs cost nothing and the UI stays smooth.  
* **Configurable refresh interval**: From 1s (live monitoring) up to 60s, in **Settings → Server Stats**. The request timeout adapts to the interval and slow/erroring servers are backed off automatically.  
* **Custom Metrics Engine**: Define your own metrics using shell commands (e.g., GPU usage, Temperature, Docker container count).  
  * **Progress Bars**: Visual bars for percentage-based data.  
  * **Text Values**: Display raw data with units (e.g., "45°C", "3 Users").  
* **Built-in Presets**: Ready-made metrics **bundled with the plugin** — no network access, nothing is downloaded. Adding one requires explicit confirmation (see Security below). Common ones (uptime, load, users, SSH sessions, I/O wait) are no longer presets but first-class toggles, so they stay maintained and cost nothing while off.  
* **Flexible UI**:  
  * **Bottom Bar Mode**: An unobtrusive bar at the bottom of the terminal (docked inside the pane, won't overlap sidebars).  
  * **Floating Panel Mode**: A draggable widget that floats over the content. Under multi-input / split panes it shows the **last active window**'s stats.  
* **Highly Customizable**:  
  * **Drag & Drop Sorting**: Easily reorder metrics in the settings.  
  * **Visual Customization**: Change chart colors, opacity, and layout (Vertical/Horizontal).  
  * **Multi-language Support**: Interface available in English and Chinese.  
* **Zero Dependency**: Uses standard shell commands via the SSH channel. No agent installation required on the server.

## **Installation**

The plugin is installed from source: build it locally and symlink the repository into Tabby's plugins directory. Tabby loads `dist/index.js` straight from your working copy.

1. Clone and build:

   ```bash
   git clone git@github.com:galiullinis/tabby-stats-bar.git
   cd tabby-stats-bar
   npm install
   npm run build
   ```

2. Symlink the repository into Tabby's plugins directory:

   | OS | Plugins directory |
   |----|-------------------|
   | macOS | `~/Library/Application Support/tabby/plugins/node_modules` |
   | Linux | `~/.config/tabby/plugins/node_modules` |
   | Windows | `%APPDATA%\tabby\plugins\node_modules` |

   ```bash
   # macOS example, run from the repository root
   mkdir -p ~/Library/Application\ Support/tabby/plugins/node_modules
   ln -s "$(pwd)" ~/Library/Application\ Support/tabby/plugins/node_modules/tabby-stats-bar
   ```

   On Windows use `mklink /D` (or a junction via `mklink /J`) instead of `ln -s`.

3. Restart Tabby.

**Updating**: pull the changes, run `npm run build` (or keep `npm run watch` running during development) and restart Tabby — no need to reinstall.

**Uninstalling**: remove only the symlink, the repository stays intact:

```bash
rm ~/Library/Application\ Support/tabby/plugins/node_modules/tabby-stats-bar
```

## **Usage**

The stats will automatically appear when you connect to a Linux server via SSH or Local Shell.  
You can toggle visibility using the "Activity" icon in the toolbar.

### **How to use Custom Metrics**

Go to **Settings \-\> Server Stats** to manage your metrics.

#### **1\. Using the Built-in Presets (Recommended)**

1. Browse the bundled presets in the settings panel, grouped by category (System, Network, GPU, Containers).  
2. Click **Add** next to the metric you want.  
3. Confirm the command (it runs on the active session — see Security).  
4. It will immediately appear in your status bar.

No presets are fetched from the internet; they ship with the plugin. To add your own permanently, edit `src/builtin-presets.ts` (see the "HOW TO ADD" comment) and rebuild, or just add a one-off via **Custom Metrics** below.

#### **2\. Adding Manually**

You can define any metric by providing a shell command.

* **Label**: Name of the metric (e.g., "GPU").  
* **Command**: A shell command that outputs a **single number or string**.  
  * *Example (NVidia GPU)*: `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`
  * *Example (Docker containers)*: `docker ps -q 2>/dev/null | wc -l`
  * Make sure the command exits 0 in the "nothing found" case too. `grep -c` does **not**: it exits 1 on zero matches, and the wrapper then appends `Err` to your value. Use `awk 'END{print NR+0}'` or `wc -l` instead.
* **Type**:  
  * **Progress Bar**: Requires the command to return a number between 0-100.  
  * **Text Value**: Displays whatever the command outputs.

## **Settings**

In **Settings → Server Stats** you can configure:

* **Display Mode** — Bottom Bar or Floating Panel.
* **Background Color / Opacity**.
* **Refresh Interval** — how often stats are fetched (1–60s). Only the active tab is polled.
* **CPU Display** — Progress Bar or Sparkline; when Sparkline, **Sparkline Bars** sets the history length (20–60).
* **RAM Display** — Percentage (bar/chart) or numeric Used / Total (`3.2G/8.0G`).
* **Disk Display** — Root only (`/`) or Mount Points (per-mount, bottom bar; the full list appears on hover after 0.5s).
* **Network Display** — download/upload on two rows or side by side on one row (bottom bar).
* **Network Units** — bits/s (`Kb/s`, `Mb/s`, decimal; **default** — matches link speeds and Grafana/node-exporter "bits/sec" panels) or bytes/s (`K/s`, `M/s`, binary).
* **When Metrics Do Not Fit** — Scroll (one row + ‹ › buttons and mouse wheel) or Wrap (taller bar). Bottom bar only.
* **Show I/O Wait** — adds a first-class CPU I/O-wait % (Linux, from `/proc/stat`).
* **Show Uptime / Load Average** — no extra command; read with the base sample.
* **Show Logged-in Users / SSH Sessions** — each adds one command per refresh while enabled.
* **Debug Logging** — off by default. When enabled, diagnostic logs are written to a temp file (`tabby-server-stats.log`); useful only for troubleshooting.
* **Built-in Presets & Custom Metrics**.

## **Security**

Custom metrics and built-in presets are **shell commands that run on the active session — locally or on the remote SSH host — on every refresh**. The plugin does **not** download commands from the internet: presets are bundled with the package. Adding any preset requires an explicit confirmation showing the exact command. Only add metrics whose commands you understand and trust.

## **License**

MIT
