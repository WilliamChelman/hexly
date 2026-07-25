## Downloading the Desktop App

The `.dmg`, `.exe` and `.AppImage` below are the **Desktop App** — Hexly on your own machine, with no account to
create and no server to run. Self-hosting instead? This same version is `ghcr.io/williamchelman/hexly`.

**The builds are unsigned, so nothing auto-updates and every platform warns the first time you open one.** That
warning is expected; the download is not broken.

- **macOS** (Apple Silicon) — the first open is refused, saying the developer cannot be verified. Open **System
  Settings → Privacy & Security**, scroll to the message naming Hexly, click **Open Anyway**, then confirm.
  Recent macOS has removed the Finder right-click → **Open** bypass, so this is the route.
- **Windows** — SmartScreen shows "Windows protected your PC" and hides the button: click **More info**, then
  **Run anyway**.
- **Linux** — give the AppImage the executable bit (`chmod +x Hexly-*.AppImage`), then run it.

Updating means downloading a later installer and opening it. Full instructions, and where your Worlds are kept:
[Installing the Desktop App](https://github.com/WilliamChelman/hexly#installing-the-desktop-app).
