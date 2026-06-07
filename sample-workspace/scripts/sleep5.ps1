# Runs for ~5 seconds — use it to watch the elapsed timer in Workspace Scripts.
Write-Host "Sleeping for 5 seconds..."
for ($i = 5; $i -ge 1; $i--) {
    Write-Host "$i..."
    Start-Sleep -Seconds 1
}
Write-Host "Done."
