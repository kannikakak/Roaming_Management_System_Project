@echo off
setlocal
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" scripts\folder-sync-agent.js >> ".sync-agent.log" 2>> ".sync-agent.err.log"
