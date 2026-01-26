import { settingsCache } from './settings_service.js';
import { sendTelegramNotification } from './notification_service.js';

const ALARM_NAME = 'ebirr_watchdog_check';
const STORAGE_KEY_ACTIVITY = 'ebirr_last_activity';
const STORAGE_KEY_FAILURES = 'ebirr_consecutive_failures';
const STORAGE_KEY_LAST_ALERT = 'ebirr_last_alert_time';
const STORAGE_KEY_ALERT_COUNT = 'ebirr_alert_count';

export function startWatchdog() {
    // Create an alarm that fires every 1 minute to check health
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    
    console.log("🛡️ Watchdog Service Started (Alarms)");
}

export async function reportActivity() {
    // Save timestamp to storage so it persists even if extension sleeps
    // Also reset alert counters because we are active again!
    await chrome.storage.local.set({ 
        [STORAGE_KEY_ACTIVITY]: Date.now(),
        [STORAGE_KEY_ALERT_COUNT]: 0,
        [STORAGE_KEY_LAST_ALERT]: 0
    });
}

export async function reportOutcome(isSuccess) {
    if (isSuccess) {
        await chrome.storage.local.set({ [STORAGE_KEY_FAILURES]: 0 });
    } else {
        const data = await chrome.storage.local.get([STORAGE_KEY_FAILURES]);
        const current = (data[STORAGE_KEY_FAILURES] || 0) + 1;
        await chrome.storage.local.set({ [STORAGE_KEY_FAILURES]: current });
        checkFailureThreshold(current);
    }
}

// Called by background.js when the alarm fires
export async function onWatchdogAlarm(alarm) {
    if (alarm.name === ALARM_NAME) {
        await checkHealth();
    }
}

async function checkHealth() {
    if (!settingsCache.sleepModeEnabled) return;

    const data = await chrome.storage.local.get([STORAGE_KEY_ACTIVITY, STORAGE_KEY_LAST_ALERT, STORAGE_KEY_ALERT_COUNT]);
    const lastActivity = data[STORAGE_KEY_ACTIVITY] || Date.now();
    const lastAlert = data[STORAGE_KEY_LAST_ALERT] || 0;
    const alertCount = data[STORAGE_KEY_ALERT_COUNT] || 0;

    const timeoutMinutes = settingsCache.sleepModeTimeout || 10;
    const repeatMinutes = settingsCache.sleepModeRepeat || 2;
    const maxRetries = settingsCache.sleepModeMaxRetries || 10;

    const timeoutMs = timeoutMinutes * 60 * 1000;
    const repeatMs = repeatMinutes * 60 * 1000;
    const now = Date.now();
    const timeSinceLast = now - lastActivity;

    // 1. Check if we are in "Inactive" state
    if (timeSinceLast > timeoutMs) {
        
        // 2. Check if we should send an alert (First time OR Repeat time)
        const timeSinceAlert = now - lastAlert;
        
        if (alertCount < maxRetries && (alertCount === 0 || timeSinceAlert >= repeatMs)) {
            
            // Update state BEFORE sending to prevent race conditions
            await chrome.storage.local.set({
                [STORAGE_KEY_LAST_ALERT]: now,
                [STORAGE_KEY_ALERT_COUNT]: alertCount + 1
            });

            sendTelegramNotification(
                `🚨 *Sleep Mode Alert (${alertCount + 1}/${maxRetries})*\n\n` +
                `*System Inactive!* No transactions processed in the last ${Math.round(timeSinceLast / 60000)} minutes.\n\n` +
                `Possible causes:\n` +
                `• Queue is empty\n` +
                `• System is stuck\n` +
                `• Browser crashed`
            );
        }
    }
}

function checkFailureThreshold(currentFailures) {
    if (!settingsCache.sleepModeEnabled) return;
    
    const limit = settingsCache.sleepModeFailureLimit || 5;
    if (currentFailures >= limit) {
        // Reset to prevent immediate re-alerting
        chrome.storage.local.set({ [STORAGE_KEY_FAILURES]: 0 });
        
        sendTelegramNotification(
            `🚨 *Sleep Mode Alert*\n\n` +
            `*High Failure Rate!* ${currentFailures} consecutive errors or manual checks occurred.\n\n` +
            `The system might be misinterpreting images or the bank site is down.`
        );
    }
}
