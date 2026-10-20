import { ImageAdd02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import FileDownloadIcon from "@mui/icons-material/FileDownloadOutlined";
import { Paper, Stack, styled, Typography } from "@mui/material";
import { PhotosWordmark } from "ente-base/components/PhotosWordmark";
import { LoadingButton } from "ente-base/components/mui/LoadingButton";
import { t } from "i18next";
import React from "react";
import { Trans } from "react-i18next";
import type { UploadTypeSelectorIntent } from "ente-gallery/components/Upload";

interface GalleryEmptyStateProps {
    isUploadInProgress: boolean;
    onUpload: (intent: UploadTypeSelectorIntent) => void;
}

const galleryEmptyStateShelfTiles = Array.from({ length: 20 }, (_, i) => i);
const galleryEmptyStateGridTiles = Array.from({ length: 56 }, (_, i) => i);

export function GalleryEmptyState({
    isUploadInProgress,
    onUpload,
}: GalleryEmptyStateProps): React.JSX.Element {
    const handleImport = () => onUpload("import");
    const handleUpload = () => onUpload("upload");

    return (
        <Stack
            sx={{
                flex: 1,
                position: "relative",
                width: "100%",
                height: "100%",
                minHeight: 0,
                maxHeight: "100%",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxSizing: "border-box",
                px: { xs: 2, md: 3 },
                bgcolor: "background.default",
            }}
        >
            <GalleryEmptyStateSkeleton />
            <GalleryEmptyStateSkeletonOverlay />
            <Paper
                elevation={0}
                sx={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "min(600px, 100%)",
                    height: { xs: 478, sm: 538 },
                    flexShrink: 0,
                    mt: { xs: "72px", sm: "88px" },
                    transform: "translateY(-28px)",
                    px: { xs: 2.5, sm: 4 },
                    pt: { xs: "180px", sm: "232px" },
                    pb: "20px",
                    borderRadius: { xs: "30px", sm: "42px" },
                    bgcolor: "background.paper",
                    boxShadow: "0 12px 24px -18px rgba(0 0 0 / 0.08)",
                    zIndex: 2,
                }}
            >
                <NonDraggableImage
                    alt=""
                    src="/images/empty-state/gallery-empty-state.svg"
                />

                <Stack
                    sx={{
                        alignItems: "center",
                        gap: "28px",
                        mt: { xs: "6px", sm: "8px" },
                        textAlign: "center",
                        userSelect: "none",
                    }}
                >
                    <Typography
                        variant="h3"
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: { xs: "6px", sm: "8px" },
                            color: "text.base",
                            fontFamily: "'Outfit Variable', sans-serif",
                            fontSize: { xs: "28px", sm: "36px" },
                            lineHeight: { xs: "22px", sm: "28px" },
                            fontWeight: 700,
                            svg: {
                                color: "text.base",
                                height: { xs: 19, sm: 24 },
                                width: { xs: 64, sm: 80 },
                                flexShrink: 0,
                                transform: {
                                    xs: "translateY(1px)",
                                    sm: "translateY(2px)",
                                },
                            },
                        }}
                    >
                        <Trans
                            i18nKey="welcome_title"
                            components={{ a: <PhotosWordmark /> }}
                        />
                    </Typography>
                    <Typography
                        variant="h6"
                        sx={{
                            color: "text.base",
                            fontFamily: "'Inter Variable', 'Inter', sans-serif",
                            fontSize: { xs: "16px", sm: "20px" },
                            lineHeight: { xs: "18px", sm: "20px" },
                            fontWeight: 600,
                        }}
                    >
                        {t("gallery_empty_state_subtitle")}
                    </Typography>
                </Stack>

                <Stack sx={{ mt: "40px", width: 334, maxWidth: "100%", gap: 1 }}>
                    <GalleryEmptyStateButton
                        color="accent"
                        onClick={handleImport}
                        disabled={isUploadInProgress}
                        startIcon={<FileDownloadIcon />}
                    >
                        {t("upload_existing_library")}
                    </GalleryEmptyStateButton>
                    <GalleryEmptyStateButton
                        color="secondary"
                        onClick={handleUpload}
                        disabled={isUploadInProgress}
                        startIcon={
                            <HugeiconsIcon
                                icon={ImageAdd02Icon}
                                size={20}
                                strokeWidth={2}
                            />
                        }
                    >
                        {t("upload_first_photo")}
                    </GalleryEmptyStateButton>
                </Stack>
            </Paper>
        </Stack>
    );
}

function GalleryEmptyStateSkeleton(): React.JSX.Element {
    return (
        <GalleryEmptyStateSkeletonRoot aria-hidden>
            <div className="skeleton-albums">
                <span className="skeleton-label skeleton-label-wide" />
                <div className="skeleton-shelf">
                    {galleryEmptyStateShelfTiles.map((tile) => (
                        <span key={tile} />
                    ))}
                </div>
            </div>
            <div className="skeleton-gallery">
                <div className="skeleton-title-group">
                    <span className="skeleton-label skeleton-label-short" />
                    <span className="skeleton-label skeleton-label-wide" />
                </div>
                <span className="skeleton-label skeleton-label-short" />
                <div className="skeleton-grid">
                    {galleryEmptyStateGridTiles.map((tile) => (
                        <span key={tile} />
                    ))}
                </div>
            </div>
        </GalleryEmptyStateSkeletonRoot>
    );
}

const GalleryEmptyStateSkeletonRoot = styled("div")(({ theme }) => {
    const fill = theme.vars.palette.fill.faintHover;

    return {
        position: "absolute",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
        padding: "24px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        maskImage:
            "linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.1) 100%)",
        WebkitMaskImage:
            "linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.1) 100%)",
        ".skeleton-albums": { marginTop: 0 },
        ".skeleton-gallery": {
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minHeight: 0,
            marginTop: 28,
        },
        ".skeleton-title-group": {
            display: "flex",
            flexDirection: "column",
            gap: 9,
            marginBottom: 28,
            width: 102,
        },
        ".skeleton-label": {
            display: "block",
            height: 18,
            borderRadius: 2,
            background: fill,
        },
        ".skeleton-label-short": { width: 53 },
        ".skeleton-label-wide": { width: 89 },
        ".skeleton-shelf": {
            display: "grid",
            gridTemplateColumns: "repeat(20, minmax(98px, 1fr))",
            gap: 4,
            marginTop: 8,
            width: "100%",
        },
        ".skeleton-shelf > span": {
            height: 71,
            borderRadius: 2,
            background: fill,
        },
        ".skeleton-grid": {
            display: "grid",
            flex: 1,
            gridTemplateColumns: "repeat(auto-fill, minmax(198px, 1fr))",
            gridAutoRows: "minmax(160px, 1fr))",
            gap: 4,
            marginTop: 11,
            minHeight: 0,
            width: "100%",
        },
        ".skeleton-grid > span": { borderRadius: 4, background: fill },
        [theme.breakpoints.down("md")]: {
            ".skeleton-grid": {
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            },
        },
        [theme.breakpoints.down("sm")]: {
            padding: "20px 16px",
            ".skeleton-shelf": {
                gridTemplateColumns: "repeat(20, minmax(84px, 1fr))",
            },
            ".skeleton-grid": {
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gridAutoRows: "minmax(110px, 1fr)",
            },
        },
    };
});

const GalleryEmptyStateSkeletonOverlay = styled("div")(({ theme }) => ({
    position: "absolute",
    inset: 0,
    zIndex: 1,
    pointerEvents: "none",
    opacity: 0.6,
    background: theme.vars.palette.background.default,
}));

const GalleryEmptyStateButton = styled(LoadingButton)(({ theme }) => ({
    height: 48,
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 500,
    boxShadow: "none",
    "&:hover": { boxShadow: "none" },
    "&.Mui-disabled": { bgcolor: theme.vars.palette.fill.faint },
}));

// Draggable images trigger the upload overlay.
const NonDraggableImage = styled("img")(({ theme }) => ({
    position: "absolute",
    top: -96,
    width: 300,
    maxWidth: "calc(100% - 48px)",
    aspectRatio: "351 / 305.183",
    height: "auto",
    pointerEvents: "none",
    userSelect: "none",
    [theme.breakpoints.down("sm")]: { top: -80, width: 256 },
}));
