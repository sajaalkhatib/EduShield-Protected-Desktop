# EduShield Protected Desktop Player
### 🛡️ Hardware-Enforced Anti-Screen-Recording & Secure Educational Video Player

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-blue?logo=windows)](https://microsoft.com)
[![Electron](https://img.shields.io/badge/Electron-33.4-47848F?logo=electron)](https://www.electronjs.org/)
[![Angular](https://img.shields.io/badge/Angular-21-DD0031?logo=angular)](https://angular.dev/)
[![.NET](https://img.shields.io/badge/.NET%20Core-10.0-512BD4?logo=dotnet)](https://dotnet.microsoft.com/)
[![Security](https://img.shields.io/badge/Protection-Hardware%20WDA%20DWM-brightgreen)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)

EduShield is a professional-grade, protected desktop player engineered to solve the inherent security vulnerabilities of standard web browsers. By utilizing Windows Desktop Window Manager (DWM) hardware affinity (`SetWindowDisplayAffinity`), EduShield forces screen recording and screenshot tools to capture **100% solid black rectangles**, completely eliminating unauthorized content capture and video downloading.

---

## 🔒 Key Security Features

### 1. Hardware DWM Blackout (`WDA_MONITOR`)
Standard web browsers (Chrome, Edge, Firefox) run in an OS sandbox that cannot prevent desktop-level screen capture tools. EduShield leverages Electron's native OS bridge:
- Automatically hooks `SetWindowDisplayAffinity(hwnd, WDA_MONITOR)`.
- **Windows Snipping Tool** (`Win + Shift + S`, `Win + Shift + R`), **OBS Studio**, **Camtasia**, **Bandicam**, and screen sharing (**Discord, Zoom, Teams, Google Meet**) record a **pure black window**.
- The authenticated student views the lesson normally on their physical monitor without disruption.

### 2. Complete Elimination of Browser Extensions
Browser extensions like **IDM (Internet Download Manager)**, **Video DownloadHelper**, and **Loom** hook DOM elements and intercept media requests.
- EduShield runs inside a standalone Electron environment where extension engines are 100% disabled at the network and engine level.
- No extension injection, no devtools sniffing, and no download buttons injected into the DOM.

### 3. Dynamic Forensic Watermark
To deter physical external camera recording (mobile phone recording the screen):
- A semi-transparent floating watermark drifts continuously across the video viewport at randomized coordinates.
- Displays: `StudentID`, `SessionID`, `IP Address: 127.0.0.1`, and a live tamper-evident clock.
- Any leaked video can be instantly traced to the exact user account and timestamp.

### 4. Active Background Process Sentinel
- Real-time watcher monitoring for active instances of known screen recorders (`obs64`, `camtasia`, `bandicam`, `ShareX`, `snagit`, etc.).
- Automatically mutes audio and triggers an active viewport blackout until the recording application is terminated.

### 5. Aggressive Capture Interception & Clipboard Scrubbing
- Global keyboard capture intercepts `PrintScreen`, `Alt + PrintScreen`, `Ctrl + S`, `Ctrl + U`, and `Ctrl + P`.
- Instantly purges the Windows clipboard and replaces it with a legal copyright warning.

---

## 🏗️ System Architecture

```
EduShield-Protected-Desktop/
├── backend/                  # ASP.NET Core 10 Web API
│   ├── Assets/demo.mp4       # Protected lesson video asset
│   ├── Program.cs            # Video streaming, session management, secure cookies
│   └── EduShield.Api.csproj  # Target framework .NET 10.0
├── desktop-app/              # Electron 33 Native Shell
│   ├── main.js               # Hardware protection (WDA), process watcher, internal proxy
│   ├── preload.js            # Isolated context bridge
│   └── package.json          # Desktop dependencies
├── frontend/                 # Angular 21 Modern Web UI
│   ├── src/app/              # Standalone components, signals, security trap engine
│   └── angular.json          # Production build configuration
├── start-desktop.bat         # 🚀 1-Click Master Launcher (Recommended)
├── start-backend.bat         # Standalone backend server launcher
├── stop-all.bat              # Force-stop all running instances & free ports
└── README.md                 # Project documentation
```

---

## ⚡ Quick Start (Windows)

### Prerequisites
1. **[.NET 10.0 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)** or newer.
2. **[Node.js](https://nodejs.org/)** (v20.x, v22.x, or v24.x).

### 🌐 Option A: Website Portal with Auto-Launch (Recommended Web Workflow)
Run:
```cmd
start-website.bat
```
*(Or simply `start-all.bat`)*
- Automatically starts the backend API (port 5078) and frontend server (port 4200).
- Opens the **EduShield Academy Website** in your default web browser (`http://localhost:4200`).
- The student signs in with:
  - **Username:** `student`
  - **Password:** `LabOnly_2026!`
- **Upon logging in:** The website automatically launches the **EduShield Protected Desktop Player** on Windows with hardware-enforced video security!

### 🖥️ Option B: Direct Desktop Player (Standalone Launcher)
To open the protected player directly without opening a web browser:
```cmd
start-desktop.bat
```
This launcher automatically:
1. Terminates any lingering processes and frees port `5078`.
2. Verifies and launches the protected ASP.NET Core API.
3. Launches the hardware-protected Desktop Player with full DWM `WDA_MONITOR` protection.
4. Automatically signs in with the demo account and streams the lesson!

### 🔑 Demo Credentials
- **Username:** `student`
- **Password:** `LabOnly_2026!`

---

## 🧪 Testing Protection Matrix

| Test Scenario | Action | Expected Result | Protection Level |
|---|---|---|---|
| **OBS Studio Capture** | Open OBS -> Add Window Capture | Window appears **100% Solid Black** | Hardware DWM (`WDA_MONITOR`) |
| **Windows Snipping Tool** | Press `Win + Shift + S` or `Win + Shift + R` | Captured screenshot / video is **Pure Black** | Hardware DWM (`WDA_MONITOR`) |
| **Browser Extensions (IDM)** | Attempt to load download extension | **Blocked completely** (Zero extension engine) | Engine Sandbox |
| **PrintScreen Key** | Press `PrintScreen` | Intercepted; Clipboard scrubbed with warning | Keyboard Capture Sentinel |
| **Window Blur / Tab Switch** | Click outside the window | Audio/video continues normally with native protection | Native UX |
| **Camera Recording** | Record screen with external smartphone | Watermark identifies student ID & timestamp | Forensic Watermark |

---

## 🛑 How to Stop Everything Cleanly
If you ever need to kill all running instances, double-click:
```cmd
stop-all.bat
```
---
## 📄 License
This project is for educational and platform-protection demonstration purposes.
