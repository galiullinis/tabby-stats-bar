# **Tabby Server Stats Plugin**

A plugin for [Tabby Terminal](https://github.com/Eugeny/tabby) that displays real-time server statistics (CPU, RAM, Disk, Network) and **custom metrics** when connected via SSH / Local Shell.

## **Features**

* **Real-time Monitoring**: Displays CPU usage, RAM usage, Disk usage, and Network upload/download speeds out of the box.  
* **Lightweight & responsive**: Polls **only the active tab**, computes CPU/network rates client-side from cheap `/proc` counters (no remote `sleep`), and reuses a single self-throttling poll loop — so background SSH tabs cost nothing and the UI stays smooth.  
* **Configurable refresh interval**: From 1s (live monitoring) up to 60s, in **Settings → Server Stats**. The request timeout adapts to the interval and slow/erroring servers are backed off automatically.  
* **Custom Metrics Engine**: Define your own metrics using shell commands (e.g., GPU usage, Temperature, Docker container count).  
  * **Progress Bars**: Visual bars for percentage-based data.  
  * **Text Values**: Display raw data with units (e.g., "45°C", "3 Users").  
* **Preset Library**: One-click import for common metrics (GPU, Uptime, Temperature, etc.) from the community repository (with an explicit confirmation — see Security below).  
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

#### **1\. Using the Preset Library (Recommended)**

1. Click the **"Fetch from GitHub"** button in the settings panel.  
2. Browse the list of community presets (e.g., NVIDIA GPU, CPU Temp, Uptime).  
3. Click **Add** next to the metric you want.  
4. It will immediately appear in your status bar.

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
* **Custom Metrics & Preset Library**.

## **Security**

Custom metrics (including imported presets) are **shell commands that run on every server you connect to, on every refresh**. Presets are downloaded from a remote community repository, so adding one requires an explicit confirmation showing the exact command. Only add metrics whose commands you understand and trust.

## **License**

MIT
