import type { RemotePullOpts } from "@/components/gallery";
import {
    downloadAndSaveCollectionFiles,
} from "@/services/save";
import { Delete02Icon, CleanIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PublicIcon from "@mui/icons-material/Public";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import SortIcon from "@mui/icons-material/Sort";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Box, IconButton, Menu, Stack, Tooltip } from "@mui/material";
import { SpacedRow } from "ente-base/components/containers";
import { ActivityIndicator } from "ente-base/components/mui/ActivityIndicator";
import {
    OverflowMenu,
    OverflowMenuOption,
} from "ente-base/components/OverflowMenu";
import { useModalVisibility } from "ente-base/components/utils/modal";
import { useBaseContext } from "ente-base/context";
import type { AddSaveGroup } from "ente-gallery/components/utils/save-groups";
import { uniqueFilesByID } from "ente-gallery/utils/file";
import {
    CollectionOrder,
    type Collection,
} from "ente-media/collection";
import type { CollectionSortBy } from "ente-media/collection-sort";
import { ItemVisibility } from "ente-media/file-metadata";
import {
    GalleryItemsHeaderAdapter,
    GalleryItemsSummary,
} from "ente-new/photos/components/gallery/ListHeader";
import {
    cleanUncategorized,
    defaultHiddenCollectionUserFacingName,
    deleteCollection,
    findDefaultHiddenCollectionIDs,
    isHiddenCollection,
    updateCollectionOrder,
    updateCollectionSortOrder,
    updateCollectionVisibility,
} from "ente-new/photos/services/collection";
import {
    PseudoCollectionID,
    type CollectionSummary,
    type CollectionSummaryType,
} from "ente-new/photos/services/collection-summary";
import {
    savedCollectionFiles,
    savedCollections,
} from "ente-new/photos/services/photos-fdb";
import { emptyTrash } from "ente-new/photos/services/trash";
import { usePhotosAppContext } from "ente-new/photos/types/context";
import { t } from "i18next";
import React, { useCallback, useRef } from "react";
import { Trans } from "react-i18next";

export interface CollectionHeaderProps {
    collectionSummary: CollectionSummary;
    activeCollection: Collection | undefined;
    setActiveCollectionID: (collectionID: number) => void;
    isActiveCollectionDownloadInProgress: () => boolean;
    onRemotePull: (opts?: RemotePullOpts) => Promise<void>;
    onCollectionSlideshow: () => void;
    onEditAlbumDetails: () => void;
    hasActiveFileSelection: boolean;
    onAddSaveGroup: AddSaveGroup;
    onShowMap: () => void;
    onDescriptionHeightChange?: (height: number) => void;
}

export const CollectionHeader: React.FC<CollectionHeaderProps> = (props) => {
    const { activeCollection, collectionSummary, onDescriptionHeightChange } =
        props;

    const { name, type, attributes, fileCount } = collectionSummary;
    const description =
        activeCollection?.pubMagicMetadata?.data.caption?.trim();

    const EndIcon = () => {
        if (attributes.has("archived")) return <ArchiveOutlinedIcon />;
        if (attributes.has("userFavorites"))
            return (
                <HugeiconsIcon
                    icon={StarIcon}
                    size="1em"
                    fill="currentColor"
                    aria-hidden
                />
            );
        return <></>;
    };

    return (
        <GalleryItemsHeaderAdapter>
            <SpacedRow>
                <GalleryItemsSummary
                    name={name}
                    description={description}
                    descriptionMaxWidth={480}
                    fileCount={fileCount}
                    endIcon={<EndIcon />}
                    onDescriptionHeightChange={onDescriptionHeightChange}
                />
                {shouldShowOptions(type) && (
                    <CollectionHeaderOptions {...props} />
                )}
            </SpacedRow>
        </GalleryItemsHeaderAdapter>
    );
};

const shouldShowOptions = (type: CollectionSummaryType) =>
    type != "all" && type != "archiveItems";

const CollectionHeaderOptions: React.FC<CollectionHeaderProps> = ({
    activeCollection,
    collectionSummary,
    setActiveCollectionID,
    onRemotePull,
    onCollectionSlideshow,
    onEditAlbumDetails,
    hasActiveFileSelection,
    onAddSaveGroup,
    isActiveCollectionDownloadInProgress,
    onShowMap,
}) => {
    const { showMiniDialog, onGenericError } = useBaseContext();
    const { showLoadingBar, hideLoadingBar, showNotification } =
        usePhotosAppContext();
    const overflowMenuIconRef = useRef<SVGSVGElement | null>(null);

    const { show: showSortOrderMenu, props: sortOrderMenuVisibilityProps } =
        useModalVisibility();

    const { type: collectionSummaryType, fileCount } = collectionSummary;

    const wrap = useCallback(
        (f: () => Promise<void>) => {
            const wrapped = async () => {
                showLoadingBar();
                try {
                    await f();
                } catch (e) {
                    onGenericError(e);
                } finally {
                    void onRemotePull({ silent: true });
                    hideLoadingBar();
                }
            };
            return (): void => void wrapped();
        },
        [showLoadingBar, hideLoadingBar, onGenericError, onRemotePull],
    );

    const hasAlbumFiles = fileCount > 0;

    const confirmDeleteCollection = () => {
        if (hasAlbumFiles) {
            showMiniDialog({
                title: t("delete_album_title"),
                kind: "info",
                message: (
                    <Trans
                        i18nKey={"delete_album_message"}
                        components={{
                            a: (
                                <Box
                                    component={"span"}
                                    sx={{ color: "text.base" }}
                                />
                            ),
                        }}
                    />
                ),
                continue: {
                    text: t("keep_photos"),
                    color: "primary",
                    action: deleteCollectionButKeepFiles,
                },
                secondary: {
                    text: t("delete_photos"),
                    color: "critical",
                    action: deleteCollectionAlongWithFiles,
                },
            });
            return;
        }

        showMiniDialog({
            title: t("delete_album_title"),
            kind: "info",
            message: (
                <Trans
                    i18nKey={"delete_album_message_no_photos"}
                    components={{
                        a: (
                            <Box
                                component={"span"}
                                sx={{ color: "text.base" }}
                            />
                        ),
                    }}
                />
            ),
            continue: {
                text: t("delete_album"),
                color: "critical",
                action: deleteCollectionAlongWithFiles,
            },
        });
    };

    const deleteCollectionAlongWithFiles = wrap(async () => {
        if (!activeCollection) return;
        await deleteCollection(activeCollection.id);
        setActiveCollectionID(PseudoCollectionID.all);
    });

    const deleteCollectionButKeepFiles = wrap(async () => {
        if (!activeCollection) return;
        await deleteCollection(activeCollection.id, { keepFiles: true });
        setActiveCollectionID(PseudoCollectionID.all);
    });

    const confirmEmptyTrash = () =>
        showMiniDialog({
            title: t("empty_trash_title"),
            kind: "warning",
            message: t("empty_trash_message"),
            continue: {
                text: t("empty_trash"),
                color: "critical",
                action: doEmptyTrash,
            },
        });

    const doEmptyTrash = wrap(async () => {
        await emptyTrash();
        setActiveCollectionID(PseudoCollectionID.all);
    });

    const confirmCleanUncategorized = () =>
        showMiniDialog({
            title: t("clean_uncategorized"),
            message: t("clean_uncategorized_message"),
            continue: {
                text: t("clean_uncategorized"),
                color: "primary",
                action: doCleanUncategorized,
            },
        });

    const doCleanUncategorized = wrap(async () => {
        if (!activeCollection) return;
        const count = await cleanUncategorized(activeCollection);
        showNotification({
            color: "secondary",
            title: t("clean_uncategorized_success", { count }),
        });
    });

    const _downloadCollection = async () => {
        if (isActiveCollectionDownloadInProgress()) return;

        if (collectionSummaryType == "hiddenItems") {
            const defaultHiddenCollectionsIDs = findDefaultHiddenCollectionIDs(
                await savedCollections(),
            );
            const collectionFiles = await savedCollectionFiles();
            const defaultHiddenCollectionFiles = uniqueFilesByID(
                collectionFiles.filter((file) =>
                    defaultHiddenCollectionsIDs.has(file.collectionID),
                ),
            );
            await downloadAndSaveCollectionFiles(
                defaultHiddenCollectionUserFacingName,
                PseudoCollectionID.hiddenItems,
                defaultHiddenCollectionFiles,
                true,
                onAddSaveGroup,
            );
        } else if (activeCollection) {
            await downloadAndSaveCollectionFiles(
                activeCollection.name,
                activeCollection.id,
                (await savedCollectionFiles()).filter(
                    (file) => file.collectionID == activeCollection.id,
                ),
                isHiddenCollection(activeCollection),
                onAddSaveGroup,
            );
        }
    };

    const downloadCollection = () =>
        void _downloadCollection().catch(onGenericError);

    const archiveAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionVisibility(
            activeCollection,
            ItemVisibility.archived,
        );
    });

    const unarchiveAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionVisibility(
            activeCollection,
            ItemVisibility.visible,
        );
    });

    const pinAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionOrder(activeCollection, CollectionOrder.pinned);
    });

    const unpinAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionOrder(activeCollection, CollectionOrder.default);
    });

    const hideAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionVisibility(
            activeCollection,
            ItemVisibility.hidden,
        );
        setActiveCollectionID(PseudoCollectionID.all);
    });

    const unhideAlbum = wrap(async () => {
        if (!activeCollection) return;
        await updateCollectionVisibility(
            activeCollection,
            ItemVisibility.visible,
        );
        setActiveCollectionID(PseudoCollectionID.hiddenItems);
    });

    const changeSortOrder = (sortBy: CollectionSortBy, asc: boolean) => {
        wrap(async () => {
            if (!activeCollection) return;
            await updateCollectionSortOrder(activeCollection, asc, sortBy);
        })();
    };

    let menuOptions: React.ReactNode[] = [];
    // MUI rejects fragments here, so return keyed arrays.
    switch (collectionSummaryType) {
        case "trash":
            break;

        case "userFavorites":
            menuOptions = [];
            break;

        case "uncategorized":
            break;

        case "hiddenItems":
            break;

        case "sharedIncoming":
            break;

        default:
            menuOptions = [
                activeCollection && (
                    <OverflowMenuOption
                        key="edit-details"
                        onClick={onEditAlbumDetails}
                        startIcon={<EditIcon />}
                    >
                        {t("edit_details")}
                    </OverflowMenuOption>
                ),
                <OverflowMenuOption
                    key="sort"
                    onClick={showSortOrderMenu}
                    startIcon={<SortIcon />}
                >
                    {t("sort_by")}
                </OverflowMenuOption>,
                shouldShowMapOption(collectionSummary) && (
                    <OverflowMenuOption
                        key="map"
                        onClick={onShowMap}
                        startIcon={<MapOutlinedIcon />}
                    >
                        {t("map")}
                    </OverflowMenuOption>
                ),
                collectionSummary.attributes.has("pinned") ? (
                    <OverflowMenuOption
                        key="unpin"
                        onClick={unpinAlbum}
                        startIcon={<PushPinOutlinedIcon />}
                    >
                        {t("unpin_album")}
                    </OverflowMenuOption>
                ) : (
                    <OverflowMenuOption
                        key="pin"
                        onClick={pinAlbum}
                        startIcon={<PushPinIcon />}
                    >
                        {t("pin_album")}
                    </OverflowMenuOption>
                ),
                ...(!activeCollection || !isHiddenCollection(activeCollection)
                    ? [
                          collectionSummary.attributes.has("archived") ? (
                              <OverflowMenuOption
                                  key="unarchive"
                                  onClick={unarchiveAlbum}
                                  startIcon={<UnarchiveIcon />}
                              >
                                  {t("unarchive_album")}
                              </OverflowMenuOption>
                          ) : (
                              <OverflowMenuOption
                                  key="archive"
                                  onClick={archiveAlbum}
                                  startIcon={<ArchiveOutlinedIcon />}
                              >
                                  {t("archive_album")}
                              </OverflowMenuOption>
                          ),
                      ]
                    : []),
                activeCollection && isHiddenCollection(activeCollection) ? (
                    <OverflowMenuOption
                        key="unhide"
                        onClick={unhideAlbum}
                        startIcon={<VisibilityOutlinedIcon />}
                    >
                        {t("unhide_collection")}
                    </OverflowMenuOption>
                ) : (
                    <OverflowMenuOption
                        key="hide"
                        onClick={hideAlbum}
                        startIcon={<VisibilityOffOutlinedIcon />}
                    >
                        {t("hide_collection")}
                    </OverflowMenuOption>
                ),
                <OverflowMenuOption
                    key="delete"
                    startIcon={<DeleteOutlinedIcon />}
                    onClick={confirmDeleteCollection}
                >
                    {t("delete_album")}
                </OverflowMenuOption>,
            ];
            break;
    }

    if (activeCollection)
        menuOptions.push(
            <OverflowMenuOption
                key="slideshow"
                startIcon={<SlideshowIcon />}
                onClick={onCollectionSlideshow}
            >
                {t("slideshow")}
            </OverflowMenuOption>,
        );
    const validMenuOptions = menuOptions.filter((o) => !!o);

    return (
        <Box sx={{ display: "inline-flex", gap: "16px" }}>
            <QuickOptions
                collectionSummary={collectionSummary}
                hasActiveFileSelection={hasActiveFileSelection}
                isDownloadInProgress={isActiveCollectionDownloadInProgress}
                onMapClick={onShowMap}
                onEmptyTrashClick={confirmEmptyTrash}
                onDownloadClick={downloadCollection}
                onCleanUncategorizedClick={confirmCleanUncategorized}
            />
            {validMenuOptions.length > 0 && (
                <OverflowMenu
                    ariaID="collection-options"
                    triggerButtonIcon={
                        <MoreHorizIcon ref={overflowMenuIconRef} />
                    }
                >
                    {validMenuOptions}
                </OverflowMenu>
            )}
            <CollectionSortOrderMenu
                {...sortOrderMenuVisibilityProps}
                overflowMenuIconRef={overflowMenuIconRef}
                sortAsc={activeCollection?.pubMagicMetadata?.data.asc ?? false}
                sortBy={
                    activeCollection?.pubMagicMetadata?.data.sortBy ===
                    "fileName"
                        ? "fileName"
                        : "date"
                }
                onSort={changeSortOrder}
            />
        </Box>
    );
};

interface OptionProps {
    disabled?: boolean;
    onClick: () => void;
}

interface QuickOptionsProps {
    collectionSummary: CollectionSummary;
    hasActiveFileSelection: boolean;
    isDownloadInProgress: () => boolean;
    onMapClick: () => void;
    onEmptyTrashClick: () => void;
    onDownloadClick: () => void;
    onCleanUncategorizedClick: () => void;
}

const QuickOptions: React.FC<QuickOptionsProps> = ({
    onMapClick,
    onEmptyTrashClick,
    onDownloadClick,
    onCleanUncategorizedClick,
    collectionSummary,
    hasActiveFileSelection,
    isDownloadInProgress,
}) => (
    <Stack direction="row" sx={{ alignItems: "center", gap: "16px" }}>
        {showEmptyTrashQuickOption(collectionSummary) && (
            <EmptyTrashQuickOption
                disabled={hasActiveFileSelection}
                onClick={onEmptyTrashClick}
            />
        )}
        {showDownloadQuickOption(collectionSummary) &&
            collectionSummary.fileCount > 0 &&
            (isDownloadInProgress() ? (
                <ActivityIndicator size="20px" sx={{ m: "12px" }} />
            ) : (
                <DownloadQuickOption
                    collectionSummary={collectionSummary}
                    disabled={hasActiveFileSelection}
                    onClick={onDownloadClick}
                />
            ))}
        {showCleanUncategorizedQuickOption(collectionSummary) && (
            <CleanUncategorizedQuickOption
                onClick={onCleanUncategorizedClick}
            />
        )}
        {showMapQuickOption(collectionSummary) && (
            <MapQuickOption onClick={onMapClick} />
        )}
    </Stack>
);

const showEmptyTrashQuickOption = ({ type, fileCount }: CollectionSummary) =>
    type == "trash" && fileCount > 0;

const EmptyTrashQuickOption: React.FC<OptionProps> = ({
    disabled,
    onClick,
}) => (
    <Tooltip title={t("empty_trash")}>
        <span>
            <IconButton disabled={disabled} onClick={onClick}>
                <HugeiconsIcon
                    icon={Delete02Icon}
                    size={22}
                    strokeWidth={1.5}
                />
            </IconButton>
        </span>
    </Tooltip>
);

const showCleanUncategorizedQuickOption = ({
    type,
    fileCount,
}: CollectionSummary) => type == "uncategorized" && fileCount > 0;

const CleanUncategorizedQuickOption: React.FC<OptionProps> = ({ onClick }) => (
    <Tooltip title={t("clean_uncategorized")}>
        <IconButton onClick={onClick}>
            <HugeiconsIcon icon={CleanIcon} size={22} strokeWidth={1.5} />
        </IconButton>
    </Tooltip>
);

const MapQuickOption: React.FC<OptionProps> = ({ onClick }) => (
    <Tooltip title={t("map")}>
        <IconButton onClick={onClick}>
            <Box
                sx={{
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <PublicIcon />
            </Box>
        </IconButton>
    </Tooltip>
);

const showDownloadQuickOption = ({ type, attributes }: CollectionSummary) =>
    type == "album" ||
    type == "folder" ||
    type == "uncategorized" ||
    type == "hiddenItems" ||
    attributes.has("favorites") ||
    attributes.has("shared");

const showMapQuickOption = (collectionSummary: CollectionSummary) =>
    collectionSummary.type == "userFavorites" &&
    shouldShowMapOption(collectionSummary);

const shouldShowMapOption = ({ type, fileCount }: CollectionSummary) =>
    fileCount > 0 &&
    type !== "all" &&
    type !== "archiveItems" &&
    type !== "trash" &&
    type !== "hiddenItems";

type DownloadQuickOptionProps = OptionProps & {
    collectionSummary: CollectionSummary;
};

const DownloadIcon: React.FC = () => (
    <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M2.99969 17.0002C2.99969 17.9302 2.99969 18.3952 3.10192 18.7767C3.37932 19.8119 4.18796 20.6206 5.22324 20.898C5.60474 21.0002 6.06972 21.0002 6.99969 21.0002L16.9997 21.0002C17.9297 21.0002 18.3947 21.0002 18.7762 20.898C19.8114 20.6206 20.6201 19.8119 20.8975 18.7767C20.9997 18.3952 20.9997 17.9302 20.9997 17.0002" />
        <path d="M16.4998 11.5002C16.4998 11.5002 13.1856 16.0002 11.9997 16.0002C10.8139 16.0002 7.49976 11.5002 7.49976 11.5002M11.9997 15.0002V3.00016" />
    </svg>
);

const DownloadQuickOption: React.FC<DownloadQuickOptionProps> = ({
    collectionSummary: { type },
    disabled,
    onClick,
}) => (
    <Tooltip
        title={
            type == "userFavorites"
                ? t("download_favorites")
                : type == "uncategorized"
                  ? t("download_uncategorized")
                  : type == "hiddenItems"
                    ? t("download_hidden_items")
                    : t("download_album")
        }
    >
        <span>
            <IconButton disabled={disabled} onClick={onClick}>
                <Box
                    sx={{
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <DownloadIcon />
                </Box>
            </IconButton>
        </span>
    </Tooltip>
);

interface CollectionSortOrderMenuProps {
    open: boolean;
    onClose: () => void;
    overflowMenuIconRef: React.RefObject<SVGSVGElement | null>;
    sortAsc: boolean;
    sortBy: CollectionSortBy;
    onSort: (sortBy: CollectionSortBy, asc: boolean) => void;
}

function CollectionSortOrderMenu({
    open,
    onClose,
    overflowMenuIconRef,
    sortAsc,
    sortBy,
    onSort,
}: CollectionSortOrderMenuProps) {
    const options: { by: CollectionSortBy; asc: boolean; label: string }[] = [
        { by: "date", asc: false, label: t("newest_first") },
        { by: "date", asc: true, label: t("oldest_first") },
        { by: "fileName", asc: true, label: t("album_sort_name_asc") },
        { by: "fileName", asc: false, label: t("album_sort_name_desc") },
    ];
    return (
        <Menu
            id="collection-files-sort"
            anchorEl={overflowMenuIconRef.current}
            open={open}
            onClose={onClose}
            slotProps={{
                list: { disablePadding: true, "aria-label": t("sort_by") },
            }}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
            {options.map(({ by, asc, label }) => (
                <OverflowMenuOption
                    key={`${by}-${asc}`}
                    onClick={() => {
                        onSort(by, asc);
                        onClose();
                    }}
                    endIcon={
                        sortBy === by && sortAsc === asc ? (
                            <CheckIcon />
                        ) : undefined
                    }
                >
                    {label}
                </OverflowMenuOption>
            ))}
        </Menu>
    );
}
