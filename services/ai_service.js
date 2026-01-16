import { DEFAULT_API_KEY, DEFAULT_BANKS } from '../config.js';

export async function callAIVision(base64Image, cachedKeys, cachedIndex, cachedBanks, mimeType = 'image/jpeg') {
    let keys = cachedKeys;
    let currentIndex = cachedIndex;
    let banks = cachedBanks;

    if (!keys || !banks) {
        const storage = await chrome.storage.local.get(['apiKeys', 'activeKeyIndex', 'banks']);
        keys = storage.apiKeys || [DEFAULT_API_KEY];
        currentIndex = storage.activeKeyIndex || 0;
        banks = storage.banks || DEFAULT_BANKS;
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
    
    if (currentIndex >= keys.length) currentIndex = 0;
  
    // Try keys loop (Rotation Logic)
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const i = (currentIndex + attempt) % keys.length;
        const apiKey = keys[i];
        
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
                // Gemini Call
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
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

            if (response.status === 429) { console.warn(`Key index ${i} rate limited.`); continue; }
            if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || "API Error"); }
            if (i !== currentIndex) { chrome.storage.local.set({ activeKeyIndex: i }); }
            const data = await response.json();
            
            let content = "";
            if (isGroq) {
                content = data.choices?.[0]?.message?.content?.trim();
            } else {
                content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            }

            if (!content) throw new Error("No content in response");
            
            // Smart Fallback: If AI returns "ERROR" (OCR failure), try next key if available
            if (content.toUpperCase().includes("ERROR")) {
                if (attempt < keys.length - 1) {
                    console.warn(`Key index ${i} returned ERROR (OCR Failed). Retrying with next key...`);
                    continue;
                }
                return "ERROR";
            }
            
            return content.replace(/\D/g, '');
        } catch (e) { 
            console.warn(`Key index ${i} failed:`, e);
            if (attempt === keys.length - 1) throw e; 
        }
    }
    throw new Error("All API keys exhausted (Rate Limited).");
}
