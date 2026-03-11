import { saveChatConditional } from '../../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';

const extensionName = 'ST-Manual-Saver';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    allowTimedSave: true,
    allowInterval: 10,
    playSound: true,
};

let isManualSave = false;
let lastAllowedSaveTime = 0;
let originalFetch = window.fetch;
let menuCheckInterval = null;

function loadSettings() {
    extension_settings.manual_saver = extension_settings.manual_saver || {};
    extension_settings.manual_saver.enabled =
        extension_settings.manual_saver.enabled ?? defaultSettings.enabled;
    extension_settings.manual_saver.allowTimedSave =
        extension_settings.manual_saver.allowTimedSave ?? defaultSettings.allowTimedSave;
    extension_settings.manual_saver.allowInterval =
        extension_settings.manual_saver.allowInterval ?? defaultSettings.allowInterval;
    extension_settings.manual_saver.playSound =
        extension_settings.manual_saver.playSound ?? defaultSettings.playSound;
}

function playSaveSuccessSound() {
    try {
        if (!extension_settings.manual_saver.playSound) return;

        const audio = new Audio(`${extensionFolderPath}/save-success.mp3`);
        audio.volume = 0.6;
        audio.play().catch((err) => {
            console.debug('[ST-Manual-Saver] Failed to play sound:', err);
        });
    } catch (err) {
        console.debug('[ST-Manual-Saver] Audio init failed:', err);
    }
}

function isTimedSaveAllowed() {
    if (!extension_settings.manual_saver.allowTimedSave) return false;

    const intervalMs = Number(extension_settings.manual_saver.allowInterval || 0) * 60 * 1000;
    if (intervalMs <= 0) return true;

    return Date.now() - lastAllowedSaveTime >= intervalMs;
}

function isSaveRequest(url) {
    if (!url) return false;
    return url.includes('/api/chats/save') || url.includes('/api/chats/group/save');
}

window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (!isSaveRequest(url)) {
        return originalFetch.apply(this, args);
    }

    if (!extension_settings.manual_saver.enabled) {
        return originalFetch.apply(this, args);
    }

    if (isManualSave) {
        try {
            const response = await originalFetch.apply(this, args);
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
        const response = await originalFetch.apply(this, args);

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
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};

function appendSettingsHtml() {
    if ($('#manual_saver_settings').length) return;

    const settingsHtml = `
    <div id="manual_saver_settings" class="extension_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>ST Manual Saver</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input type="checkbox" id="manual_saver_enabled">
                    启用手动保存模式
                </label>
                <br>

                <label class="checkbox_label">
                    <input type="checkbox" id="manual_saver_allowTimedSave">
                    启用定时自动保存放行
                </label>
                <br>

                <label for="manual_saver_allowInterval">自动保存放行间隔（分钟）</label>
                <input
                    type="number"
                    id="manual_saver_allowInterval"
                    min="0"
                    step="1"
                    class="text_pole"
                    style="max-width: 120px;"
                >
                <br><br>

                <label class="checkbox_label">
                    <input type="checkbox" id="manual_saver_playSound">
                    保存成功时播放提示音
                </label>
            </div>
        </div>
    </div>`;

    $('#extensions_settings').append(settingsHtml);

    $('#manual_saver_enabled')
        .prop('checked', extension_settings.manual_saver.enabled)
        .on('change', function () {
            extension_settings.manual_saver.enabled = $(this).prop('checked');
            saveSettingsDebounced();
            updateButtonState();
        });

    $('#manual_saver_allowTimedSave')
        .prop('checked', extension_settings.manual_saver.allowTimedSave)
        .on('change', function () {
            extension_settings.manual_saver.allowTimedSave = $(this).prop('checked');
            saveSettingsDebounced();
        });

    $('#manual_saver_allowInterval')
        .val(extension_settings.manual_saver.allowInterval)
        .on('input change', function () {
            const value = Number($(this).val());
            extension_settings.manual_saver.allowInterval = Number.isFinite(value) && value >= 0
                ? value
                : defaultSettings.allowInterval;
            saveSettingsDebounced();
        });

    $('#manual_saver_playSound')
        .prop('checked', extension_settings.manual_saver.playSound)
        .on('change', function () {
            extension_settings.manual_saver.playSound = $(this).prop('checked');
            saveSettingsDebounced();
        });
}

async function handleManualSaveClick() {
    try {
        isManualSave = true;
        await saveChatConditional();
    } catch (err) {
        isManualSave = false;
        console.error('[ST-Manual-Saver] Manual save failed:', err);
        toastr.error('手动保存失败！');
    }
}

function getMenuContainer() {
    if ($('#extensionsMenu').length) return $('#extensionsMenu');
    if ($('#options').length) return $('#options');
    return null;
}

function updateButtonState() {
    const menu = getMenuContainer();

    if (!menu) return;

    if (!extension_settings.manual_saver.enabled) {
        $('#manualSaveButton').remove();
        return;
    }

    if (!$('#manualSaveButton').length) {
        const buttonHtml = `
        <div id="manualSaveButton" class="list-group-item flex-container" tabindex="0">
            <i class="fa-solid fa-floppy-disk"></i>
            <span>保存聊天</span>
        </div>`;
        menu.prepend(buttonHtml);

        $('#manualSaveButton').on('click', handleManualSaveClick);
    }
}

function startMenuWatcher() {
    if (menuCheckInterval) return;

    menuCheckInterval = setInterval(() => {
        updateButtonState();
    }, 500);
}

jQuery(() => {
    loadSettings();
    appendSettingsHtml();
    updateButtonState();
    startMenuWatcher();

    console.log('[ST-Manual-Saver] Loaded');
});
