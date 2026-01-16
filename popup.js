// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\popup.js
import { loginWithGoogle, logout } from './services/auth_service.js';
import { auth } from './services/firebase_config.js';
import { onAuthStateChanged } from './firebase/firebase-auth.js';
import { DashboardUI } from './ui/popup/dashboard_ui.js';
import { HistoryUI } from './ui/popup/history_ui.js';
import { SettingsUI } from './ui/popup/settings_ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    const dashboardUI = new DashboardUI();
    const historyUI = new HistoryUI();
    const settingsUI = new SettingsUI();

    // Cleanup listeners when popup closes
    window.addEventListener('unload', () => {
        dashboardUI.cleanup();
    });

    const initPopup = async (user) => {
        const loginOverlay = document.getElementById('login-overlay');
        if (!user) {
            if(loginOverlay) loginOverlay.style.display = 'flex';
            return;
        }
        if(loginOverlay) loginOverlay.style.display = 'none';

        const localSettings = await chrome.storage.local.get(null);
        const data = { ...localSettings };

        // Initialize Settings Tab
        settingsUI.init(data);

        // Tab Switching Logic
        const tabs = document.querySelectorAll('.tab-link');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab;
                document.getElementById(tabId).classList.add('active');

                if (tabId === 'dashboard') {
                    dashboardUI.init(data); // Pass settings for banks
                    dashboardUI.loadData();
                } else if (tabId === 'history') {
                    historyUI.init();
                    historyUI.loadData();
                }
            });
        });

        // Initial Tab Load
        const activeTab = document.querySelector('.tab-link.active');
        if (activeTab && activeTab.dataset.tab !== 'settings') {
            activeTab.click();
        }

        // Account Dropdown Logic
        const accountBtn = document.getElementById('account-btn');
        const accountDropdown = document.getElementById('account-dropdown');
        const userEmailDisplay = document.getElementById('user-email-display');
        const logoutBtn = document.getElementById('logout-btn');

        if (userEmailDisplay) userEmailDisplay.innerText = user.email;

        const avatarDiv = document.querySelector('.avatar');
        if (avatarDiv && user.photoURL) {
            avatarDiv.innerHTML = `<img src="${user.photoURL}" style="width: 100%; height: 100%; object-fit: cover;" alt="User Avatar" referrerpolicy="no-referrer">`;
        }

        if (accountBtn && accountDropdown) {
            accountBtn.onclick = (e) => {
                e.stopPropagation();
                accountDropdown.classList.toggle('show');
            };
            document.addEventListener('click', () => accountDropdown.classList.remove('show'));
            accountDropdown.onclick = (e) => e.stopPropagation();
        }

        if (logoutBtn) {
            logoutBtn.onclick = async () => {
                await logout();
                location.reload();
            };
        }
    };

    // Inject Login Overlay HTML
    const overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#0f172a; z-index:9999; display:none; flex-direction:column; align-items:center; justify-content:center; color:white;";
    overlay.innerHTML = `
        <h2 style="margin-bottom:20px;">Ebirr Verifier Pro</h2>
        <button id="google-login-btn" style="background:white; color:#333; border:none; padding:10px 20px; border-radius:5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:10px;">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> Sign in with Google
        </button>
    `;
    document.body.appendChild(overlay);

    document.getElementById('google-login-btn').onclick = async () => {
        try {
            await loginWithGoogle();
        } catch (e) {
            alert("Login failed: " + e.message);
        }
    };

    onAuthStateChanged(auth, (user) => {
        initPopup(user);
    });
});
