$ErrorActionPreference = "Stop"
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw "Claude Code CLI not found" }
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
claude --permission-mode plan
