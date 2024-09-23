#!/usr/bin/env sh

set -e

# Prints a heading in bold
print_stage_heading () {
    printf '\n\033[1m%s\033[0m\n\n' "$1"
}


# Run from the project root

current_directory=$(pwd)

if [ "$(basename "$current_directory")" == "scripts" ]; then
    cd ..
    echo "Changed to the parent directory."
fi

if [ ! "$(command -v concurrently)" ]; then
    npm install -g "concurrently"
fi

concurrently --kill-others \
    "rm -rf ./package-lock.json " \
    --names  "Remove-package_lock" \
    --prefix-colors "#ffac00"

concurrently --kill-others \
    "rm -rf ./node_modules" \
    --names  "Remove-node_modules" \
    --prefix-colors "#848377"

concurrently --kill-others \
    "rm -rf ./local-pack/*" \
    --names "Clean-local_pack" \
    --prefix-colors "#50F862"

concurrently --kill-others \
    "rm -rf ./dist" \
    --names "Remove-dist" \
    --prefix-colors "#81688d"

concurrently --kill-others \
    "echo Installing NPM dependencies && npm i" \
    --names "Install-dependencies" \
    --prefix-colors "#CC0099"

mkdir -p ./local-pack