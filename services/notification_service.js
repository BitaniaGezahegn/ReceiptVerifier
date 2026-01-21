import { settingsCache } from './settings_service.js';

export async function sendTelegramNotification(message) {
    const { telegramBotToken, telegramChatId } = settingsCache;

    if (!telegramBotToken || !telegramChatId) {
        console.warn("Telegram Notification Skipped: Missing Token or Chat ID");
        return;
    }

    // Support multiple chat IDs separated by commas (e.g., "12345, 67890")
    const chatIds = String(telegramChatId).split(',').map(id => id.trim()).filter(id => id);

    const promises = chatIds.map(async (chatId) => {
        try {
            const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });

            if (!response.ok) {
                console.warn(`Telegram Notification Failed (ID: ${chatId}):`, await response.text());
            }
        } catch (e) {
            console.error(`Telegram Notification Error (ID: ${chatId}):`, e);
        }
    });

    await Promise.all(promises);
}