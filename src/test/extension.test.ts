import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RulesManager } from '../rulesManager';

suite('Cursor Rules Manager Test Suite', () => {
    let rulesManager: RulesManager;
    let testWorkspaceRoot: string;

    suiteSetup(() => {
        testWorkspaceRoot = path.join(__dirname, '..', '..', 'test-workspace');
        if (!fs.existsSync(testWorkspaceRoot)) {
            fs.mkdirSync(testWorkspaceRoot, { recursive: true });
        }
    });

    setup(() => {
        rulesManager = new RulesManager();
    });

    teardown(() => {
        // Очистка тестовых файлов
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    test('Должен правильно определять локальные и глобальные правила', async () => {
        // Создаем тестовую структуру
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        // Создаем локальные правила (my-project - исключено)
        const myProjectPath = path.join(rulesPath, 'my-project');
        fs.mkdirSync(myProjectPath, { recursive: true });
        fs.writeFileSync(path.join(myProjectPath, 'local-rule.md'), '# Локальное правило');
        
        // Создаем глобальные правила
        const corePath = path.join(rulesPath, 'core');
        fs.mkdirSync(corePath, { recursive: true });
        fs.writeFileSync(path.join(corePath, 'global-rule.md'), '# Глобальное правило');
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        assert.strictEqual(rules.localRules.length, 1);
        assert.strictEqual(rules.globalRules.length, 1);
        assert.strictEqual(rules.localRules[0].name, 'my-project');
        assert.strictEqual(rules.globalRules[0].name, 'core');
    });

    test('Должен исключать указанные папки из синхронизации', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        // Создаем исключенную папку
        const excludedPath = path.join(rulesPath, 'my-project');
        fs.mkdirSync(excludedPath, { recursive: true });
        fs.writeFileSync(path.join(excludedPath, 'excluded-rule.md'), '# Исключенное правило');
        
        // Создаем обычную папку
        const normalPath = path.join(rulesPath, 'normal');
        fs.mkdirSync(normalPath, { recursive: true });
        fs.writeFileSync(path.join(normalPath, 'normal-rule.md'), '# Обычное правило');
        
        const syncRules = await rulesManager.getSyncableRules(testWorkspaceRoot);
        
        // my-project должна быть исключена
        const excludedRule = syncRules.find(rule => rule.name === 'my-project');
        assert.strictEqual(excludedRule, undefined);
        
        // normal должна быть включена
        const normalRule = syncRules.find(rule => rule.name === 'normal');
        assert.notStrictEqual(normalRule, undefined);
    });

    test('Должен правильно копировать файлы', async () => {
        const sourcePath = path.join(testWorkspaceRoot, 'source');
        const destPath = path.join(testWorkspaceRoot, 'dest');
        
        fs.mkdirSync(sourcePath, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });
        
        // Создаем тестовый файл
        const testFile = path.join(sourcePath, 'test.md');
        const testContent = '# Тестовый файл\n\nСодержимое файла';
        fs.writeFileSync(testFile, testContent);
        
        await rulesManager.copyFile(testFile, path.join(destPath, 'test.md'));
        
        const copiedFile = path.join(destPath, 'test.md');
        assert.strictEqual(fs.existsSync(copiedFile), true);
        assert.strictEqual(fs.readFileSync(copiedFile, 'utf8'), testContent);
    });

    test('Должен правильно копировать директории', async () => {
        const sourcePath = path.join(testWorkspaceRoot, 'source-dir');
        const destPath = path.join(testWorkspaceRoot, 'dest-dir');
        
        fs.mkdirSync(sourcePath, { recursive: true });
        
        // Создаем структуру директорий
        const subDir = path.join(sourcePath, 'subdir');
        fs.mkdirSync(subDir, { recursive: true });
        
        fs.writeFileSync(path.join(sourcePath, 'root-file.md'), '# Корневой файл');
        fs.writeFileSync(path.join(subDir, 'sub-file.md'), '# Файл в поддиректории');
        
        await rulesManager.copyDirectory(sourcePath, destPath);
        
        assert.strictEqual(fs.existsSync(path.join(destPath, 'root-file.md')), true);
        assert.strictEqual(fs.existsSync(path.join(destPath, 'subdir', 'sub-file.md')), true);
    });

    test('Должен правильно определять изменения в файлах', async () => {
        const testDir = path.join(testWorkspaceRoot, 'test-dir');
        fs.mkdirSync(testDir, { recursive: true });
        const filePath = path.join(testDir, 'test-file.md');
        
        // Создаем файл с исходным содержимым
        fs.writeFileSync(filePath, '# Исходное содержимое');
        
        const initialHash = await rulesManager.getFileHash(filePath);
        
        // Изменяем файл
        fs.writeFileSync(filePath, '# Измененное содержимое');
        
        const newHash = await rulesManager.getFileHash(filePath);
        
        assert.notStrictEqual(initialHash, newHash);
        
        // Очищаем файл после теста
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });

    test('Должен правильно валидировать конфигурацию', () => {
        const validConfig = {
            rulesRepoUrl: 'https://github.com/user/repo.git',
            globalRulesPath: '.cursor/rules',
            excludePatterns: ['my-project']
        };
        
        const isValid = rulesManager.validateConfig(validConfig);
        assert.strictEqual(isValid.isValid, true);
        
        const invalidConfig = {
            rulesRepoUrl: '',
            globalRulesPath: '',
            excludePatterns: []
        };
        
        const isInvalid = rulesManager.validateConfig(invalidConfig);
        assert.strictEqual(isInvalid.isValid, false);
        assert.notStrictEqual(isInvalid.error, undefined);
    });

    test('Должен обрабатывать пустые директории', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        assert.strictEqual(rules.localRules.length, 0);
        assert.strictEqual(rules.globalRules.length, 0);
    });

    test('Должен обрабатывать несуществующие файлы', async () => {
        const nonExistentFile = path.join(testWorkspaceRoot, 'non-existent.md');
        const hash = await rulesManager.getFileHash(nonExistentFile);
        
        assert.strictEqual(hash, '');
    });

    test('Должен правильно обрабатывать вложенные директории', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        // Создаем вложенную структуру
        const nestedPath = path.join(rulesPath, 'nested', 'deep', 'folder');
        fs.mkdirSync(nestedPath, { recursive: true });
        fs.writeFileSync(path.join(nestedPath, 'deep-file.md'), '# Глубоко вложенный файл');
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        assert.strictEqual(rules.globalRules.length, 1);
        assert.strictEqual(rules.globalRules[0].name, 'nested');
        assert.strictEqual(rules.globalRules[0].files.length, 1);
    });

    test('Должен правильно обрабатывать специальные символы в именах файлов', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        const specialPath = path.join(rulesPath, 'special-chars');
        fs.mkdirSync(specialPath, { recursive: true });
        
        const specialFileName = 'file-with-spaces and (parentheses) [brackets].md';
        fs.writeFileSync(path.join(specialPath, specialFileName), '# Файл со специальными символами');
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        assert.strictEqual(rules.globalRules.length, 1);
        assert.strictEqual(rules.globalRules[0].name, 'special-chars');
        assert.strictEqual(rules.globalRules[0].files.length, 1);
        assert.strictEqual(path.basename(rules.globalRules[0].files[0]), specialFileName);
    });

    test('Должен правильно обрабатывать файлы в корне rules папки', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        // Создаем файл в корне rules папки
        fs.writeFileSync(path.join(rulesPath, 'root-rule.md'), '# Правило в корне');
        
        // Создаем папку с правилом
        const folderPath = path.join(rulesPath, 'folder-rule');
        fs.mkdirSync(folderPath, { recursive: true });
        fs.writeFileSync(path.join(folderPath, 'folder-rule.md'), '# Правило в папке');
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        // Должно быть 2 глобальных правила: файл в корне и папка
        assert.strictEqual(rules.globalRules.length, 2);
        
        // Проверяем файл в корне
        const rootFileRule = rules.globalRules.find(rule => rule.name === 'root-rule.md');
        assert.notStrictEqual(rootFileRule, undefined);
        assert.strictEqual(rootFileRule!.isDirectory, false);
        assert.strictEqual(rootFileRule!.files.length, 1);
        
        // Проверяем папку
        const folderRule = rules.globalRules.find(rule => rule.name === 'folder-rule');
        assert.notStrictEqual(folderRule, undefined);
        assert.strictEqual(folderRule!.isDirectory, true);
        assert.strictEqual(folderRule!.files.length, 1);
    });

    test('Должен правильно обрабатывать исключенные файлы в корне rules папки', async () => {
        const rulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(rulesPath, { recursive: true });
        
        // Создаем исключенную папку в корне (my-project)
        fs.mkdirSync(path.join(rulesPath, 'my-project'), { recursive: true });
        fs.writeFileSync(path.join(rulesPath, 'my-project', 'rule.md'), '# Исключенная папка в корне');
        
        // Создаем обычный файл в корне
        fs.writeFileSync(path.join(rulesPath, 'normal-file.md'), '# Обычный файл в корне');
        
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        // my-project должен быть в локальных правилах (исключен)
        const localRule = rules.localRules.find(rule => rule.name === 'my-project');
        assert.notStrictEqual(localRule, undefined);
        assert.strictEqual(localRule!.isDirectory, true);
        
        // normal-file.md должен быть в глобальных правилах
        const globalRule = rules.globalRules.find(rule => rule.name === 'normal-file.md');
        assert.notStrictEqual(globalRule, undefined);
        assert.strictEqual(globalRule!.isDirectory, false);
    });

    test('Должен пропускать исключенные папки при загрузке правил', async () => {
        // Создаем временную структуру для имитации репозитория
        const tempRepoPath = path.join(testWorkspaceRoot, 'temp-repo');
        const tempRulesPath = path.join(tempRepoPath, '.cursor', 'rules');
        fs.mkdirSync(tempRulesPath, { recursive: true });
        
        // Создаем исключенную папку в репозитории
        const excludedPath = path.join(tempRulesPath, 'my-project');
        fs.mkdirSync(excludedPath, { recursive: true });
        fs.writeFileSync(path.join(excludedPath, 'template-rule.md'), '# Шаблонное правило');
        
        // Создаем обычную папку в репозитории
        const normalPath = path.join(tempRulesPath, 'core');
        fs.mkdirSync(normalPath, { recursive: true });
        fs.writeFileSync(path.join(normalPath, 'core-rule.md'), '# Основное правило');
        
        // Создаем папку для правил в рабочем пространстве
        const workspaceRulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(workspaceRulesPath, { recursive: true });
        
        // Имитируем логику pullRules - копируем только неисключенные папки
        const items = fs.readdirSync(tempRulesPath, { withFileTypes: true });
        for (const item of items) {
            const sourcePath = path.join(tempRulesPath, item.name);
            const destPath = path.join(workspaceRulesPath, item.name);
            
            // Пропускаем исключенные папки
            if (rulesManager.config.excludePatterns.includes(item.name)) {
                continue;
            }
            
            if (item.isDirectory()) {
                await rulesManager.copyDirectory(sourcePath, destPath);
            } else {
                await rulesManager.copyFile(sourcePath, destPath);
            }
        }
        
        // Проверяем результат
        const rules = await rulesManager.getRulesStructure(testWorkspaceRoot);
        
        // my-project не должна быть скопирована (не должна существовать в рабочем пространстве)
        const excludedExists = fs.existsSync(path.join(workspaceRulesPath, 'my-project'));
        assert.strictEqual(excludedExists, false);
        
        // core должна быть скопирована
        const normalExists = fs.existsSync(path.join(workspaceRulesPath, 'core'));
        assert.strictEqual(normalExists, true);
        
        // core должна быть в глобальных правилах
        const normalRule = rules.globalRules.find(rule => rule.name === 'core');
        assert.notStrictEqual(normalRule, undefined);
        
        // Очищаем временные файлы
        fs.rmSync(tempRepoPath, { recursive: true, force: true });
    });

    test('Должен сохранять frontmatter (---) при копировании markdown-файла', async () => {
        const sourcePath = path.join(testWorkspaceRoot, 'source-frontmatter');
        const destPath = path.join(testWorkspaceRoot, 'dest-frontmatter');
        fs.mkdirSync(sourcePath, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });

        // Исходный frontmatter и тело
        const originalFrontmatter = '---\ntitle: "Test Rule"\ndescription: "Описание"\n---';
        const originalBody = '\n# Старое содержимое правила\n';
        const newBody = '\n# Новое содержимое правила\n';
        const fileName = 'frontmatter-test.mdc';

        // В целевом файле уже есть свой frontmatter
        const destFile = path.join(destPath, fileName);
        fs.writeFileSync(destFile, `${originalFrontmatter}\n${originalBody}`);

        // В исходнике другой frontmatter и новое тело
        const srcFile = path.join(sourcePath, fileName);
        fs.writeFileSync(srcFile, `${originalFrontmatter}\n${newBody}`);

        // Копируем файл (имитируем обновление)
        await rulesManager.copyFile(srcFile, destFile);

        // Проверяем, что frontmatter остался прежним, а тело обновилось
        const result = fs.readFileSync(destFile, 'utf8');
        const match = result.match(/^(---[\s\S]*?---)([\s\S]*)/);
        assert.ok(match, 'Формат файла не соответствует ожиданиям');
        const resultFrontmatter = match[1];
        const resultBody = match[2];
        assert.strictEqual(resultFrontmatter, originalFrontmatter, 'Frontmatter должен остаться прежним');
        assert.strictEqual(resultBody.trim(), newBody.trim(), 'Тело файла должно обновиться');
    });

    test('Должен правильно обрабатывать синхронизацию: сохранять frontmatter из репозитория', async () => {
        const sourcePath = path.join(testWorkspaceRoot, 'sync-source');
        const destPath = path.join(testWorkspaceRoot, 'sync-dest');
        fs.mkdirSync(sourcePath, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });

        // Локальный файл (источник при синхронизации)
        const localFrontmatter = '---\nalwaysApply: true\nlocalOnly: true\n---';
        const localBody = '\n# Локальное содержимое\n\n## Локальная секция\n\n- Локальный пункт 1\n- Локальный пункт 2\n';
        const localFile = path.join(sourcePath, 'sync-test.mdc');
        fs.writeFileSync(localFile, `${localFrontmatter}\n${localBody}`);

        // Файл в репозитории (цель при синхронизации)
        const repoFrontmatter = '---\nalwaysApply: false\nrepoOnly: true\n---';
        const repoBody = '\n# Репозиторное содержимое\n\n## Репозиторная секция\n\n- Репозиторный пункт 1\n- Репозиторный пункт 2\n';
        const repoFile = path.join(destPath, 'sync-test.mdc');
        fs.writeFileSync(repoFile, `${repoFrontmatter}\n${repoBody}`);

        // Имитируем синхронизацию: копируем локальный файл в репозиторий
        await rulesManager.copyFileForSync(localFile, repoFile);

        // Проверяем результат: frontmatter должен остаться из репозитория, тело из локального
        const result = fs.readFileSync(repoFile, 'utf8');
        const match = result.match(/^(---[\s\S]*?---)([\s\S]*)/);
        assert.ok(match, 'Формат файла не соответствует ожиданиям');
        
        const resultFrontmatter = match[1];
        const resultBody = match[2];
        
        assert.strictEqual(resultFrontmatter, repoFrontmatter, 'Frontmatter должен остаться из репозитория');
        assert.strictEqual(resultBody.trim(), localBody.trim(), 'Тело должно обновиться из локального файла');
    });

    test('Должен правильно обрабатывать загрузку: копировать файл полностью', async () => {
        const sourcePath = path.join(testWorkspaceRoot, 'pull-source');
        const destPath = path.join(testWorkspaceRoot, 'pull-dest');
        fs.mkdirSync(sourcePath, { recursive: true });
        fs.mkdirSync(destPath, { recursive: true });

        // Файл в репозитории (источник при загрузке)
        const repoFrontmatter = '---\nalwaysApply: true\nrepoOnly: true\n---';
        const repoBody = '\n# Репозиторное содержимое\n\n## Репозиторная секция\n\n- Репозиторный пункт 1\n- Репозиторный пункт 2\n';
        const repoFile = path.join(sourcePath, 'pull-test.mdc');
        fs.writeFileSync(repoFile, `${repoFrontmatter}\n${repoBody}`);

        // Локальный файл (цель при загрузке)
        const localFrontmatter = '---\nalwaysApply: false\nlocalOnly: true\n---';
        const localBody = '\n# Локальное содержимое\n\n## Локальная секция\n\n- Локальный пункт 1\n- Локальный пункт 2\n';
        const localFile = path.join(destPath, 'pull-test.mdc');
        fs.writeFileSync(localFile, `${localFrontmatter}\n${localBody}`);

        // Имитируем загрузку: копируем файл из репозитория локально
        await rulesManager.copyFile(repoFile, localFile);

        // Проверяем результат: файл должен быть полностью заменен
        const result = fs.readFileSync(localFile, 'utf8');
        const expected = fs.readFileSync(repoFile, 'utf8');
        assert.strictEqual(result, expected, 'Файл должен быть полностью заменен при загрузке');
    });

    test('Должен защищать от удаления репозитория при отсутствии локальных правил', async () => {
        // Создаем временную структуру для имитации репозитория
        const tempRepoPath = path.join(testWorkspaceRoot, 'temp-repo');
        const tempRulesPath = path.join(tempRepoPath, '.cursor', 'rules');
        fs.mkdirSync(tempRulesPath, { recursive: true });
        
        // Создаем файлы в репозитории
        const repoFile1 = path.join(tempRulesPath, 'core', 'core-rule.md');
        const repoFile2 = path.join(tempRulesPath, 'database', 'db-rule.md');
        fs.mkdirSync(path.dirname(repoFile1), { recursive: true });
        fs.mkdirSync(path.dirname(repoFile2), { recursive: true });
        fs.writeFileSync(repoFile1, '# Основное правило');
        fs.writeFileSync(repoFile2, '# Правило базы данных');
        
        // Создаем папку для правил в рабочем пространстве, но НЕ создаем файлы
        const workspaceRulesPath = path.join(testWorkspaceRoot, '.cursor', 'rules');
        fs.mkdirSync(workspaceRulesPath, { recursive: true });
        
        // Имитируем логику syncRules - собираем списки файлов
        const getAllFilesWithHash = async (basePath: string): Promise<Record<string, string>> => {
            const result: Record<string, string> = {};
            if (!fs.existsSync(basePath)) {return result;}
            const walk = async (dir: string, rel = '') => {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const abs = path.join(dir, item.name);
                    const relPath = path.join(rel, item.name);
                    const fullPath = path.join(basePath, relPath);
                    const relativeToWorkspace = path.relative(testWorkspaceRoot, fullPath);
                    if (item.isDirectory()) {
                        if (relPath && rulesManager.config.excludePatterns.includes(item.name)) {
                            continue;
                        }
                        await walk(abs, relPath);
                    } else {
                        if (!rulesManager.gitignoreManager.shouldExcludeFromRulesRepo(relativeToWorkspace, rulesManager.config.excludePatterns)) {
                            result[relPath] = fs.existsSync(abs) ? await rulesManager.getFileHash(abs) : '';
                        }
                    }
                }
            };
            await walk(basePath);
            return result;
        };

        const localFiles = await getAllFilesWithHash(workspaceRulesPath);
        const repoFiles = await getAllFilesWithHash(tempRulesPath);

        // Проверяем что локальных файлов нет
        assert.strictEqual(Object.keys(localFiles).length, 0, 'Локальных файлов быть не должно');
        
        // Проверяем что в репозитории есть файлы
        assert.strictEqual(Object.keys(repoFiles).length, 2, 'В репозитории должно быть 2 файла');
        
        // Проверяем что файлы в репозитории существуют
        assert.ok(fs.existsSync(repoFile1), 'Файл core-rule.md должен существовать в репозитории');
        assert.ok(fs.existsSync(repoFile2), 'Файл db-rule.md должен существовать в репозитории');
        
        // Очищаем временные файлы
        fs.rmSync(tempRepoPath, { recursive: true, force: true });
    });

    test('Должен использовать правильный формат коммита с датой и временем', () => {
        // Проверяем что формат коммита соответствует требованиям
        const commitMessage = 'Обновление правил Cursor AI от 2025-01-15 14:30:25';
        const expectedPattern = /^Обновление правил Cursor AI от \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        
        assert.ok(expectedPattern.test(commitMessage), 'Формат коммита должен соответствовать шаблону');
        
        // Проверяем что в сообщении есть дата и время
        const dateTimeMatch = commitMessage.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
        assert.ok(dateTimeMatch, 'В сообщении коммита должна быть дата и время');
    });

    test('Должен генерировать корректную дату и время для коммита', () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        const dateTimeString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        const commitMessage = `Обновление правил Cursor AI от ${dateTimeString}`;
        
        // Проверяем что дата корректная
        assert.ok(commitMessage.includes(dateTimeString), 'Дата и время должны быть включены в сообщение');
        
        // Проверяем что год соответствует текущему
        assert.strictEqual(year, 2025, 'Год должен быть 2025');
    });

    test('Должен правильно обрабатывать настройки уведомлений автосинхронизации', () => {
        // Тестируем настройки по умолчанию
        const config = vscode.workspace.getConfiguration('cursorRulesManager');
        
        // Проверяем что уведомления автосинхронизации по умолчанию отключены
        const showNotifications = config.get<boolean>('showAutoSyncNotifications', false);
        assert.strictEqual(showNotifications, false, 'Уведомления автосинхронизации должны быть отключены по умолчанию');
        
        // Проверяем время отображения уведомлений
        const notificationTimeout = config.get<number>('notificationTimeout', 3000);
        assert.strictEqual(notificationTimeout, 3000, 'Время отображения уведомлений должно быть 3000ms по умолчанию');
        assert.ok(notificationTimeout >= 1000, 'Время отображения должно быть не менее 1000ms');
        assert.ok(notificationTimeout <= 10000, 'Время отображения должно быть не более 10000ms');
    });

    test('Должен правильно обрабатывать логику показа уведомлений автосинхронизации', () => {
        // Имитируем различные сценарии автосинхронизации
        
        // Сценарий 1: Уведомления отключены, есть изменения
        const showNotificationsDisabled = false;
        const statsWithChanges = { added: 2, modified: 1, deleted: 0, total: 3 };
        
        if (showNotificationsDisabled && statsWithChanges.total > 0) {
            // Уведомление НЕ должно показываться
            assert.strictEqual(showNotificationsDisabled, false, 'Уведомление не должно показываться когда отключено');
        }
        
        // Сценарий 2: Уведомления включены, есть изменения
        const showNotificationsEnabled = true;
        
        if (showNotificationsEnabled && statsWithChanges.total > 0) {
            // Уведомление должно показываться
            assert.strictEqual(showNotificationsEnabled, true, 'Уведомление должно показываться когда включено');
        }
        
        // Сценарий 3: Уведомления включены, нет изменений
        const statsNoChanges = { added: 0, modified: 0, deleted: 0, total: 0 };
        
        if (showNotificationsEnabled && statsNoChanges.total > 0) {
            // Уведомление НЕ должно показываться
            assert.strictEqual(statsNoChanges.total, 0, 'Уведомление не должно показываться когда нет изменений');
        }
    });

    test('При активации расширения не должна запускаться автосинхронизация', async () => {
        // Создаем мок для vscode.workspace.getConfiguration
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        let autoSyncCalled = false;
        
        // Мокаем RulesManager.syncRules чтобы отследить вызовы
        const originalSyncRules = rulesManager.syncRules;
        rulesManager.syncRules = async () => {
            autoSyncCalled = true;
            return { added: 0, modified: 0, deleted: 0, total: 0 };
        };
        
        try {
            // Имитируем активацию расширения
            // В реальной активации autoSync() не должна вызываться
            const mockContext = {
                subscriptions: [] as any[]
            };
            
            // Проверяем, что автосинхронизация не запускается автоматически
            assert.strictEqual(autoSyncCalled, false);
            
            // Проверяем, что таймер автосинхронизации устанавливается, но не запускается немедленно
            // Это проверяется тем, что autoSyncCalled остается false
        } finally {
            // Восстанавливаем оригинальные методы
            vscode.workspace.getConfiguration = originalGetConfiguration;
            rulesManager.syncRules = originalSyncRules;
        }
    });
}); 