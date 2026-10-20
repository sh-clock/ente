import {
    app,
    BrowserWindow,
    Menu,
    MenuItemConstructorOptions,
} from "electron";
import { allowWindowClose } from "../main";
import { setShouldHideDockIcon, shouldHideDockIcon } from "./services/store";

export const createApplicationMenu = () => {
    let hideDockIcon = shouldHideDockIcon();

    const macOSOnly = (options: MenuItemConstructorOptions[]) =>
        process.platform == "darwin" ? options : [];

    const toggleHideDockIcon = () => {
        setShouldHideDockIcon(!hideDockIcon);
        hideDockIcon = !hideDockIcon;
    };

    return Menu.buildFromTemplate([
        {
            label: "Photos",
            submenu: [
                ...macOSOnly([{ label: "About Photos", role: "about" }]),
                { type: "separator" },

                ...macOSOnly([
                    {
                        label: "Preferences",
                        submenu: [
                            {
                                label: "Hide Dock Icon",
                                type: "checkbox",
                                checked: hideDockIcon,
                                click: toggleHideDockIcon,
                            },
                        ],
                    },
                ]),

                { type: "separator" },
                ...macOSOnly([
                    { label: "Hide Photos", role: "hide" },
                    { label: "Hide Others", role: "hideOthers" },
                    { type: "separator" },
                ]),
                { label: "Quit", role: "quit" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { label: "Undo", role: "undo" },
                { label: "Redo", role: "redo" },
                { type: "separator" },
                { label: "Cut", role: "cut" },
                { label: "Copy", role: "copy" },
                { label: "Paste", role: "paste" },
                { label: "Select All", role: "selectAll" },
                ...macOSOnly([
                    { type: "separator" },
                    {
                        label: "Speech",
                        submenu: [
                            { role: "startSpeaking", label: "Start Speaking" },
                            { role: "stopSpeaking", label: "Stop Speaking" },
                        ],
                    },
                ]),
            ],
        },
        {
            label: "View",
            submenu: [
                { label: "Reload", role: "reload" },
                { label: "Toggle Dev Tools", role: "toggleDevTools" },
                { type: "separator" },
                { label: "Toggle Full Screen", role: "togglefullscreen" },
            ],
        },
        {
            label: "Window",
            submenu: [
                { label: "Minimize", role: "minimize" },
                { label: "Zoom", role: "zoom" },
                { label: "Close", role: "close" },
                ...macOSOnly([
                    { type: "separator" },
                    { label: "Bring All to Front", role: "front" },
                    { type: "separator" },
                    { label: "Photos", role: "window" },
                ]),
            ],
        },
    ]);
};

export const createTrayContextMenu = (mainWindow: BrowserWindow) => {
    const handleOpen = () => {
        mainWindow.show();
    };

    const handleClose = () => {
        allowWindowClose();
        app.quit();
    };

    return Menu.buildFromTemplate([
        { label: "Open Photos", click: handleOpen },
        { label: "Quit Photos", click: handleClose },
    ]);
};
