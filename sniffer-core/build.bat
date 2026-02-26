cd sniffer-core
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Releasecd sniffer-core
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   ABYSS SNIFFER - Windows Build Script
echo  ============================================
echo.

:: ─── Find VS Build Tools ───
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
    echo [ERROR] Visual Studio / Build Tools not found.
    echo Install Visual Studio Build Tools 2022 from:
    echo   https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
    exit /b 1
)

:: Get the latest VS installation path
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -property installationPath`) do (
    set "VS_DIR=%%i"
)
echo [OK] Found Visual Studio at: %VS_DIR%

:: ─── Find CMake ───
set "CMAKE=%VS_DIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
if not exist "%CMAKE%" (
    echo [ERROR] CMake not found in VS installation.
    echo Install "C++ CMake tools for Windows" workload in VS Installer.
    exit /b 1
)
echo [OK] Found CMake: %CMAKE%

:: ─── Set up MSVC environment ───
set "VCVARSALL=%VS_DIR%\VC\Auxiliary\Build\vcvarsall.bat"
if not exist "%VCVARSALL%" (
    echo [ERROR] MSVC compiler not found.
    echo Install "Desktop development with C++" workload in VS Installer.
    exit /b 1
)

echo [OK] Setting up MSVC x64 environment...
call "%VCVARSALL%" x64 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to set up MSVC environment.
    exit /b 1
)

:: ─── Find Npcap SDK ───
set "NPCAP_SDK_DIR="

:: Check common locations
if exist "C:\npcap-sdk\Include" (
    set "NPCAP_SDK_DIR=C:\npcap-sdk"
)
if exist "%~dp0npcap-sdk\Include" (
    set "NPCAP_SDK_DIR=%~dp0npcap-sdk"
)
if exist "%~dp0..\npcap-sdk\Include" (
    set "NPCAP_SDK_DIR=%~dp0..\npcap-sdk"
)
if exist "%USERPROFILE%\npcap-sdk\Include" (
    set "NPCAP_SDK_DIR=%USERPROFILE%\npcap-sdk"
)

if "%NPCAP_SDK_DIR%"=="" (
    echo.
    echo [ERROR] Npcap SDK not found!
    echo.
    echo Download the Npcap SDK from: https://npcap.com/#download
    echo   1. Download "Npcap SDK" ^(zip file^)
    echo   2. Extract it to one of these locations:
    echo      - C:\npcap-sdk
    echo      - %~dp0npcap-sdk
    echo      - %~dp0..\npcap-sdk
    echo   3. Run this script again
    echo.
    echo Also ensure Npcap driver is installed: https://npcap.com/#download
    exit /b 1
)
echo [OK] Found Npcap SDK at: %NPCAP_SDK_DIR%

:: ─── Build ───
set "BUILD_DIR=%~dp0build"
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

echo.
echo [BUILD] Configuring with CMake...
"%CMAKE%" -S "%~dp0" -B "%BUILD_DIR%" -G "Ninja" -DCMAKE_BUILD_TYPE=Release -DNPCAP_SDK_DIR="%NPCAP_SDK_DIR%" 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Ninja not found, falling back to NMake...
    "%CMAKE%" -S "%~dp0" -B "%BUILD_DIR%" -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release -DNPCAP_SDK_DIR="%NPCAP_SDK_DIR%" 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] CMake configuration failed.
        exit /b 1
    )
)

echo.
echo [BUILD] Compiling...
"%CMAKE%" --build "%BUILD_DIR%" --config Release 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    exit /b 1
)

echo.
echo  ============================================
echo   BUILD SUCCESSFUL!
echo  ============================================
echo.
echo   Binary: %BUILD_DIR%\abyss-sniffer.exe
echo.
echo   Usage (run as Administrator):
echo     %BUILD_DIR%\abyss-sniffer.exe
echo     %BUILD_DIR%\abyss-sniffer.exe -l          (list interfaces)
echo     %BUILD_DIR%\abyss-sniffer.exe -i "Wi-Fi"  (specific interface)
echo.

endlocal
