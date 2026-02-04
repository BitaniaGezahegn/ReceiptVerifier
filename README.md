# 🛡️ Bank Receipt Verifier Pro

**Bank Receipt Verifier Pro** is an advanced Chrome Extension (Manifest V3) designed to automate the verification of financial transaction receipts. It leverages **Multi-Model AI (Gemini/Llama)** for OCR and **Headless Browser Automation** to cross-reference receipt screenshots against bank records in real-time.

![Version](https://img.shields.io/badge/version-3.0-blue)
![Tech](https://img.shields.io/badge/tech-Manifest_V3_%7C_Firebase_%7C_AI-green)

## 🚀 Key Features

### 🧠 Intelligent OCR & Vision
* **Multi-Model AI:** Utilizes **Google Gemini 2.5** and **Groq (Llama)** to extract Transaction IDs from images with automatic fallback logic for high availability.
* **Smart Pre-processing:** Automatically crops and slices tall screenshots to ensure accurate text recognition.
* **Fuzzy Matching:** intelligently handles slight name variations and OCR misreads during verification.

### ⚡ Automation & Workflow
* **Full Auto Mode:** "The Robot" automatically scans pending requests, verifies them, and clicks Confirm/Reject on the dashboard without human intervention.
* **Headless Verification:** Uses Chrome's `offscreen` API to verify transactions against bank portals in the background, significantly faster than opening new tabs.
* **Batch Processing:** Dynamic queue management allows processing multiple transactions sequentially to prevent rate limits.

### ☁️ Team Sync & Data Persistence
* **Centralized Database:** Powered by **Firebase Firestore** to log every transaction. If one team member verifies an ID, it is flagged as "Duplicate" for everyone else.
* **Live Dashboard:** Built-in popup dashboard with real-time charts showing success rates, transaction volume, and processing speed (TPM).

### 🔔 Monitoring & Alerts
* **Dynamic Island UI:** Non-intrusive floating status indicators injected into the page.
* **Watchdog Service:** Monitors system health and sends **Telegram** alerts if the system hangs or if pending requests exceed a threshold.

---

## 🛠️ Architecture

* **Manifest V3:** Fully compliant with modern Chrome Extension standards using Service Workers.
* **Background Service:** Handles message routing, AI orchestration, and database communication.
* **Offscreen Document:** Handles DOM parsing of bank receipts and image canvas operations.
* **Content Scripts:** Injects UI elements and manages DOM interactions on the management dashboard.

---

## ⚙️ Installation & Setup

### 1. Prerequisites
* Google Chrome (Version 88+)
* A Firebase Project
* Google Cloud API Key (for Gemini) or Groq API Key

### 2. Configuration
Before installing, you must configure the secrets.

**A. Firebase Setup**
1.  Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2.  Enable **Authentication** (Google Sign-In) and **Firestore**.
3.  Update `services/firebase_config.js` with your config object.

**B. Notification Setup (Optional)**
1.  To enable Telegram alerts, update `services/settings_service.js` or configure it via the Extension Settings UI.

### 3. Loading the Extension
1.  Clone this repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** (top right).
4.  Click **Load unpacked**.
5.  Select the root folder of this project.

---

## 📖 Usage Guide

### 1. The Dashboard
Click the extension icon to open the popup dashboard.
* **Dashboard Tab:** View daily stats, success/fail rates, and live verification speed.
* **History Tab:** Searchable log of all processed transactions.
* **Settings Tab:** Configure API keys, target recipient names, and automation rules.

### 2. Manual Verification
* **Right-Click:** Right-click any image and select **"✅ Verify Transaction"**.
* **Manual Entry:** Use the "Manual" button in the overlay to type an ID if OCR fails.

### 3. Automatic Mode
1.  Navigate to the Pending Requests page on your management dashboard.
2.  A **"Verify All"** button will appear in the toolbar.
3.  Click it to start batch processing.
4.  Enable **"Full Auto Mode"** in settings to have it refresh and run continuously.

---

## 🛡️ Security Note

> **⚠️ Important:** This repository contains logic for handling sensitive API keys (Firebase, Telegram, AI).
>
> * Ensure strict **Firestore Security Rules** are deployed to prevent unauthorized database access.
> * Never commit your actual `settings_service.js` with real Telegram tokens to a public repository. Use the Extension Settings UI to inject these values locally.

---

## 📄 License

[Your License Here] - e.g., Proprietary or MIT.
