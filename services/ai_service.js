// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\ai_service.js
import { DEFAULT_API_KEY, DEFAULT_BANKS } from '../config.js';
import { settingsCache } from './settings_service.js';

// RATE LIMITING QUEUE
let aiQueue = Promise.resolve();
let lastAiRequestTime = 0;
const MIN_AI_INTERVAL = 6000; // 6 seconds = 10 requests per minute (Safe for Gemini 2.0 Flash / 1.5 Flash)

// Model Fallback List (Priority Order)
const AI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash"
];

export async function callAIVisionWithRetry(base64, mimeType = 'image/jpeg') {
    const keys = settingsCache.apiKeys;
    const banks = settingsCache.banks;
    
    // Enforce sequential execution with rate limiting
    return new Promise((resolve) => {
        aiQueue = aiQueue.then(async () => {
            const now = Date.now();
            const timeSinceLast = now - lastAiRequestTime;
            const wait = Math.max(0, MIN_AI_INTERVAL - timeSinceLast);
            
            if (wait > 0) {
                await new Promise(r => setTimeout(r, wait));
            }
            
            lastAiRequestTime = Date.now();

            try {
                const result = await callAIVision(base64, keys, settingsCache.activeKeyIndex, banks, mimeType);
                console.log("AI Result:", result);
                resolve(result);
            } catch (e) {
                if (e.message && (e.message.includes("Rate Limited") || e.message.includes("exhausted") || e.message.includes("restricted") || e.message.includes("quota") || e.message.includes("exceeded") || e.message.includes("overloaded"))) {
                    console.warn("AI Service Rate Limit:", e.message);
                    // Add 60s backoff for the NEXT request
                    lastAiRequestTime = Date.now() + 60000;
                    resolve("RATE_LIMIT");
                } else {
                    console.error("AI Service Error:", e);
                    resolve("SERVICE_ERROR");
                }
            }
        });
    });
}

export async function callAIVision(base64Image, cachedKeys, cachedIndex, cachedBanks, mimeType = 'image/jpeg', modelIndex = 0) {
    let keys = cachedKeys;
    let currentIndex = cachedIndex;
    let banks = cachedBanks;

    if (!keys || !banks) {
        const storage = await chrome.storage.local.get(['apiKeys', 'activeKeyIndex', 'banks']);
        keys = storage.apiKeys || [DEFAULT_API_KEY];
        currentIndex = storage.activeKeyIndex || 0;
        banks = storage.banks || DEFAULT_BANKS;
    }

    // Filter out empty keys to prevent unnecessary API calls
    const validKeys = keys.filter(k => k && k.trim().length > 0);
    if (validKeys.length === 0) {
        throw new Error("No valid API keys found. Please add an API key in the extension settings.");
    }
  
    // Generate Dynamic Prompt
    const specs = banks.map(b => `- A ${b.length}-digit number starting with "${b.prefixes.join('" or "')}".`).join('\n  ');

    const dynamicPrompt = `
    You are a specialized Vision OCR system for Ethiopian financial transaction verification.
    Your ONLY goal is to extract the **Transaction ID** (also called Reference Number or Receipt Number).
    
    <|id_specs|>
    The valid Transaction ID MUST match one of these exact formats:
    ${specs}
    </|id_specs|>

    <|extraction_rules|>
    1. **Locate the Label:** Look for these specific keywords (case-insensitive):
    - English: "Transfer ID", "Trans ID", "Txn ID", "Receipt No", "Ref No", "Reference", "TID"
    - Afaan Oromoo: "LakkAddaa", "Mogg", "Haftee"
    - Somali: "Tix", "Tixda"
    - Amharic: "የክፍያ ቁጥር", "መለያ ቁጥር"
    - Short/SMS: "Transfer-Id:", "Ref:"

    2. **Spatial Logic (Vertical Stack Fix):**
    - The ID is often to the right of the label OR on the lines below it.
    - **THE DATE TRAP:** If the line immediately below "Transfer ID" is a date or time (contains "/" or ":"), SKIP it. The Transaction ID is the long numeric string on the VERY NEXT line.
    - In SMS sentences, the ID is often at the very start or end of the message.

    3. **IGNORE Distractors (Crucial):**
    - **Phone Numbers:** REJECT numbers starting with "251", "+251", "09", or "07" if they are 10-13 digits long. These are Sender/Receiver numbers, NOT Transaction IDs.
    - **Dates/Times:** REJECT strings with colons (12:30), slashes (01/01/2026), or hyphens (2026-01-01).
    - **Amounts:** REJECT numbers following "ETB" or containing decimals (e.g., 100.00).

    4. **Final Validation:**
    - Compare the number you found against the <|id_specs|> list.
    - If the number does not match the specific *Length* AND *Prefix* defined in the specs, discard it and keep searching the image.
    </|extraction_rules|>

    <|output_format|>
    - If a valid ID is found that matches the specs: Return ONLY the digits. (Example: 801457901704 or 1972262089).
    - If multiple valid candidates exist, prefer the one closest to a recognized label.
    - If NO valid ID matches the specs exactly: Return "ERROR".
    - Do NOT write "Here is the ID". Do NOT include punctuation.
    </|output_format|>
    `;
    
    if (currentIndex >= validKeys.length) currentIndex = 0;
  
    // Try keys loop (Rotation Logic)
    for (let attempt = 0; attempt < validKeys.length; attempt++) {
        const i = (currentIndex + attempt) % validKeys.length;
        const apiKey = validKeys[i];
        
        const isGroq = apiKey.startsWith('gsk_');
        let response;
  
        try {
            if (isGroq) {
                // Groq Call
                const url = "https://api.groq.com/openai/v1/chat/completions";
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: "llama-3.2-11b-vision-preview",
                        messages: [{
                            role: "user",
                            content: [
                                { type: "text", text: dynamicPrompt },
                                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                            ]
                        }],
                        temperature: 0
                    })
                });
            } else {
                // Gemini Call with Model Fallback
                const currentModel = AI_MODELS[modelIndex] || AI_MODELS[0];
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: dynamicPrompt },
                                { inlineData: { mimeType: mimeType, data: base64Image } }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0,
                            maxOutputTokens: 300
                        },
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                        ]
                    })
                });
            }

            if (response.status === 429) { 
                console.warn(`Key index ${i} rate limited.`); 
                
                // Try next model if available
                if (modelIndex < AI_MODELS.length - 1) {
                    console.warn(`Switching model from ${AI_MODELS[modelIndex]} to ${AI_MODELS[modelIndex + 1]} due to rate limit.`);
                    return callAIVision(base64Image, cachedKeys, i, cachedBanks, mimeType, modelIndex + 1);
                }

                // If all models exhausted for this key, try next key (loop continues)
                if (attempt < validKeys.length - 1) {
                    console.warn(`All models exhausted for key index ${i}. Switching to next API key.`);
                    continue;
                }
                continue; 
            }
            if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || "API Error"); }
            if (i !== currentIndex) { chrome.storage.local.set({ activeKeyIndex: i }); }
            const data = await response.json();
            
            let content = "";
            if (isGroq) {
                content = data.choices?.[0]?.message?.content?.trim();
            } else {
                content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            } 

            if (!content) {
                 console.warn(`Key index ${i} returned no content.`);
                 // Try next model if available
                 if (modelIndex < AI_MODELS.length - 1) {
                    console.warn(`Switching model from ${AI_MODELS[modelIndex] || AI_MODELS[0]} to ${AI_MODELS[modelIndex + 1]} due to empty content.`);
                    return callAIVision(base64Image, cachedKeys, i, cachedBanks, mimeType, modelIndex + 1);
                 }
                 
                 // If no more models, try next key (or return ERROR if last key)
                 if (attempt < validKeys.length - 1) continue;
                 return "ERROR";
            }
            
            // Smart Fallback: If AI returns "ERROR" (OCR failure), try next key if available
            if (content.toUpperCase().includes("ERROR")) {
                if (attempt < validKeys.length - 1) {
                    console.warn(`Key index ${i} returned ERROR (OCR Failed). Retrying with next key...`);
                    continue;
                }
                return "ERROR";
            }
            
            return content.replace(/\D/g, '');
        } catch (e) { 
            console.warn(`Key index ${i} failed:`, e);
            if (attempt === validKeys.length - 1) throw e; 
        }
    }
    throw new Error("All API keys exhausted (Rate Limited).");
}
