// Use centralized settings API exposed by preload
import '@iconify/iconify';
import { playAlertSound, DEFAULT_ALERT_VOLUME } from '../shared/alertSounds';
import { isHexColor } from '../../shared/validators';

/** How long a settings button shows "Done" before its label comes back. */
const BUTTON_FEEDBACK_MS = 1500;

const isDarwin = window.electron.process.platform === 'darwin';
// Hide the window controls if the OS is Darwin (macOS)
if (isDarwin) {
    const windowControls = document.getElementById('window-controls');
    if (windowControls) {
        windowControls.remove();
    }
} else {
    const darwinSpacer = document.getElementById('darwin-spacer');
    if (darwinSpacer) {
        darwinSpacer.remove();
    }
}

// Obtain references to the minimize, maximize, and close buttons
const minimizeButton = document.querySelector<HTMLAnchorElement>('#minimizeBtn');
const maximizeButton = document.querySelector<HTMLAnchorElement>('#maximizeBtn');
const closeButton = document.querySelector<HTMLAnchorElement>('#closeBtn');

// Add click event listeners to the buttons
if (minimizeButton) {
    minimizeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('minimize-window');
    });
}
if (maximizeButton) {
    maximizeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('toggle-maximize-window');
    });
}
if (closeButton) {
    closeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('close-window');
    });
}

// Render settings UI from schema into #settings-content
function createFieldEl(sectionKey: string, field: any): HTMLElement {
    const fieldWrapper = document.createElement('div');
    fieldWrapper.className = 'setting-field';

    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = field.label;

    const desc = document.createElement('div');
    desc.className = 'setting-description';
    if (field.description) desc.textContent = field.description;

    let control: HTMLElement;
    const type: string = field.type;

    const nameAttr = `${sectionKey}:${field.label}`;
    const settingVal = field.value ?? field.default;

    switch (type) {
        case 'boolean': {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = Boolean(settingVal);
            input.id = nameAttr;
            input.className = 'setting-input setting-checkbox';
            control = input;
            break;
        }
        case 'number': {
            const input = document.createElement('input');
            input.type = 'number';
            if (typeof settingVal === 'number') input.value = String(settingVal);
            input.id = nameAttr;
            input.className = 'setting-input setting-number';
            control = input;
            break;
        }
        case 'dropdown': {
            const select = document.createElement('select');
            select.id = nameAttr;
            select.className = 'setting-input setting-select';
            const options = field.options || {};
            Object.keys(options).forEach((key) => {
                const opt = document.createElement('option');
                opt.value = String(options[key]);
                opt.textContent = String(key);
                select.appendChild(opt);
            });
            if (settingVal !== undefined) select.value = String(settingVal);
            control = select;
            break;
        }
        case 'button': {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = field.buttonText || field.label;
            btn.className = 'btn btn-secondary';
            btn.addEventListener('click', () => {
                window.electron.ipcRenderer.send(field.action);
                btn.textContent = 'Done';
                setTimeout(() => { btn.textContent = field.buttonText || field.label; }, BUTTON_FEEDBACK_MS);
            });
            control = btn;
            break;
        }
        case 'color': {
            const input = document.createElement('input');
            input.type = 'color';
            input.value = isHexColor(settingVal) ? settingVal : '#000000';
            input.id = nameAttr;
            input.className = 'setting-input setting-color';
            control = input;
            break;
        }
        case 'directory': {
            // Render as text input + choose button below
            const input = document.createElement('input');
            input.type = 'text';
            if (typeof settingVal === 'string') input.value = settingVal;
            input.id = nameAttr;
            input.placeholder = '/path/to/folder';
            input.className = 'setting-input setting-text';
            control = input;
            break;
        }
        case 'string':
        default: {
            const input = document.createElement('input');
            input.type = 'text';
            if (typeof settingVal === 'string') input.value = settingVal;
            input.id = nameAttr;
            input.className = 'setting-input setting-text';
            control = input;
            break;
        }
    }

    const right = document.createElement('div');
    right.className = 'setting-right';
    right.appendChild(control);

    // Show the hex value next to a color swatch and keep it in sync (the picker alone gives
    // no readable value, and people paste hex codes from other tools).
    if (field.type === 'color') {
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'setting-color-hex';
        hex.maxLength = 7;
        hex.value = (control as HTMLInputElement).value;
        hex.setAttribute('aria-label', `${field.label} hex value`);
        control.addEventListener('input', () => { hex.value = (control as HTMLInputElement).value; });
        hex.addEventListener('input', () => {
            if (isHexColor(hex.value)) {
                (control as HTMLInputElement).value = hex.value;
                (control as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
                (control as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        // A half-typed or bad hex never sticks: on leaving the box, fall back to what the picker holds.
        const resync = () => {
            if (!isHexColor(hex.value)) hex.value = (control as HTMLInputElement).value;
        };
        hex.addEventListener('blur', resync);
        hex.addEventListener('change', resync);
        right.appendChild(hex);
    }

    // Add chooser button for DIRECTORY fields
    if (field.type === 'directory') {
        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.textContent = 'Choose…';
        chooseBtn.className = 'btn btn-secondary';
        chooseBtn.addEventListener('click', async () => {
            try {
                const currentVal = (control as HTMLInputElement).value || (typeof settingVal === 'string' ? settingVal : undefined);
                const selected = await window.settings.selectDirectory({
                    title: `Select ${field.label}`,
                    defaultPath: currentVal,
                });
                if (selected) {
                    (control as HTMLInputElement).value = selected;
                    (control as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
                    (control as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch (e) {
                console.error('Directory selection failed', e);
            }
        });
        right.appendChild(chooseBtn);
    }
    if (field.preview === 'sound') {
        // Preview the chosen sound at the volume in the field the schema names (ids are "Section:Label",
        // so getElementById is an exact match with no selector escaping).
        control.addEventListener('change', () => {
            const volumeInput = field.volumeField
                ? (document.getElementById(`${sectionKey}:${field.volumeField}`) as HTMLInputElement | null)
                : null;
            const volume = volumeInput ? Number(volumeInput.value) : DEFAULT_ALERT_VOLUME;
            playAlertSound((control as HTMLSelectElement).value, volume);
        });
    }

    if (field.validation) {
        const badge = document.createElement('span');
        badge.className = 'setting-badge';
        badge.hidden = true;
        right.appendChild(badge);

        const updateBadge = async () => {
            let value: string | number | boolean;
            if ((control as HTMLInputElement).type === 'checkbox') {
                value = (control as HTMLInputElement).checked;
            } else if (control.tagName.toLowerCase() === 'select') {
                value = (control as HTMLSelectElement).value;
            } else {
                const v = (control as HTMLInputElement).value;
                value = (control as HTMLInputElement).type === 'number' ? Number(v) : v;
            }
            const result = field.validation(value);
            const valid = result instanceof Promise ? await result : result;
            // Only speak up when something is wrong; a permanent "Valid" chip is noise.
            badge.textContent = valid ? '' : 'Invalid';
            badge.hidden = !!valid;
            badge.classList.toggle('bad', !valid);
        };

        control.addEventListener('input', updateBadge);
        control.addEventListener('change', updateBadge);
        updateBadge();
    }

    const left = document.createElement('div');
    left.className = 'setting-left';
    left.appendChild(label);
    if (field.description) left.appendChild(desc);

    fieldWrapper.appendChild(left);
    fieldWrapper.appendChild(right);
    return fieldWrapper;
}

async function renderSettings() {
    const container = document.getElementById('settings-content');
    if (!container) return;
    container.innerHTML = '';

    // Floating action bar (apply/reset)
    const actionBar = document.createElement('div');
    actionBar.id = 'settings-action-bar';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-apply';
    applyBtn.textContent = 'Apply';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-reset';
    resetBtn.textContent = 'Reset';
    // Shown only when a save fails, so the bar does not just sit there with no explanation.
    const saveError = document.createElement('span');
    saveError.className = 'save-error';
    saveError.setAttribute('role', 'alert');
    actionBar.appendChild(saveError);
    actionBar.appendChild(resetBtn);
    actionBar.appendChild(applyBtn);
    document.body.appendChild(actionBar);
    const showSaveError = (msg: string) => {
        saveError.textContent = msg;
        actionBar.classList.add('failed');
    };
    const clearSaveError = () => {
        saveError.textContent = '';
        actionBar.classList.remove('failed');
    };

    const getVal = (el: HTMLElement): string | number | boolean => {
        if ((el as HTMLInputElement).type === 'checkbox') return (el as HTMLInputElement).checked;
        if (el.tagName.toLowerCase() === 'select') return (el as HTMLSelectElement).value;
        const inp = el as HTMLInputElement;
        return inp.type === 'number' ? Number(inp.value) : inp.value;
    };
    const setVal = (el: HTMLElement, v: any) => {
        if ((el as HTMLInputElement).type === 'checkbox') {
            (el as HTMLInputElement).checked = Boolean(v);
        } else if (el.tagName.toLowerCase() === 'select') {
            (el as HTMLSelectElement).value = String(v ?? '');
        } else {
            const inp = el as HTMLInputElement;
            inp.value = v == null ? '' : String(v);
        }
        (el as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
        (el as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    };

    const snapshot = new Map<string, string | number | boolean>();
    const controls: HTMLElement[] = [];
    const fieldsByKey = new Map<string, any>();
    const allSettings = await window.settings.getAll();
    const { settingsSchema } = await import('../../preload/settings');
    Object.entries(settingsSchema.settings).forEach(([sectionKey, section]: any) => {
        // Patch values from loaded settings
        (section.fields || []).forEach((field: any) => {
            if (allSettings?.[sectionKey]?.[field.label] !== undefined) {
                field.value = allSettings[sectionKey][field.label];
            } else {
                field.value = field.default;
            }
        });
        const sectionEl = document.createElement('section');
        sectionEl.className = 'settings-section';

        const header = document.createElement('h2');
        header.className = 'settings-heading';
        header.textContent = section.heading || sectionKey;

        const card = document.createElement('div');
        card.className = 'settings-card';

        (section.fields || []).forEach((field: any) => {
            const fieldEl = createFieldEl(sectionKey, field);
            // collect controls and seed snapshot. Buttons are actions, not values: they render no
            // .setting-input, so they take no part in dirty tracking or saving.
            const control = fieldEl.querySelector('.setting-input') as HTMLElement | null;
            if (control) {
                const key = `${sectionKey}:${field.label}`;
                (control as HTMLElement).setAttribute('data-key', key);
                controls.push(control);
                fieldsByKey.set(key, field);
            }
            card.appendChild(fieldEl);
        });

        if (section.note) {
            const note = document.createElement('div');
            note.className = 'settings-note';
            note.setAttribute('role', 'note');
            const icon = document.createElement('i');
            icon.className = 'iconify';
            icon.setAttribute('data-icon', 'material-symbols:warning-outline');
            const text = document.createElement('span');
            text.textContent = section.note;
            note.appendChild(icon);
            note.appendChild(text);
            card.appendChild(note);
        }

        sectionEl.appendChild(header);
        sectionEl.appendChild(card);
        container.appendChild(sectionEl);
    });

    // Initialize snapshot after DOM added
    controls.forEach((c) => {
        const key = (c as HTMLElement).getAttribute('data-key')!;
        snapshot.set(key, getVal(c));
    });

    // True when a control's value differs from the snapshot; an empty number box is NaN both
    // times, and NaN !== NaN, so that case is normalised to "unchanged".
    const hasChanged = (key: string, cur: string | number | boolean) => {
        const base = snapshot.get(key);
        if (typeof base === 'number' && typeof cur === 'number' && isNaN(base) && isNaN(cur)) return false;
        return cur !== base;
    };

    const evaluateDirty = () => {
        const isDirty = controls.some((c) => hasChanged((c as HTMLElement).getAttribute('data-key')!, getVal(c)));
        actionBar.classList.toggle('visible', isDirty);
    };

    // Wire change listeners for dirty tracking
    controls.forEach((c) => {
        c.addEventListener('input', evaluateDirty);
        c.addEventListener('change', evaluateDirty);
    });

    // Reset: revert to snapshot
    resetBtn.addEventListener('click', () => {
        controls.forEach((c) => {
            const key = (c as HTMLElement).getAttribute('data-key')!;
            const base = snapshot.get(key);
            setVal(c, base);
        });
        clearSaveError();
        actionBar.classList.remove('visible');
    });

    // Apply: promote current values to snapshot
    applyBtn.addEventListener('click', async () => {
        const invalidElements = document.querySelectorAll('.bad');
        if (invalidElements.length > 0) {
            showSaveError('Fix the highlighted fields first.');
            return;
        }
        clearSaveError();

        // Collect every value. Only fields flagged `restart` in the schema are read solely at
        // startup; everything else is picked up live via 'settings:changed'.
        const entries: Array<{ section: string; key: string; value: string | number | boolean }> = [];
        let needsRestart = false;
        controls.forEach((c) => {
            const key = (c as HTMLElement).getAttribute('data-key')!; // Section:Label
            const [sectionKey, label] = key.split(':');
            const value = getVal(c);
            entries.push({ section: sectionKey, key: label, value });
            if (hasChanged(key, value) && fieldsByKey.get(key)?.restart) needsRestart = true;
        });

        // One call, one write to disk. A failure keeps the bar up with a message instead of
        // leaving the user guessing whether anything saved.
        applyBtn.disabled = true;
        try {
            await window.settings.setMany(entries);
        } catch (e) {
            console.error('Saving settings failed:', e);
            showSaveError('Could not save settings. Try again.');
            return;
        } finally {
            applyBtn.disabled = false;
        }

        // Update snapshot after applying
        controls.forEach((c) => {
            const key = (c as HTMLElement).getAttribute('data-key')!;
            snapshot.set(key, getVal(c));
        });
        actionBar.classList.remove('visible');

        // Show restart-required modal only when a startup-only setting changed
        const modal = needsRestart ? document.getElementById('restart-modal') : null;
        if (modal) {
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            const okBtn = document.getElementById('restart-ok');
            if (okBtn) {
                const onClose = () => {
                    modal.classList.remove('show');
                    modal.setAttribute('aria-hidden', 'true');
                    okBtn.removeEventListener('click', onClose);
                };
                okBtn.addEventListener('click', onClose);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', renderSettings);