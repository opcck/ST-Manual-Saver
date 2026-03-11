import { saveChatConditional } from '../../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';

const extensionName = 'ST-Manual-Saver';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    allowTimedSave: true,
    allowInterval: 10, // minutes
    playSound: true,
};

let isManualSave = false;
let lastAllowedSaveTime = 0;
let originalFetch = null;
let fetchPatched = false;
let menuButton = null;
let buttonObserver = null;

function loadSettings() {
    if (!extension_settings.manual_saver) {
        extension_settings.manual_saver = {};
    }

    extension_settings.manual_saver = {
        ...defaultSettings,
        ...extension_settings.manual_saver,
    };
}

function getSettings() {
    return extension_settings.manual_saver;
}

function saveSettings() {
    saveSettingsDebounced();
}

function playSaveSuccessSound() {
    try {
        const settings = getSettings();
        if (!settings.playSound) return;

        const audio = new Audio(`${extensionFolderPath}/save-success.mp3`);
        audio.volume = 0.6;
        audio.play().catch((err) => {
            console.debug('[ST-Manual-Saver] Failed to play sound:', err);
        });
    } catch (err) {
        console.debug('[ST-Manual-Saver] Audio init failed:', err);
    }
}

function isSaveRequest(url) {
    if (!url) return false;

    const urlString = typeof url === 'string' ? url : url.url || '';
    return (
        urlString.includes('/api/chats/save') ||
        urlString.includes('/api/chats/group/save')
    );
}

function isTimedSaveAllowed() {
    const settings = getSettings();

    if (!settings.enabled) return true;
    if (!settings.allowTimedSave) return false;

    const intervalMs = Number(settings.allowInterval || 0) * 60 * 1000;
    if (intervalMs <= 0) return true;

    return Date.now() - lastAllowedSaveTime >= intervalMs;
}

async function patchedFetch(...args) {
    const [resource] = args;
    const url = typeof resource === 'string' ? resource : resource?.url;

    if (!isSaveRequest(url)) {
        return originalFetch(...args);
    }

    const settings = getSettings();

    if (!settings.enabled) {
        return originalFetch(...args);
    }

    if (isManualSave) {
        try {
            const response = await originalFetch(...args);
            lastAllowedSaveTime = Date.now();

            if (response.ok) {
                toastr.success('聊天已成功保存！');
                playSaveSuccessSound();
            } else {
                toastr.error('聊天保存失败！');
            }

            return response;
        } finally {
            isManualSave = false;
        }
    }

    if (isTimedSaveAllowed()) {
        lastAllowedSaveTime = Date.now();
        const response = await originalFetch(...args);

        if (response.ok) {
            playSaveSuccessSound();
        }

        return response;
    }

    console.debug('[ST-Manual-Saver] Blocked auto-save request:', url);

    return new Response(
        JSON.stringify({
            status: 'ok',
            message: 'Blocked by ST-Manual-Saver',
            blocked: true,
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        },
    );
}

function patchFetch() {
    if (fetchPatched) return;
    if (typeof window.fetch !== 'function') return;

    originalFetch = window.fetch.bind(window);
    window.fetch = patchedFetch;
    fetchPatched = true;
}

function createSettingsHtml() {
    const settings = getSettings();

    return `
    <div id="manual_saver_settings" class="manual_saver_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>ST Manual Saver</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="flex-container alignitemscenter marginBot10">
                    <label class="checkbox_label" for="manual_saver_enabled">
                        <input id="manual_saver_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                        启用手动保存模式
                    </label>
                </div>

                <div class="flex-container alignitemscenter marginBot10">
                    <label class="checkbox_label" for="manual_saver_allow_timed_save">
                        <input id="manual_saver_allow_timed_save" type="checkbox" ${settings.allowTimedSave ? 'checked' : ''}>
                        启用定时放行自动保存
                    </label>
                </div>

                <div class="flex-container alignitemscenter marginBot10">
                    <label for="manual_saver_allow_interval" style="margin-right: 10px;">自动保存放行间隔（分钟）</label>
                    <input id="manual_saver_allow_interval" type="number" min="0" step="1" value="${settings.allowInterval}">
                </div>

                <div class="flex-container alignitemscenter marginBot10">
                    <label class="checkbox_label" for="manual_saver_play_sound">
                        <input id="manual_saver_play_sound" type="checkbox" ${settings.playSound ? 'checked' : ''}>
                        保存成功时播放提示音
                    </label>
                </div>

                <small>
                    说明：<br>
                    1. 手动点击“保存聊天”时会保存并播放提示音。<br>
                    2. 自动保存只有在达到设定间隔时才会放行，并播放提示音。<br>
                    3. 其他自动保存请求会被拦截。
                </small>
            </div>
        </div>
    </div>`;
}

function bindSettingsEvents() {
    $('#manual_saver_enabled').on('input change', function () {
        getSettings().enabled = $(this).prop('checked');
        saveSettings();
        updateButtonState();
    });

    $('#manual_saver_allow_timed_save').on('input change', function () {
        getSettings().allowTimedSave = $(this).prop('checked');
        saveSettings();
    });

    $('#manual_saver_allow_interval').on('input change', function () {
        const value = Number($(this).val());
        getSettings().allowInterval = Number.isFinite(value) && value >= 0 ? value : defaultSettings.allowInterval;
        saveSettings();
    });

    $('#manual_saver_play_sound').on('input change', function () {
        getSettings().playSound = $(this).prop('checked');
        saveSettings();
    });
}

function renderSettings() {
    const container = $('#extensions_settings');
    if (!container.length) return;

    $('#manual_saver_settings').remove();
    container.append(createSettingsHtml());
    bindSettingsEvents();
}

async function triggerManualSave() {
    try {
        isManualSave = true;
        await saveChatConditional();
    } catch (err) {
        isManualSave = false;
        console.error('[ST-Manual-Saver] Manual save failed:', err);
        toastr.error('手动保存失败！');
    }
}

function createMenuButton() {
    const button = $(`
        <div id="manualSaveButton" class="list-group-item flex-container">
            <i class="fa-solid fa-floppy-disk"></i>
            <span>保存聊天</span>
        </div>
    `);

    button.on('click', async () => {
        await triggerManualSave();
    });

    return button;
}

function getMenuContainer() {
    const extensionsMenu = $('#extensionsMenu');
    if (extensionsMenu.length) return extensionsMenu;

    const optionsMenu = $('#options');
    if (optionsMenu.length) return optionsMenu;

    return $();
}

function updateButtonState() {
    const settings = getSettings();
    const container = getMenuContainer();

    if (!container.length) return;

    if (!settings.enabled) {
        $('#manualSaveButton').remove();
        menuButton = null;
        return;
    }

    if (!$('#manualSaveButton').length) {
        menuButton = createMenuButton();
        container.prepend(menuButton);
    }
}

function observeMenu() {
    if (buttonObserver) return;

    buttonObserver = new MutationObserver(() => {
        updateButtonState();
    });

    buttonObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });

    updateButtonState();
}

jQuery(async () => {
    loadSettings();
    renderSettings();
    patchFetch();
    observeMenu();

    console.log('[ST-Manual-Saver] Loaded');
});
