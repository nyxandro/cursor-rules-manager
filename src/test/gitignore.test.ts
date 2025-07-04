import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { GitignoreManager } from '../gitignoreManager';

suite('Gitignore Manager Test Suite', () => {
    let testWorkspaceRoot: string;
    let gitignoreManager: GitignoreManager;

    setup(() => {
        testWorkspaceRoot = path.join(__dirname, '../../test-workspace');
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
        fs.mkdirSync(testWorkspaceRoot, { recursive: true });
        gitignoreManager = new GitignoreManager();
    });

    teardown(() => {
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    test('Должен создавать .gitignore если его нет', async () => {
        const gitignorePath = path.join(testWorkspaceRoot, '.gitignore');
        
        // Проверяем что файла нет
        assert.strictEqual(fs.existsSync(gitignorePath), false);
        
        // Создаем .gitignore
        await gitignoreManager.ensureGitignore(testWorkspaceRoot, ['my-project']);
        
        // Проверяем что файл создан
        assert.strictEqual(fs.existsSync(gitignorePath), true);
        
        const content = fs.readFileSync(gitignorePath, 'utf8');
        assert.ok(content.includes('.cursor/rules'));
        assert.ok(content.includes('!.cursor/rules/my-project'));
    });

    test('Должен добавлять исключения для .cursor/rules в существующий .gitignore', async () => {
        const gitignorePath = path.join(testWorkspaceRoot, '.gitignore');
        
        // Создаем существующий .gitignore
        const existingContent = `# Dependencies
node_modules/
out/
*.vsix`;
        fs.writeFileSync(gitignorePath, existingContent);
        
        // Добавляем исключения для правил
        await gitignoreManager.ensureGitignore(testWorkspaceRoot, ['my-project', 'local-rules']);
        
        const content = fs.readFileSync(gitignorePath, 'utf8');
        
        // Проверяем что старый контент сохранен
        assert.ok(content.includes('# Dependencies'));
        assert.ok(content.includes('node_modules/'));
        
        // Проверяем что новые правила добавлены
        assert.ok(content.includes('.cursor/rules'));
        assert.ok(content.includes('!.cursor/rules/my-project'));
        assert.ok(content.includes('!.cursor/rules/local-rules'));
    });

    test('Должен не дублировать правила если они уже есть', async () => {
        const gitignorePath = path.join(testWorkspaceRoot, '.gitignore');
        
        // Создаем .gitignore с уже существующими правилами
        const existingContent = `# Dependencies
node_modules/

# Cursor Rules
.cursor/rules
!.cursor/rules/my-project`;
        fs.writeFileSync(gitignorePath, existingContent);
        
        // Добавляем те же правила
        await gitignoreManager.ensureGitignore(testWorkspaceRoot, ['my-project']);
        
        const content = fs.readFileSync(gitignorePath, 'utf8');
        
        // Проверяем что дублирования нет
        const cursorRulesCount = (content.match(/\.cursor\/rules/g) || []).length;
        const myProjectCount = (content.match(/!\.cursor\/rules\/my-project/g) || []).length;
        
        assert.strictEqual(cursorRulesCount, 1);
        assert.strictEqual(myProjectCount, 1);
    });

    test('Должен добавлять новые исключения к существующим', async () => {
        const gitignorePath = path.join(testWorkspaceRoot, '.gitignore');
        
        // Создаем .gitignore с одним исключением
        const existingContent = `# Dependencies
node_modules/

# Cursor Rules
.cursor/rules
!.cursor/rules/my-project`;
        fs.writeFileSync(gitignorePath, existingContent);
        
        // Добавляем новое исключение
        await gitignoreManager.ensureGitignore(testWorkspaceRoot, ['my-project', 'new-local']);
        
        const content = fs.readFileSync(gitignorePath, 'utf8');
        
        // Проверяем что оба исключения есть
        assert.ok(content.includes('!.cursor/rules/my-project'));
        assert.ok(content.includes('!.cursor/rules/new-local'));
    });

    test('Должен правильно определять что файл должен быть исключен', () => {
        const excludePatterns = ['my-project', 'local-rules'];
        
        // Файлы которые должны быть исключены
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/core/rule.md', excludePatterns), false);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/database/migration.md', excludePatterns), false);
        
        // Файлы которые НЕ должны быть исключены
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/my-project/rule.md', excludePatterns), true);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/local-rules/config.md', excludePatterns), true);
    });

    test('Должен правильно обрабатывать множественные исключения', () => {
        const excludePatterns = ['my-project', 'local-rules', 'temp'];
        
        // Проверяем все исключения
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/my-project/rule.md', excludePatterns), true);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/local-rules/config.md', excludePatterns), true);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/temp/test.md', excludePatterns), true);
        
        // Проверяем что обычные файлы не исключены
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/core/rule.md', excludePatterns), false);
    });

    test('Должен правильно обрабатывать файлы в корне .cursor/rules', () => {
        const excludePatterns = ['my-project'];
        
        // Файлы в корне rules папки
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/global-rule.md', excludePatterns), false);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/my-project.md', excludePatterns), true);
    });

    test('Должен правильно обрабатывать вложенные папки', () => {
        const excludePatterns = ['my-project'];
        
        // Вложенные папки в исключенной папке
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/my-project/subfolder/rule.md', excludePatterns), true);
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/my-project/deep/nested/file.md', excludePatterns), true);
        
        // Вложенные папки в обычной папке
        assert.strictEqual(gitignoreManager.shouldExclude('.cursor/rules/core/subfolder/rule.md', excludePatterns), false);
    });
}); 