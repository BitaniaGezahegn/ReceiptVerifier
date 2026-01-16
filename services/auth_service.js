import { auth } from './firebase_config.js';
import { GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from '../firebase/firebase-auth.js';

export async function loginWithGoogle() {
    let token;
    try {
        // 1. Get Google OAuth Token via Chrome API
        token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    let error = chrome.runtime.lastError;
                    // Enhance error message for common OAuth misconfiguration
                    if (error.message && error.message.includes("bad client id")) {
                        const extId = chrome.runtime.id;
                        console.error(`OAuth Configuration Error: The client_id in manifest.json is rejected. Your current Extension ID is: ${extId}. Ensure this ID is added to the Authorized Origins in Google Cloud Console for this Client ID.`);
                        error = new Error(`OAuth Error: Bad Client ID. Extension ID: ${extId}. See console.`);
                    }
                    reject(error);
                } else {
                    resolve(token);
                }
            });
        });

        // 2. Create Firebase Credential
        const credential = GoogleAuthProvider.credential(null, token);

        // 3. Sign In to Firebase
        const userCredential = await signInWithCredential(auth, credential);
        return userCredential.user;

    } catch (error) {
        console.error("Login Failed:", error);
        // If we got a token but Firebase rejected it (e.g. wrong project), clear it from Chrome's cache
        if (token) {
            chrome.identity.removeCachedAuthToken({ token: token }, () => {});
        }
        throw error;
    }
}

export async function logout() {
    await signOut(auth);
    // Also clear chrome identity cache
    chrome.identity.clearAllCachedAuthTokens(() => {});
}

export function getCurrentUser() {
    return auth.currentUser;
}

export function ensureAuthReady() {
    return new Promise((resolve) => {
        if (auth.currentUser) return resolve(auth.currentUser);
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}