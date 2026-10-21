import { isDesktop } from "ente-base/app";
import { isHLSGenerationSupported } from "ente-gallery/services/video";
import { isMLSupported } from "ente-new/photos/services/ml";
import type {
    SearchOption,
    SidebarActionID,
} from "ente-new/photos/services/search/types";
import { t } from "i18next";

interface SidebarAction {
    id: SidebarActionID;
    label: string;
    path: string[];
    keywords?: string[];
    available?: () => boolean;
}

interface SidebarActionContext {
    onClose: () => void;
    showAccount: () => void;
    showPreferences: () => void;
    showHelp: () => void;
    showFreeUpSpace: () => void;
    onShowExport: () => void;
    onLogout: () => void;
    onShowWatchFolder: () => void;
    setPendingAccountAction: (a: SidebarActionID | undefined) => void;
    setPendingPreferencesAction: (a: SidebarActionID | undefined) => void;
    setPendingHelpAction: (a: SidebarActionID | undefined) => void;
    setPendingFreeUpSpaceAction: (a: SidebarActionID | undefined) => void;
}

// Construct sidebar actions at call time so we always use initialized i18n
// strings instead of whatever was available when this module was first loaded.
const sidebarActions = (): SidebarAction[] => {
    const albumsCategory = t("albums");
    const preferencesCategory = t("preferences");
    const accountCategory = t("account");
    const helpCategory = t("help");

    return [
        {
            id: "shortcuts.uncategorized",
            label: t("section_uncategorized"),
            path: [albumsCategory, t("section_uncategorized")],
            keywords: ["uncategorized", "ungrouped"],
        },
        {
            id: "shortcuts.archive",
            label: t("section_archive"),
            path: [albumsCategory, t("section_archive")],
            keywords: ["archive", "archived"],
        },
        {
            id: "shortcuts.hidden",
            label: t("section_hidden"),
            path: [albumsCategory, t("section_hidden")],
            keywords: ["hidden", "private"],
        },
        {
            id: "shortcuts.trash",
            label: t("section_trash"),
            path: [albumsCategory, t("section_trash")],
            keywords: ["trash", "bin", "deleted"],
        },
        {
            id: "utility.account",
            label: t("account"),
            path: [preferencesCategory, t("account")],
            keywords: ["profile", "user"],
        },
        {
            id: "utility.watchFolders",
            label: t("watch_folders"),
            path: [preferencesCategory, t("watch_folders")],
            keywords: ["watch", "folder", "desktop"],
            available: () => isDesktop,
        },
        {
            id: "utility.freeUpSpace",
            label: t("free_up_space"),
            path: [preferencesCategory, t("free_up_space")],
            keywords: ["free", "space", "storage", "clean"],
        },
        {
            id: "freeUpSpace.deduplicate",
            label: t("deduplicate_files"),
            path: [
                preferencesCategory,
                t("free_up_space"),
                t("deduplicate_files"),
            ],
            keywords: ["duplicate", "dedupe"],
        },
        {
            id: "freeUpSpace.largeFiles",
            label: t("large_files_title"),
            path: [
                preferencesCategory,
                t("free_up_space"),
                t("large_files_title"),
            ],
            keywords: ["large", "big", "files", "size", "space"],
        },
        {
            id: "utility.preferences",
            label: t("preferences"),
            path: [preferencesCategory],
            keywords: ["settings"],
        },
        {
            id: "utility.help",
            label: t("help"),
            path: [helpCategory],
            keywords: ["support", "docs"],
        },
        {
            id: "utility.export",
            label: t("export_data"),
            path: [preferencesCategory, t("export_data")],
            keywords: ["export", "download"],
            available: () => isDesktop,
        },
        {
            id: "account.recoveryKey",
            label: t("recovery_key"),
            path: [accountCategory, t("recovery_key")],
            keywords: ["recovery", "key", "backup"],
        },
        {
            id: "preferences.language",
            label: t("language"),
            path: [preferencesCategory, t("language")],
            keywords: ["locale"],
        },
        {
            id: "preferences.theme",
            label: t("theme"),
            path: [preferencesCategory, t("theme")],
            keywords: ["appearance", "dark mode", "light mode"],
        },
        {
            id: "preferences.appLock",
            label: t("app_lock"),
            path: [preferencesCategory, t("app_lock")],
            keywords: ["lock", "pin", "password", "biometric", "privacy"],
            available: () => isDesktop,
        },
        {
            id: "preferences.map",
            label: t("map"),
            path: [preferencesCategory, t("map")],
            keywords: ["maps", "location"],
        },
        {
            id: "preferences.advanced",
            label: t("advanced"),
            path: [preferencesCategory, t("advanced")],
            keywords: ["advanced", "proxy", "upload"],
        },
        {
            id: "preferences.fasterUpload",
            label: t("faster_upload"),
            path: [preferencesCategory, t("advanced"), t("faster_upload")],
            keywords: ["faster", "upload", "proxy"],
        },
        {
            id: "preferences.openOnStartup",
            label: t("open_on_startup"),
            path: [
                preferencesCategory,
                t("advanced"),
                t("open_on_startup"),
            ],
            keywords: ["open", "startup", "launch", "auto launch"],
            available: () => isDesktop,
        },
        {
            id: "preferences.mlSearch",
            label: t("ml_search"),
            path: [preferencesCategory, t("ml_search")],
            keywords: ["ml", "search", "magic"],
            available: () => isMLSupported,
        },
        {
            id: "preferences.streamableVideos",
            label: t("streamable_videos"),
            path: [preferencesCategory, t("streamable_videos")],
            keywords: ["hls", "video", "stream"],
            available: () => isHLSGenerationSupported,
        },
        {
            id: "help.helpCenter",
            label: t("help_center"),
            path: [helpCategory, t("help_center")],
            keywords: ["help", "docs"],
        },
        {
            id: "help.requestFeature",
            label: t("request_feature"),
            path: [helpCategory, t("request_feature")],
            keywords: ["feature", "feedback"],
        },
        {
            id: "help.support",
            label: t("support"),
            path: [helpCategory, t("support")],
            keywords: ["contact", "support"],
        },
        {
            id: "help.viewLogs",
            label: t("view_logs"),
            path: [helpCategory, t("view_logs")],
            keywords: ["logs", "debug"],
        },
        {
            id: "utility.logout",
            label: t("logout"),
            path: [preferencesCategory, t("logout")],
            keywords: ["sign out", "signout"],
        },
    ];
};

export const sidebarSearchOptionsForString = (
    searchString: string,
): SearchOption[] => {
    const normalized = searchString.trim().toLowerCase();
    if (normalized.length < 2) return []; // avoid noisy single-letter matches

    return sidebarActions()
        .filter(({ available }) => !available || available())
        .filter(({ label, path, keywords }) =>
            matchesSearch(normalized, label, path, keywords),
        )
        .map(({ id, label, path }) => ({
            suggestion: { type: "sidebarAction", actionID: id, path, label },
            fileCount: 0,
            previewFiles: [],
        }));
};

export const performSidebarAction = async (
    actionID: SidebarActionID,
    ctx: SidebarActionContext,
): Promise<void> => {
    switch (actionID) {
        case "utility.account":
            ctx.showAccount();
            return Promise.resolve();

        case "utility.watchFolders":
            ctx.onShowWatchFolder();
            return Promise.resolve();

        case "utility.freeUpSpace":
            ctx.showFreeUpSpace();
            return Promise.resolve();

        case "freeUpSpace.deduplicate":
        case "freeUpSpace.largeFiles":
            ctx.setPendingFreeUpSpaceAction(actionID);
            ctx.showFreeUpSpace();
            return Promise.resolve();

        case "utility.preferences":
            ctx.showPreferences();
            return Promise.resolve();

        case "utility.help":
            ctx.showHelp();
            return Promise.resolve();

        case "utility.export":
            ctx.onShowExport();
            return Promise.resolve();

        case "utility.logout":
            ctx.onLogout();
            return Promise.resolve();

        case "account.recoveryKey":
            ctx.setPendingAccountAction(actionID);
            ctx.showAccount();
            return Promise.resolve();

        case "preferences.language":
        case "preferences.theme":
        case "preferences.appLock":
        case "preferences.map":
        case "preferences.advanced":
        case "preferences.fasterUpload":
        case "preferences.openOnStartup":
        case "preferences.mlSearch":
        case "preferences.streamableVideos":
            ctx.setPendingPreferencesAction(actionID);
            ctx.showPreferences();
            return Promise.resolve();

        case "help.helpCenter":
        case "help.requestFeature":
        case "help.support":
        case "help.viewLogs":
            ctx.setPendingHelpAction(actionID);
            ctx.showHelp();
            return Promise.resolve();
    }
};

const matchesSearch = (
    normalized: string,
    label: string,
    path: string[],
    keywords: string[] = [],
) => {
    const searchVariants = getSearchVariants(normalized);
    const haystack = [label, ...path, ...keywords]
        .filter(Boolean)
        .map((s) => s.toLowerCase());

    const re = new RegExp(
        "(^|[\\s.,!?\"'-_])(" +
            searchVariants.map((s) => escapeRegex(s)).join("|") +
            ")",
    );
    return haystack.some((h) => re.test(h));
};

const getSearchVariants = (search: string) => {
    const variants = new Set<string>([search]);
    if (search.endsWith("ies")) variants.add(search.slice(0, -3) + "y");
    if (search.endsWith("es")) variants.add(search.slice(0, -2));
    if (search.endsWith("s")) variants.add(search.slice(0, -1));

    return [...variants].filter((v) => v.length > 1);
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
