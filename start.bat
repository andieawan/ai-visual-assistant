@echo off
title AI Visual Assistant
cd /d "%~dp0"

if not exist node_modules (
  echo [1/2] Memasang dependensi, tunggu sebentar...
  call npm install
  if errorlevel 1 (
    echo Gagal menjalankan npm install. Periksa koneksi internet.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy .env.example .env >nul
  echo File .env dibuat dari .env.example
)

echo [2/2] Menjalankan server...
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:3000"
node src/server.js
pause
