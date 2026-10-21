@echo off
REM ============================================================================
REM download-models.cmd - fetch all ML model assets for Photos
REM
REM Source: the public models.ente.com CDN, which the app also uses as its
REM default at runtime. Fresh installs download the ML models on first use
REM from there; this script only exists if you want a local copy.
REM
REM Sizes and SHA-256 checksums are pinned to match the app's catalog:
REM   rust/crates/ml/src/assets.rs      (face + CLIP + pets)
REM   rust/crates/ml/src/ocr/assets.rs  (PaddleOCR PP-OCRv5)
REM   rust/crates/ml/src/scan/mod.rs    (document segmentation)
REM
REM RE-HOSTING: to serve the models from your own bucket instead, upload
REM everything under .\models\ keeping the same relative paths, then change
REM BASE below AND the app-side URLs in the rust files listed above to the
REM same bucket, and rebuild. Until then, leave everything pointing at
REM models.ente.com.
REM
REM Requires: curl + PowerShell (both ship with Windows 10+).
REM ============================================================================

setlocal enabledelayedexpansion

REM Default: the public ente models CDN (same host the app itself uses).
REM To self-host: replace with your own bucket URL after uploading .\models\.
set "BASE=https://models.ente.com"
set "OUT=%~dp0models"

echo Base URL : %BASE%
echo Output   : %OUT%
echo.

mkdir "%OUT%" 2>nul
mkdir "%OUT%\PP-OCRv5" 2>nul

REM ---------------------------------------------------------------- faces ----
call :get yolov5s_face_640_640_static_b1.onnx e047647409403d52696035ecd445792173e50d7fbdcccac97b958a585db9aa3d 32355091
if errorlevel 1 goto :fail

call :get mobilefacenet_portable_static_b1.onnx 0763fc33f54e138476194da95987e133b3e976075a6b1d3e1b2caedb251b1a36 5278803
if errorlevel 1 goto :fail

REM ------------------------------------------------------- semantic search ----
call :get mobileclip_s2_image_gelu_opset20.onnx 205a430af825e501c5138e5bb9abea942482a7a4fd4a680e98e47cf0830dce7e 143057352
if errorlevel 1 goto :fail

call :get mobileclip_s2_text_opset18_quant.onnx d92f33dfcff83077fc2e0d3414250710efbb51795dfd89767bdbefb5fdc47322 67144712
if errorlevel 1 goto :fail

call :get bpe_simple_vocab_16e6.txt 67603cfda2e032ad77b5f8808af37789d590db664b26df8705d2bf8b3c553fc8 3194984
if errorlevel 1 goto :fail

REM ------------------------------------------------------------------ OCR ----
call :get det_fixed_v1.onnx f655f119225b579fa8c3cbf64f6bb7cf56a26c9dc211706a25234d70a543ec8c 5548458
if errorlevel 1 goto :fail

call :get cls_fixed_v1.onnx 378d52a73263828d08d4dda37f1d0aac2e36cbd486fdc6351bf309d515610654 590475
if errorlevel 1 goto :fail

call :get rec_fixed_v1.onnx 6dda4c0891af5a70c5b0f618b62588df7f3140616d1c560be5ec6496747b54fd 17031601
if errorlevel 1 goto :fail

call :get PP-OCRv5\ppocrv5_dict.txt d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b 74012
if errorlevel 1 goto :fail

REM -------------------------------------------------- document scanning ----
REM sha256/size match rust/crates/ml/src/scan/mod.rs (SEGMENTATION_MODEL_SHA256).
call :get document_segmentation_opt.onnx 5ddcb87c70cb7674189e6fc148e84a490ca65b282276534210255a777d48a808 5085426
if errorlevel 1 goto :fail

REM --------------------------------------------------------------- pets ------
REM Pet indexing is currently disabled in the app (petsIndexingEnabled=false)
REM but the models are in the catalog. Download them if you plan to enable it.
call :get yolov5s_pet_face_fp16_V2.onnx 7876d97992eeb5f3a9f3b35eff5e0e133012928172a8b005093108d8c3ad2d1c 14758020
if errorlevel 1 goto :fail
call :get dog_face_embedding128.onnx fb04d781eb1f7adf6ce3432dc0c5873f16cc051b5c98c14c754afb39e2b92462 4141071
if errorlevel 1 goto :fail
call :get cat_face_embedding128.onnx 32b10694a27f6404d2beaddbd64f07ad555f72dccb12ee60a7afe5dcf6aad6cd 4141071
if errorlevel 1 goto :fail
call :get yolov5s_object_fp16.onnx 113f0c18632eb2c4f6deebcd40eb01c676492e9b43923c2d336e1b4012fce9ef 14987107
if errorlevel 1 goto :fail
call :get dog_body_embedding192.onnx 1d85aa20358137e30f11c2d0baa9a2248b9997928d501fe15365d1fc57522770 4569361
if errorlevel 1 goto :fail
call :get cat_body_embedding192.onnx 62fb5891e61be69a96510d8ec56e7525a9541b0283e54574d27c86c9b4a26ddf 4569361
if errorlevel 1 goto :fail

echo.
echo All models downloaded and verified into %OUT%
echo The app fetches these automatically on first use; this copy is only
echo needed if you plan to self-host. To self-host, upload this folder to
echo your bucket keeping the same relative paths, then flip the base URL:
echo   - this script: BASE=...
echo   - app (rust, read-only catalog): rust/crates/ml/src/assets.rs,
echo     rust/crates/ml/src/ocr/assets.rs, rust/crates/ml/src/scan/mod.rs
echo   - then rebuild the app (the URLs are compiled into the native addon)
echo.
exit /b 0

:get
set "FILE=%~1"
set "SHA=%~2"
set "SIZE=%~3"
REM URLs need forward slashes even though local paths use backslashes.
set "FILEURL=%FILE:\=/%"
echo [%FILE%]
curl -fL --retry 3 -o "%OUT%\%FILE%" "%BASE%/%FILEURL%"
if errorlevel 1 (
    echo   FAILED to download %FILE%
    exit /b 1
)
if "%SHA%"=="" (
    echo   downloaded ^(no checksum pinned for this asset^)
    exit /b 0
)
powershell -NoProfile -Command "$h=(Get-FileHash -Algorithm SHA256 '%OUT%\%FILE%').Hash.ToLower(); if ($h -ne '%SHA%') { Write-Host '  CHECKSUM MISMATCH: '+$h; exit 1 } else { Write-Host '  sha256 OK' }"
if errorlevel 1 exit /b 1
exit /b 0

:fail
echo.
echo DOWNLOAD FAILED - see messages above.
exit /b 1
