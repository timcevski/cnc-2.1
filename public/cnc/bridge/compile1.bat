@echo off
title Mach3 Bridge Compiler
echo ===================================================
echo     Kompajliranje na Mach3Bridge za x86 (32-bit)
echo ===================================================
echo.

C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /platform:x86 /r:Microsoft.CSharp.dll /out:Mach3Bridge.exe bridge.cs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================
    echo   USPESHNO! Kreiran e Mach3Bridge.exe
    echo ===================================================
) else (
    echo.
    echo [GRESHKA] Kompajliranjeto ne uspea.
)
pause