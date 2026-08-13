param(
    [switch]$RestoreNonProjectAccount
)

$ErrorActionPreference = "Stop"

$targetUser = "noamtz"
$status = & gh auth status --hostname github.com --json hosts 2>$null | ConvertFrom-Json
$accounts = $status.hosts.'github.com'
$activeUser = ($accounts | Where-Object { $_.active } | Select-Object -First 1).login

if ($RestoreNonProjectAccount) {
    $restoreUser = ($accounts | Where-Object { $_.login -ne $targetUser } | Select-Object -First 1).login
    if (-not $restoreUser) {
        throw "No non-project GitHub account is available to restore."
    }
    & gh auth switch --hostname github.com --user $restoreUser
    exit $LASTEXITCODE
}

try {
    & gh auth switch --hostname github.com --user $targetUser
    if ($LASTEXITCODE -ne 0) {
        throw "Could not activate GitHub account $targetUser."
    }

    & gh auth refresh --hostname github.com --scopes project --clipboard
    if ($LASTEXITCODE -ne 0) {
        throw "Could not grant GitHub Projects scope to $targetUser."
    }
}
finally {
    if ($activeUser -and $activeUser -ne $targetUser) {
        & gh auth switch --hostname github.com --user $activeUser | Out-Null
    }
}
