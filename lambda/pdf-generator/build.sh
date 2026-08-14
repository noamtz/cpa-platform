#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build.sh — Deterministic Lambda deployment package builder
#
# Creates deployment.zip containing:
#   - index.mjs (handler)
#   - package.json + package-lock.json
#   - node_modules/ (production only)
#   - fonts/Heebo-Regular.ttf
#
# Usage:
#   ./lambda/pdf-generator/build.sh          # from repo root
#   cd lambda/pdf-generator && ./build.sh    # from lambda dir
#
# Works in: Linux, macOS, Git Bash (Windows), GitHub Actions
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve script directory (works even when called from repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DIST_DIR="$SCRIPT_DIR/dist"
ZIP_FILE="$SCRIPT_DIR/deployment.zip"

echo "📦 Building Lambda deployment package..."
echo "   Directory: $SCRIPT_DIR"

# 1. Clean previous build
rm -rf "$DIST_DIR" "$ZIP_FILE"
mkdir -p "$DIST_DIR"

# 2. Copy source files
cp index.mjs "$DIST_DIR/"
cp package.json "$DIST_DIR/"
[ -f package-lock.json ] && cp package-lock.json "$DIST_DIR/"

# 3. Copy font
mkdir -p "$DIST_DIR/fonts"
cp fonts/Heebo-Regular.ttf "$DIST_DIR/fonts/"

# 4. Install production dependencies (clean, no dev deps)
echo "📥 Installing production dependencies..."
cd "$DIST_DIR"
npm install --omit=dev --ignore-scripts 2>&1 | tail -3

# 5. Install platform-specific @napi-rs/canvas binary for Lambda (linux-arm64)
#    --force bypasses the platform check (WSL is x64, Lambda is arm64)
#    Then remove any host-platform binary that was pulled in step 4
echo "📥 Installing @napi-rs/canvas for linux-arm64..."
npm install @napi-rs/canvas-linux-arm64-gnu --force --omit=dev 2>&1 | tail -5

# Remove non-arm64 platform binaries to reduce zip size
echo "🧹 Cleaning non-arm64 platform binaries..."
rm -rf node_modules/@napi-rs/canvas-win32-* \
       node_modules/@napi-rs/canvas-darwin-* \
       node_modules/@napi-rs/canvas-linux-x64-* \
       node_modules/@napi-rs/canvas-linux-arm64-musl

# 6. Create zip (exclude unnecessary files to minimize size)
echo "🗜️  Creating deployment.zip..."
cd "$DIST_DIR"
zip -r -q "$ZIP_FILE" . \
  -x "*.md" \
  -x "*.ts" \
  -x "*.map" \
  -x "*/.github/*" \
  -x "*/test/*" \
  -x "*/tests/*" \
  -x "*/__tests__/*" \
  -x "*/docs/*" \
  -x "*/.eslintrc*" \
  -x "*/tsconfig*" \
  -x "*LICENSE*"

# 7. Clean up dist
cd "$SCRIPT_DIR"
rm -rf "$DIST_DIR"

# 8. Report
ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo ""
echo "✅ deployment.zip created: $ZIP_SIZE"
echo "   Location: $ZIP_FILE"
echo ""
echo "   Next: cd infra/test && terraform apply"
