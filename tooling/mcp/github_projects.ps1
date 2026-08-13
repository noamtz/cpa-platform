$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub MCP requires the GitHub CLI (gh). Install it and run 'gh auth login'."
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub MCP requires Docker Desktop for the pinned official server image."
    exit 1
}

$githubToken = & gh auth token --hostname github.com --user noamtz 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($githubToken)) {
    Write-Error "GitHub CLI is not authenticated as noamtz. Authenticate that account and grant it Projects access."
    exit 1
}

try {
    $env:GITHUB_PERSONAL_ACCESS_TOKEN = $githubToken.Trim()
    $env:GITHUB_TOOLSETS = "projects,issues,repos,pull_requests"

    & docker run --interactive --rm `
        --env GITHUB_PERSONAL_ACCESS_TOKEN `
        --env GITHUB_TOOLSETS `
        ghcr.io/github/github-mcp-server:v1.9.0
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:GITHUB_PERSONAL_ACCESS_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:GITHUB_TOOLSETS -ErrorAction SilentlyContinue
    $githubToken = $null
}
