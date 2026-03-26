Dim shell
Dim fso
Dim scriptDir
Dim backendDir
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = fso.GetParentFolderName(scriptDir)

command = "cmd.exe /d /c cd /d """ & backendDir & """ && ""C:\Program Files\nodejs\node.exe"" scripts\folder-sync-agent.js >> "".sync-agent.log"" 2>> "".sync-agent.err.log"""

shell.Run command, 0, False
