@echo off
title Jarvis - Login Google Cloud
echo ============================================
echo  Login a Google Cloud para Jarvis
echo ============================================
echo.
echo Se va a abrir tu navegador para iniciar sesion
echo con tu cuenta de Google (la de Gmail alcanza).
echo.
call "%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" auth login
echo.
echo ============================================
echo  Si arriba dice "You are now logged in as",
echo  LISTO, podes cerrar esta ventana y avisarle
echo  al asistente que terminaste el paso 1.
echo ============================================
echo.
pause
