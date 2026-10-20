import { styled } from "@mui/material";
import React from "react";

interface PhotosWordmarkProps {
    height?: number;
}

/**
 * "Photos" wordmark, rendered as SVG text so that it inherits the app font
 * (Outfit) and scales cleanly alongside the surrounding text.
 */
export const PhotosWordmark: React.FC<PhotosWordmarkProps> = ({ height }) => (
    <svg
        height={height ?? 18}
        viewBox="0 0 600 160"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Photos"
    >
        <text
            x="300"
            y="117"
            textAnchor="middle"
            fontFamily="'Outfit Variable', 'Outfit', 'Inter Variable', 'Inter', system-ui, sans-serif"
            fontWeight={700}
            fontSize="128"
            letterSpacing="3"
            fill="currentColor"
        >
            Photos
        </text>
    </svg>
);

// Remove the inline SVG's baseline gap.
export const PhotosWordmarkBox = styled("div")`
    line-height: 0;
`;
