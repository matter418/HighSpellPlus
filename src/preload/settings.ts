abstract class SettingsSchema {
    // Store sections in a dedicated property
    static settings: { [key: string]: Section };

    static serialize(): string {
        return JSON.stringify(this.settings ?? {});
    }

    static loadFromJSON(json: string): void {
        const data = JSON.parse(json);
        // Merge values into existing schema; support both full schema shape and flattened { section: { label: value } }
        for (const sectionKey of Object.keys(data)) {
            const incomingSection = data[sectionKey];
            const existingSection = this.settings?.[sectionKey];
            if (!existingSection || !Array.isArray(existingSection.fields)) continue;

            // Case 1: full schema-like shape with fields array
            if (incomingSection && Array.isArray(incomingSection.fields)) {
                incomingSection.fields.forEach((incomingField: any, index: number) => {
                    const existingField = existingSection.fields[index];
                    if (!existingField) return;
                    // Preserve existing validation if present
                    if (existingField.validation) {
                        incomingField.validation = existingField.validation;
                    }
                    // Apply value if provided
                    if (Object.prototype.hasOwnProperty.call(incomingField, 'value')) {
                        existingField.value = incomingField.value;
                    }
                });
                continue;
            }

            // Case 2: flattened shape { label: value }
            if (incomingSection && typeof incomingSection === 'object') {
                existingSection.fields.forEach((existingField: any) => {
                    if (!existingField) return;
                    const label = existingField.label;
                    if (Object.prototype.hasOwnProperty.call(incomingSection, label)) {
                        existingField.value = incomingSection[label];
                    }
                });
            }
        }
    }

    static getSettingValueByName(name: string): string | number | boolean | undefined {
        for (const sectionKey in this.settings) {
            const section = this.settings[sectionKey];
            const field = section.fields.find(f => f.label === name);
            if (field) return field.value;
        }
        return undefined;
    }
}

interface Section {
    heading: string;
    fields: Array<Field | DropdownField | DirectoryField | ColorField | ButtonField>;
    /** Optional warning shown under the section's fields. */
    note?: string;
}

interface Field {
    label: string;
    type: SettingTypes;
    description?: string;
    default?: string | number | boolean;
    value?: string | number | boolean;
    validation?: (value: string | number | boolean) => boolean | Promise<boolean>;
    /** 'sound': changing this field plays the chosen alert sound at the section's volume field. */
    preview?: 'sound';
    /** True when the value is only read at startup; the settings page then asks for a restart. */
    restart?: boolean;
}
interface DropdownField extends Field {
    type: SettingTypes.DROPDOWN;
    options: { [key: string]: string | number | boolean };
}

interface DirectoryField extends Field {
    type: SettingTypes.DIRECTORY;
}

/** Rendered as a native color picker; value is a #rrggbb hex string. */
interface ColorField extends Field {
    type: SettingTypes.COLOR;
}

/** Rendered as a button; clicking sends `action` over IPC. Stores no value. */
interface ButtonField extends Field {
    type: SettingTypes.BUTTON;
    buttonText: string;
    action: string;
}

enum SettingTypes {
    STRING = 'string',
    NUMBER = 'number',
    BOOLEAN = 'boolean',
    DROPDOWN = 'dropdown',
    DIRECTORY = 'directory',
    COLOR = 'color',
    BUTTON = 'button'
}

const isHexColor = (value: unknown) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);



export class settingsSchema extends SettingsSchema {
    static settings = {
        Application: {
            heading: "Application Settings",
            fields: [
                {
                    label: "Release Channel",
                    type: SettingTypes.DROPDOWN,
                    description: "Select the release channel for updates.",
                    default: "Stable",
                    restart: true,
                    options: {
                        "Stable": "Stable",
                        "Beta": "Beta"
                    },
                    validation: (value) => ["Stable", "Beta"].includes(value as string),
                } as DropdownField
            ]
        },
        Plugins: {
            heading: "Plugin Settings",
            fields: [
                {
                    label: "Enable Plugins",
                    type: SettingTypes.BOOLEAN,
                    description: "Allow the use of plugins in Highspell+.",
                    default: true,
                    restart: true
                } as Field,
                {
                    label: "Allow Beta Plugins",
                    type: SettingTypes.BOOLEAN,
                    description: "Allow the use of beta plugins in Highspell+.",
                    default: false,
                    restart: true
                } as Field
            ]
        },
        Interface: {
            heading: "Interface",
            fields: [
                {
                    label: "Movable Interface",
                    type: SettingTypes.BOOLEAN,
                    description: "Hold the modifier key and drag the minimap (its minimize button follows it), compass, logout button, action bars, chat, inventory window or its tab bar to move it; drag a corner square to resize it; double-click to reset it. The layout is shared by every account and remembered between sessions.",
                    default: true
                } as Field,
                {
                    label: "Layout Modifier Key",
                    type: SettingTypes.DROPDOWN,
                    description: "Key to hold while moving or resizing panels.",
                    default: "Alt",
                    options: {
                        "Alt": "Alt",
                        "Ctrl": "Control",
                        "Shift": "Shift"
                    }
                } as DropdownField,
                {
                    label: "Reset Interface Layout",
                    type: SettingTypes.BUTTON,
                    description: "Put every panel back where the game draws it, at its normal size, on all accounts.",
                    buttonText: "Reset layout",
                    action: "ui-layout:reset"
                } as ButtonField
            ]
        },
        MultiAccount: {
            heading: "Multi-account",
            note: "Each extra account costs roughly 350 MB of RAM and keeps running in the background so it stays logged in.",
            fields: [
                {
                    label: "Enable Multiple Accounts",
                    type: SettingTypes.BOOLEAN,
                    description: "Run up to 6 HighSpell accounts in one window (HighSpell's limit). Off: one account per window, no tabs or dock.",
                    default: false,
                    restart: true
                } as Field,
                {
                    label: "Account Bar Position",
                    type: SettingTypes.DROPDOWN,
                    description: "Where the other accounts are shown. Multibox shows every account at once in a grid (2 side by side, 3 as one tall + two stacked, 4 quadrants, 5 as one tall third + four, 6 as a 3×2 grid) with no tabs or dock.",
                    default: "top",
                    options: {
                        "Tabs on top": "top",
                        "Tabs on bottom": "bottom",
                        "Dock on left": "left",
                        "Dock on right": "right",
                        "Multibox (all accounts on screen)": "multibox"
                    }
                } as DropdownField,
                {
                    label: "Live Previews",
                    type: SettingTypes.BOOLEAN,
                    description: "Capture each background account about once a second so its dock card shows a thumbnail (dock layouts only). Off: name and status only.",
                    default: true
                } as Field,
                {
                    label: "Start Collapsed",
                    type: SettingTypes.BOOLEAN,
                    description: "Dock layouts open as a thin rail of numbered buttons (tab layouts are always shown in full). Toggle any time with the chevron or Ctrl+`.",
                    default: false
                } as Field,
                {
                    label: "Background Frame Rate",
                    type: SettingTypes.DROPDOWN,
                    description: "How fast accounts you are not looking at keep rendering, and how often their dock thumbnails refresh. Higher is smoother but costs CPU and GPU per account.",
                    default: 15,
                    options: {
                        "2 fps (lowest CPU)": 2,
                        "5 fps": 5,
                        "15 fps": 15,
                        "30 fps": 30,
                        "60 fps": 60
                    }
                } as DropdownField,
                {
                    label: "Idle Alert",
                    type: SettingTypes.BOOLEAN,
                    description: "Flash a background account's tab when its character stops what it was doing (woodcutting, fishing, combat…). Clears when you switch to it.",
                    default: true
                } as Field,
                {
                    label: "Idle Alert Delay (seconds)",
                    type: SettingTypes.NUMBER,
                    description: "How long the character must sit idle before the alert fires.",
                    default: 12,
                    validation: (value) => Number(value) >= 1 && Number(value) <= 600,
                } as Field,
                {
                    label: "Idle Alert Color",
                    type: SettingTypes.COLOR,
                    description: "The color a background account's tab or card flashes when its character goes idle.",
                    default: "#f9f449",
                    validation: (value) => isHexColor(value),
                } as ColorField,
                {
                    label: "Idle Sound",
                    type: SettingTypes.DROPDOWN,
                    description: "Sound played by the idle account. Picking one plays a preview. Leave Off if you use the Idle Alert plugin, which has its own sound.",
                    default: "Off",
                    options: {
                        "Off": "Off",
                        "Ding": "Ding",
                        "Chime": "Chime",
                        "Bell": "Bell",
                        "Blip": "Blip",
                        "Knock": "Knock",
                        "Idle Alert": "Idle Alert"
                    },
                    preview: "sound"
                } as DropdownField,
                {
                    label: "Idle Sound Volume (%)",
                    type: SettingTypes.NUMBER,
                    description: "Loudness of the idle sound, 0 to 100.",
                    default: 60,
                    validation: (value) => Number(value) >= 0 && Number(value) <= 100,
                } as Field,
                {
                    label: "Isolate Account Sessions",
                    type: SettingTypes.BOOLEAN,
                    description: "Give every account its own cookies, storage and plugin installs. Off: all accounts share one profile, so your installed plugins and settings carry over to every tab.",
                    default: false,
                    restart: true
                } as Field
            ]
        },
        Screenshots: {
            heading: "Screenshots",
            fields: [
                {
                    label: "Screenshot Directory",
                    type: SettingTypes.DIRECTORY,
                    description: "The directory where screenshots are saved.",
                    default: "/path/to/screenshots",
                    validation: async (value) => {
                        if (typeof value !== 'string' || !value.trim()) return false;
                        try {
                            const ok = await globalThis.electron.ipcRenderer.invoke('settings:validate-directory', value);
                            return Boolean(ok);
                        } catch {
                            return false;
                        }
                    }
                } as DirectoryField
            ]
        }
    };
}