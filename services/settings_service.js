// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\settings_service.js
import { DEFAULT_API_KEY, TARGET_NAME, DEFAULT_BANKS } from '../config.js';

export let settingsCache = {
    apiKeys: [DEFAULT_API_KEY],
    activeKeyIndex: 0,
    banks: DEFAULT_BANKS,
    maxReceiptAge: 0.5,
    headlessMode: true,
    aiScanBehavior: 'always_ai',
    targetName: TARGET_NAME,
};

export const initSettings = async () => {
    const data = await chrome.storage.local.get(Object.keys(settingsCache));
    Object.assign(settingsCache, data);
    
    // Ensure defaults
    if (!settingsCache.apiKeys || settingsCache.apiKeys.length === 0) settingsCache.apiKeys = [DEFAULT_API_KEY];
    if (!settingsCache.banks || settingsCache.banks.length === 0) settingsCache.banks = DEFAULT_BANKS;
    if (!settingsCache.targetName) settingsCache.targetName = TARGET_NAME;

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            for (const [key, { newValue }] of Object.entries(changes)) {
                if (key in settingsCache) settingsCache[key] = newValue;
            }
        }
    });
};

export function isValidIdFormat(id) {
    if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
        return false;
    }
    const banks = settingsCache.banks || DEFAULT_BANKS;
    const matchedBank = banks.find(b => 
      id.length === parseInt(b.length) && 
      b.prefixes.some(prefix => id.startsWith(prefix))
    );
    return !!matchedBank;
}
