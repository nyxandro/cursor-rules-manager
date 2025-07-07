#!/bin/bash

# Скрипт для создания пакета расширения Cursor Rules Manager
# Создает .vsix файл из скомпилированных файлов

# Добавляем локальный node_modules/.bin в PATH для поддержки локального node
export PATH="./node_modules/.bin:$PATH"

VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="cursor-rules-manager-${VERSION}.vsix"
TEMP_DIR="temp-package"

echo "Создание пакета расширения версии ${VERSION}..."

# Создаем временную директорию
mkdir -p "${TEMP_DIR}"

# Копируем необходимые файлы
cp package.json "${TEMP_DIR}/"
cp -r out "${TEMP_DIR}/"
cp -r resources "${TEMP_DIR}/"

# Создаем .vsix файл (это просто zip с расширением .vsix)
cd "${TEMP_DIR}"
zip -r "../releases/${PACKAGE_NAME}" . -x "*.map"
cd ..

# Очищаем временную директорию
rm -rf "${TEMP_DIR}"

echo "Пакет создан: releases/${PACKAGE_NAME}" 