# **Tabby Server Stats Plugin**

A plugin for [Tabby Terminal](https://github.com/Eugeny/tabby) that displays real-time server statistics (CPU, RAM, Disk, Network) and **custom metrics** when connected via SSH / Local Shell.

## **Features**

* **Real-time Monitoring**: Displays CPU usage, RAM usage, Disk usage, and Network upload/download speeds out of the box.  
* **Lightweight & responsive**: Polls **only the active tab**, computes CPU/network rates client-side from cheap `/proc` counters (no remote `sleep`), and reuses a single self-throttling poll loop — so background SSH tabs cost nothing and the UI stays smooth.  
* **Configurable refresh interval**: From 1s (live monitoring) up to 60s, in **Settings → Server Stats**. The request timeout adapts to the interval and slow/erroring servers are backed off automatically.  
* **Custom Metrics Engine**: Define your own metrics using shell commands (e.g., GPU usage, Temperature, Docker container count).  
  * **Progress Bars**: Visual bars for percentage-based data.  
  * **Text Values**: Display raw data with units (e.g., "45°C", "3 Users").  
* **Built-in Presets**: Ready-made metrics (GPU, Uptime, Temperature, etc.) **bundled with the plugin** — no network access, nothing is downloaded. Adding one requires explicit confirmation (see Security below).  
* **Flexible UI**:  
  * **Bottom Bar Mode**: An unobtrusive bar at the bottom of the terminal (docked inside the pane, won't overlap sidebars).  
  * **Floating Panel Mode**: A draggable widget that floats over the content. Under multi-input / split panes it shows the **last active window**'s stats.  
* **Highly Customizable**:  
  * **Drag & Drop Sorting**: Easily reorder metrics in the settings.  
  * **Visual Customization**: Change chart colors, opacity, and layout (Vertical/Horizontal).  
  * **Multi-language Support**: Interface available in English and Chinese.  
* **Zero Dependency**: Uses standard shell commands via the SSH channel. No agent installation required on the server.

## **Installation**

1. Open **Tabby Settings**.  
2. Go to **Plugins**.  
3. Search for tabby-server-stats.  
4. Click **Install**.

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
  * *Example (Active Users)*: `who | grep -c pts`
* **Type**:  
  * **Progress Bar**: Requires the command to return a number between 0-100.  
  * **Text Value**: Displays whatever the command outputs.

## **Settings**

In **Settings → Server Stats** you can configure:

* **Display Mode** — Bottom Bar or Floating Panel.
* **Background Color / Opacity**.
* **Refresh Interval** — how often stats are fetched (1–60s). Only the active tab is polled.
* **Debug Logging** — off by default. When enabled, diagnostic logs are written to a temp file (`tabby-server-stats.log`); useful only for troubleshooting.
* **Built-in Presets & Custom Metrics**.

## **Security**

Custom metrics and built-in presets are **shell commands that run on the active session — locally or on the remote SSH host — on every refresh**. The plugin does **not** download commands from the internet: presets are bundled with the package. Adding any preset requires an explicit confirmation showing the exact command. Only add metrics whose commands you understand and trust.

## **License**

MIT
