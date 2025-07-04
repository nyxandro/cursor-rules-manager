#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = package.version.split('.').map(Number);

// Увеличиваем patch версию
const newVersion = `${major}.${minor}.${patch + 1}`;

package.version = newVersion;

fs.writeFileSync(packagePath, JSON.stringify(package, null, 2) + '\n');

console.log(`Version updated to ${newVersion}`);

// Обновляем README если нужно
const readmePath = path.join(__dirname, '..', 'README.md');
if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    readme = readme.replace(/version: \d+\.\d+\.\d+/, `version: ${newVersion}`);
    fs.writeFileSync(readmePath, readme);
    console.log('README updated');
} 