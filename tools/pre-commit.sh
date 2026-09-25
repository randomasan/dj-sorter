#!/bin/sh
# Пишет docs/version.js перед каждым коммитом: номер = число коммитов + 1, дата.
n=$(( $(git rev-list --count HEAD 2>/dev/null || echo 0) + 1 ))
d=$(date -u +%Y-%m-%d); dd=$(date -u +%d.%m.%Y)
printf "// генерируется git pre-commit хуком — не править руками\nwindow.APP_VERSION = { n: %s, date: '%s', label: 'v0.%s · %s' };\n" "$n" "$d" "$n" "$dd" > docs/version.js
git add docs/version.js
