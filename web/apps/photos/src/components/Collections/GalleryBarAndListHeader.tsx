// TODO: Audit this file
import type { FileListHeaderOrFooter } from "@/components/FileList";
import {
    GalleryBarImpl,
    type GalleryBarImplProps,
} from "@/components/gallery/BarImpl";
import { PeopleHeader } from "@/components/gallery/PeopleHeader";
import {
    filterAlbumSummaries,
    visibleAlbumFilters as getVisibleAlbumFilters,
} from "@/utils/album-filters";
import { sortPeople } from "@/utils/people-sort";
import { useModalVisibility } from "ente-base/components/utils/modal";
import {
    isSaveCancelled,
    isSaveComplete,
    type SaveGroup,
} from "ente-gallery/components/utils/save-groups";
import type { Collection } from "ente-media/collection";
import {
    GalleryItemsHeaderAdapter,
    GalleryItemsSummary,
} from "ente-new/photos/components/gallery/ListHeader";
import {
    collectionsSortBy,
    PseudoCollectionID,
    sortCollectionSummaries,
    type CollectionsSortBy,
    type CollectionSummaries,
    type CollectionSummary,
} from "ente-new/photos/services/collection-summary";
import { includes } from "ente-utils/type-guards";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    CollectionHeader,
    type CollectionHeaderProps,
} from "./CollectionHeader";
import { CreateAlbumDialog } from "./CreateAlbumDialog";

export type GalleryBarAndListHeaderProps = Omit<
    GalleryBarImplProps,
    | "collectionSummaries"
    | "visibleAlbumFilters"
    | "onSelectCollectionID"
    | "collectionsSortBy"
    | "onChangeCollectionsSortBy"
    | "onCreateAlbum"
> & {
    onAlbumSummariesChange: (
        albums: CollectionSummary[],
        sortBy: CollectionsSortBy,
    ) => void;
    shouldHide: boolean;
    barCollectionSummaries: CollectionSummaries;
    activeCollection: Collection | undefined;
    setActiveCollectionID: (collectionID: number) => void;
    setFileListHeader: (header: FileListHeaderOrFooter) => void;
    hasActiveFileSelection: boolean;
    saveGroups: SaveGroup[];
} & Pick<
        CollectionHeaderProps,
        | "onRemotePull"
        | "onAddSaveGroup"
        | "onEditAlbumDetails"
        | "onShowMap"
        | "onCollectionSlideshow"
    >;

// TODO: Move this back into the gallery once its responsibilities are split.
export const GalleryBarAndListHeader: React.FC<
    GalleryBarAndListHeaderProps
> = ({
    shouldHide,
    mode,
    barCollectionSummaries: toShowCollectionSummaries,
    normalCollectionSummaries,
    uncategorizedCollectionSummaryID,
    onShowCollectionSummary,
    activeCollection,
    activeCollectionID,
    setActiveCollectionID,
    people,
    peopleSortBy,
    onChangePeopleSortBy,
    onAlbumSummariesChange,
    albumFilter,
    albumSearchQuery,
    onAlbumSearchQueryChange,
    onShowAlbumOverview,
    onShowPeopleOverview,
    onSelectPerson,
    saveGroups,
    hasActiveFileSelection,
    activePerson,
    onRemotePull,
    onEditAlbumDetails,
    onAddSaveGroup,
    onShowMap,
    onCollectionSlideshow,
    setFileListHeader,
    collapsed,
    mobileDrawerProps,
}) => {
    const { show: showAlbumNameInput, props: albumNameInputVisibilityProps } =
        useModalVisibility();
    const [createInHiddenSection, setCreateInHiddenSection] = useState(false);
    const openAlbumCreation = () => {
        setCreateInHiddenSection(mode == "hidden-albums");
        showAlbumNameInput();
    };

    const [collectionsSortBy, setCollectionsSortBy] =
        useCollectionsSortByLocalState("updation-time-desc");

    const sortedCollectionSummaries = useMemo(
        () =>
            sortCollectionSummaries(
                [...toShowCollectionSummaries.values()],
                collectionsSortBy,
            ).sort((a, b) => b.sortPriority - a.sortPriority),
        [collectionsSortBy, toShowCollectionSummaries],
    );
    const eligibleCollectionSummaries = useMemo(
        () =>
            sortedCollectionSummaries.filter(
                (cs) =>
                    cs.id !== uncategorizedCollectionSummaryID &&
                    cs.id !== PseudoCollectionID.hiddenItems &&
                    cs.id !== PseudoCollectionID.archiveItems &&
                    cs.id !== PseudoCollectionID.trash &&
                    (mode == "albums"
                        ? !cs.attributes.has("system") ||
                          (cs.id > 0 && cs.type == "uncategorized")
                        : !cs.attributes.has("hideFromCollectionBar")),
            ),
        [sortedCollectionSummaries, uncategorizedCollectionSummaryID, mode],
    );
    const visibleAlbumFilters = useMemo(
        () =>
            getVisibleAlbumFilters(
                eligibleCollectionSummaries,
                albumSearchQuery,
            ),
        [eligibleCollectionSummaries, albumSearchQuery],
    );
    // Sidebar searches span groups; the overview still follows its selected group.
    const sidebarCollectionSummaries = useMemo(
        () =>
            eligibleCollectionSummaries.filter((album) =>
                album.name
                    .toLowerCase()
                    .includes(albumSearchQuery.trim().toLowerCase()),
            ),
        [eligibleCollectionSummaries, albumSearchQuery],
    );
    const visibleCollectionSummaries = useMemo(
        () =>
            mode == "albums"
                ? filterAlbumSummaries(
                      eligibleCollectionSummaries,
                      albumFilter,
                      albumSearchQuery,
                  )
                : eligibleCollectionSummaries.filter((album) =>
                      album.name
                          .toLowerCase()
                          .includes(albumSearchQuery.trim().toLowerCase()),
                  ),
        [eligibleCollectionSummaries, mode, albumFilter, albumSearchQuery],
    );

    useEffect(() => {
        if (mode == "albums")
            onAlbumSummariesChange(
                visibleCollectionSummaries,
                collectionsSortBy,
            );
    }, [
        mode,
        visibleCollectionSummaries,
        collectionsSortBy,
        onAlbumSummariesChange,
    ]);

    const sortedPeople = useMemo(
        () => sortPeople(people, peopleSortBy),
        [people, peopleSortBy],
    );

    const isActiveCollectionDownloadInProgress = useCallback(() => {
        const group = saveGroups.find(
            (g) => g.collectionSummaryID === activeCollectionID,
        );
        return !!group && !isSaveComplete(group) && !isSaveCancelled(group);
    }, [saveGroups, activeCollectionID]);

    const albumDescription =
        activeCollection?.pubMagicMetadata?.data.caption?.trim();
    const [descriptionHeight, setDescriptionHeight] = useState(0);

    const { onClose: closeMobileDrawer } = mobileDrawerProps;
    const selectCollection = useCallback(
        (id: number) => {
            setActiveCollectionID(id);
            closeMobileDrawer();
        },
        [setActiveCollectionID, closeMobileDrawer],
    );
    const selectPerson = useCallback(
        (id: string) => {
            onSelectPerson(id);
            closeMobileDrawer();
        },
        [onSelectPerson, closeMobileDrawer],
    );

    useEffect(() => {
        if (shouldHide) return;

        const collectionSummary = toShowCollectionSummaries.get(
            activeCollectionID!,
        );
        // Pseudo-collections need header actions despite having no Collection.
        const shouldRenderCollectionHeader =
            mode != "people" &&
            collectionSummary &&
            (activeCollection ||
                collectionSummary.id <= PseudoCollectionID.all);

        setFileListHeader({
            component: shouldRenderCollectionHeader ? (
                <CollectionHeader
                    {...{
                        activeCollection,
                        setActiveCollectionID,
                        isActiveCollectionDownloadInProgress,
                        onRemotePull,
                        onAddSaveGroup,
                        onShowMap,
                        onCollectionSlideshow,
                    }}
                    collectionSummary={collectionSummary}
                    onEditAlbumDetails={onEditAlbumDetails}
                    hasActiveFileSelection={hasActiveFileSelection}
                    onDescriptionHeightChange={setDescriptionHeight}
                />
            ) : mode != "people" && collectionSummary ? (
                <GalleryItemsHeaderAdapter>
                    <GalleryItemsSummary
                        name={collectionSummary.name}
                        fileCount={collectionSummary.fileCount}
                    />
                </GalleryItemsHeaderAdapter>
            ) : activePerson ? (
                <PeopleHeader
                    person={activePerson}
                    {...{ onSelectPerson, people }}
                />
            ) : (
                <></>
            ),
            height: 72 + (albumDescription ? descriptionHeight : 0),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        shouldHide,
        mode,
        toShowCollectionSummaries,
        activeCollection,
        activeCollectionID,
        isActiveCollectionDownloadInProgress,
        activePerson,
        hasActiveFileSelection,
        onRemotePull,
        onAddSaveGroup,
        onShowMap,
        onCollectionSlideshow,
        onEditAlbumDetails,
        albumDescription,
        descriptionHeight,
        // TODO: Cluster
        // This causes a loop since it is an array dep
        // people,
    ]);

    if (shouldHide) {
        return <></>;
    }

    return (
        <>
            <GalleryBarImpl
                {...{
                    mode,
                    albumFilter,
                    albumSearchQuery,
                    onAlbumSearchQueryChange,
                    onShowAlbumOverview,
                    onShowPeopleOverview,
                    activeCollectionID,
                    people: sortedPeople,
                    activePerson,
                    collectionsSortBy,
                    peopleSortBy,
                    collapsed,
                    mobileDrawerProps,
                    normalCollectionSummaries,
                    uncategorizedCollectionSummaryID,
                    onShowCollectionSummary,
                }}
                onSelectCollectionID={selectCollection}
                onSelectPerson={selectPerson}
                onChangeCollectionsSortBy={setCollectionsSortBy}
                onChangePeopleSortBy={onChangePeopleSortBy}
                onCreateAlbum={openAlbumCreation}
                collectionSummaries={
                    mode == "albums"
                        ? sidebarCollectionSummaries
                        : visibleCollectionSummaries
                }
                visibleAlbumFilters={visibleAlbumFilters}
            />

            <CreateAlbumDialog
                {...albumNameInputVisibilityProps}
                isHidden={createInHiddenSection}
                onRemotePull={onRemotePull}
                onSelectCollectionID={selectCollection}
            />
        </>
    );
};

const useCollectionsSortByLocalState = (initialValue: CollectionsSortBy) => {
    const key = "collectionsSortBy";

    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        const value = localStorage.getItem(key);
        if (value && includes(collectionsSortBy, value)) setValue(value);
    }, []);

    const setter = (value: CollectionsSortBy) => {
        localStorage.setItem(key, value);
        setValue(value);
    };

    return [value, setter] as const;
};
