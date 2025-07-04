import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { simpleGit, SimpleGit } from 'simple-git';
import * as os from 'os';
import which from 'which';
import { GitignoreManager } from './gitignoreManager';

export interface Rule {
    name: string;
    path: string;
    files: string[];
    isDirectory: boolean;
}

export interface RulesStructure {
    localRules: Rule[];
    globalRules: Rule[];
}

export interface Config {
    rulesRepoUrl: string;
    globalRulesPath: string;
    excludePatterns: string[];
}

export interface SyncStats {
    added: number;
    modified: number;
    deleted: number;
    total: number;
}

export class RulesManager {
    public config: Config;
    public gitignoreManager: GitignoreManager;

    constructor() {
        this.config = this.getDefaultConfig();
        this.gitignoreManager = new GitignoreManager();
    }

    private getSimpleGit(): SimpleGit {
        const gitPath = which.sync('git', { nothrow: true });
        console.log('Git path:', gitPath);
        
        const git = simpleGit({
            binary: gitPath || 'git',
            maxConcurrentProcesses: 1
        });
        
        console.log('Git configuration:', {
            binary: gitPath || 'git',
            maxConcurrentProcesses: 1
        });
        
        return git;
    }

    private getDefaultConfig(): Config {
        const workspaceConfig = vscode.workspace.getConfiguration('cursorRulesManager');
        return {
            rulesRepoUrl: workspaceConfig.get('rulesRepoUrl', 'https://github.com/nyxandro/my-cursor-rules.git'),
            globalRulesPath: workspaceConfig.get('globalRulesPath', '.cursor/rules'),
            excludePatterns: workspaceConfig.get('excludePatterns', ['my-project'])
        };
    }

    public validateConfig(config: Config): boolean {
        return config.rulesRepoUrl.length > 0 && 
               config.globalRulesPath.length > 0 && 
               config.excludePatterns.length > 0;
    }

    public async getRulesStructure(workspaceRoot: string): Promise<RulesStructure> {
        const globalRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);

        const localRules: Rule[] = [];
        const globalRules: Rule[] = [];

        // Сканируем правила
        if (fs.existsSync(globalRulesPath)) {
            const items = fs.readdirSync(globalRulesPath, { withFileTypes: true });
            for (const item of items) {
                const rulePath = path.join(globalRulesPath, item.name);
                
                if (item.isDirectory()) {
                    const files = this.getFilesInDirectory(rulePath);
                    const rule: Rule = {
                        name: item.name,
                        path: rulePath,
                        files,
                        isDirectory: true
                    };
                    if (this.config.excludePatterns.includes(item.name)) {
                        localRules.push(rule);
                    } else {
                        globalRules.push(rule);
                    }
                } else if (item.isFile()) {
                    // Обрабатываем файлы в корне rules папки
                    const rule: Rule = {
                        name: item.name,
                        path: rulePath,
                        files: [rulePath],
                        isDirectory: false
                    };
                    if (this.config.excludePatterns.includes(item.name)) {
                        localRules.push(rule);
                    } else {
                        globalRules.push(rule);
                    }
                }
            }
        }

        return { localRules, globalRules };
    }

    public async getSyncableRules(workspaceRoot: string): Promise<Rule[]> {
        const { globalRules } = await this.getRulesStructure(workspaceRoot);
        return globalRules;
    }

    private getFilesInDirectory(dirPath: string): string[] {
        const files: string[] = [];
        
        if (!fs.existsSync(dirPath)) {
            return files;
        }

        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
                files.push(...this.getFilesInDirectory(fullPath));
            } else {
                files.push(fullPath);
            }
        }

        return files;
    }

    public async copyFile(source: string, destination: string): Promise<void> {
        const destDir = path.dirname(destination);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // При загрузке из GitHub: копируем файл полностью
        fs.copyFileSync(source, destination);
    }

    public async copyFileForSync(source: string, destination: string): Promise<void> {
        const destDir = path.dirname(destination);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // Проверяем, является ли файл глобальным правилом (не в исключённой папке)
        const isGlobalRule = !this.config.excludePatterns.some(pattern => destination.includes(path.sep + pattern + path.sep) || destination.includes(path.sep + pattern + '.'));
        const isMarkdown = source.endsWith('.md') || source.endsWith('.mdc');
        
        if (isGlobalRule && isMarkdown && fs.existsSync(destination)) {
            // При синхронизации: сохраняем frontmatter из целевого файла (репозитория), обновляем только тело
            const srcContent = fs.readFileSync(source, 'utf8');
            const destContent = fs.readFileSync(destination, 'utf8');
            
            const matchSrc = srcContent.match(/^(---[\s\S]*?---)([\s\S]*)/);
            const matchDest = destContent.match(/^(---[\s\S]*?---)([\s\S]*)/);
            
            if (matchSrc && matchDest) {
                const destFrontmatter = matchDest[1];
                let srcBody = matchSrc[2].replace(/^\s+/, ''); // убираем лишние пустые строки
                
                // Собираем новый файл: frontmatter из целевого файла + контент из исходного
                const newContent = destFrontmatter + '\n' + srcBody;
                fs.writeFileSync(destination, newContent, 'utf8');
            } else {
                // Если нет frontmatter в одном из файлов, копируем как есть
                fs.copyFileSync(source, destination);
            }
        } else {
            // Для локальных правил, не markdown или если целевой файл не существует — копируем как есть
            fs.copyFileSync(source, destination);
        }
    }

    public async copyDirectory(source: string, destination: string): Promise<void> {
        if (!fs.existsSync(source)) {
            throw new Error(`Источник не существует: ${source}`);
        }

        if (!fs.existsSync(destination)) {
            fs.mkdirSync(destination, { recursive: true });
        }

        const items = fs.readdirSync(source, { withFileTypes: true });
        for (const item of items) {
            const sourcePath = path.join(source, item.name);
            const destPath = path.join(destination, item.name);

            if (item.isDirectory()) {
                await this.copyDirectory(sourcePath, destPath);
            } else {
                await this.copyFile(sourcePath, destPath);
            }
        }
    }

    public async getFileHash(filePath: string): Promise<string> {
        if (!fs.existsSync(filePath)) {
            return '';
        }

        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private getTempDir(): string {
        // Используем уникальную временную папку в системном tmp
        const tempDir = path.join(os.tmpdir(), `cursor-rules-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        return tempDir;
    }

    public async syncRules(workspaceRoot: string): Promise<SyncStats> {
        try {
            console.log('Начинаю синхронизацию правил...');
            console.log('Workspace root:', workspaceRoot);
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const syncableRules = await this.getSyncableRules(workspaceRoot);
            console.log('Правила для синхронизации:', syncableRules.map(r => r.name));
            
            const tempDir = this.getTempDir();
            console.log('Временная папка:', tempDir);
            
            // Клонируем репозиторий
            console.log('Клонирую репозиторий...');
            await git.clone(this.config.rulesRepoUrl, tempDir);
            console.log('Репозиторий склонирован');
            
            const repoRulesPath = path.join(tempDir, this.config.globalRulesPath);
            console.log('Путь к правилам в репозитории:', repoRulesPath);
            
            // Создаем папку для правил если её нет
            if (!fs.existsSync(repoRulesPath)) {
                fs.mkdirSync(repoRulesPath, { recursive: true });
                console.log('Создана папка для правил в репозитории');
            }

            // --- Новый блок: собираем списки файлов и хеши ---
            const getAllFilesWithHash = async (basePath: string): Promise<Record<string, string>> => {
                const result: Record<string, string> = {};
                if (!fs.existsSync(basePath)) return result;
                const walk = async (dir: string, rel = '') => {
                    const items = fs.readdirSync(dir, { withFileTypes: true });
                    for (const item of items) {
                        const abs = path.join(dir, item.name);
                        const relPath = path.join(rel, item.name);
                        // Используем GitignoreManager для проверки исключений
                        const fullPath = path.join(basePath, relPath);
                        const relativeToWorkspace = path.relative(workspaceRoot, fullPath);
                        if (item.isDirectory()) {
                            if (relPath && this.config.excludePatterns.includes(item.name)) {
                                console.log(`Пропускаем исключённую папку: ${item.name}`);
                                continue;
                            }
                            await walk(abs, relPath);
                        } else {
                            if (!this.gitignoreManager.shouldExcludeFromRulesRepo(relativeToWorkspace, this.config.excludePatterns)) {
                                result[relPath] = fs.existsSync(abs) ? await this.getFileHash(abs) : '';
                            } else {
                                console.log(`Пропускаем исключённый файл: ${relPath}`);
                            }
                        }
                    }
                };
                await walk(basePath);
                return result;
            };

            const localFiles = await getAllFilesWithHash(path.join(workspaceRoot, this.config.globalRulesPath));
            const repoFiles = await getAllFilesWithHash(repoRulesPath);

            // --- Сравниваем списки ---
            let added = 0, modified = 0, deleted = 0;
            const toCopy: string[] = [];
            const toDelete: string[] = [];

            for (const file in localFiles) {
                if (!(file in repoFiles)) {
                    added++;
                    toCopy.push(file);
                } else if (localFiles[file] !== repoFiles[file]) {
                    modified++;
                    toCopy.push(file);
                }
            }
            // --- ЗАЩИТА ОТ УДАЛЕНИЯ РЕПОЗИТОРИЯ ---
            // Проверяем, есть ли локальные файлы вообще
            const hasLocalFiles = Object.keys(localFiles).length > 0;
            if (!hasLocalFiles) {
                console.log('⚠️  ВНИМАНИЕ: Локальная папка .cursor/rules пуста или не содержит файлов для синхронизации');
                console.log('⚠️  Защита активирована: удаление файлов из репозитория заблокировано');
                console.log('⚠️  Это предотвращает случайное удаление всего репозитория при временном удалении локальных правил');
                for (const file in repoFiles) {
                    if (!(file in localFiles)) {
                        console.log(`⚠️  Пропускаем удаление файла из репозитория: ${file}`);
                    }
                }
            } else {
                for (const file in repoFiles) {
                    if (!(file in localFiles)) {
                        deleted++;
                        toDelete.push(file);
                    }
                }
            }
            // --- Удаляем только реально удалённые файлы (если защита не активирована) ---
            for (const file of toDelete) {
                const abs = path.join(repoRulesPath, file);
                if (fs.existsSync(abs)) fs.unlinkSync(abs);
            }
            // --- Копируем только новые и изменённые ---
            for (const file of toCopy) {
                const src = path.join(workspaceRoot, this.config.globalRulesPath, file);
                const dst = path.join(repoRulesPath, file);
                const dstDir = path.dirname(dst);
                if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
                await this.copyFileForSync(src, dst);
            }

            // Переходим в папку репозитория
            await git.cwd(tempDir);
            console.log('Перешел в папку репозитория');
            
            // Проверяем статус git
            const status = await git.status();
            console.log('Git status:', status);
            
            // Добавляем все изменения
            console.log('Добавляю изменения в git...');
            await git.add('.');
            
            // Проверяем есть ли изменения для коммита
            const statusAfterAdd = await git.status();
            console.log('Git status после add:', statusAfterAdd);
            
            if (statusAfterAdd.files.length > 0) {
                // Новый шаблон коммита
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                const dateTimeString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                const commitMessage = `Обновление правил Cursor AI от ${dateTimeString}`;
                console.log('Коммичу изменения...');
                await git.commit(commitMessage);
                console.log('Изменения закоммичены');
                console.log('Отправляю изменения в GitHub...');
                await git.push();
                console.log('Изменения отправлены в GitHub');
            } else {
                console.log('Нет изменений для коммита');
            }
            
            // Удаляем временную папку
            setTimeout(() => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log('Временная папка удалена');
                } catch (e) {
                    console.error('Ошибка удаления временной папки:', e);
                }
            }, 2000);
            
            const stats: SyncStats = {
                added,
                modified,
                deleted,
                total: added + modified + deleted
            };
            
            console.log('Синхронизация завершена успешно', stats);
            return stats;
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
            throw new Error(`Ошибка синхронизации: ${error}`);
        }
    }

    public async pullRules(workspaceRoot: string): Promise<void> {
        try {
            console.log('Начинаю загрузку правил из GitHub...');
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const tempDir = this.getTempDir();
            await git.clone(this.config.rulesRepoUrl, tempDir);
            const repoRulesPath = path.join(tempDir, this.config.globalRulesPath);
            const globalRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);
            
            if (fs.existsSync(repoRulesPath)) {
                // Создаем папку для правил если её нет
                if (!fs.existsSync(globalRulesPath)) {
                    fs.mkdirSync(globalRulesPath, { recursive: true });
                }
                
                // Копируем только неисключенные папки и файлы
                const items = fs.readdirSync(repoRulesPath, { withFileTypes: true });
                for (const item of items) {
                    const sourcePath = path.join(repoRulesPath, item.name);
                    const destPath = path.join(globalRulesPath, item.name);
                    
                    // Пропускаем исключенные папки
                    if (this.config.excludePatterns.includes(item.name)) {
                        console.log(`Пропускаем исключенную папку при загрузке: ${item.name}`);
                        continue;
                    }
                    
                    if (item.isDirectory()) {
                        await this.copyDirectory(sourcePath, destPath);
                    } else {
                        await this.copyFile(sourcePath, destPath);
                    }
                }
            }
            
            setTimeout(() => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (e) {
                    console.error('Ошибка удаления временной папки:', e);
                }
            }, 1500);
        } catch (error) {
            throw new Error(`Ошибка загрузки правил: ${error}`);
        }
    }

    public async pushRules(workspaceRoot: string): Promise<SyncStats> {
        try {
            console.log('Начинаю отправку правил...');
            console.log('Workspace root:', workspaceRoot);
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const syncableRules = await this.getSyncableRules(workspaceRoot);
            console.log('Правила для отправки:', syncableRules.map(r => r.name));
            
            const tempDir = this.getTempDir();
            console.log('Временная папка:', tempDir);
            
            // Клонируем репозиторий
            console.log('Клонирую репозиторий...');
            await git.clone(this.config.rulesRepoUrl, tempDir);
            console.log('Репозиторий склонирован');
            
            const repoRulesPath = path.join(tempDir, this.config.globalRulesPath);
            console.log('Путь к правилам в репозитории:', repoRulesPath);
            
            // Создаем папку для правил если её нет
            if (!fs.existsSync(repoRulesPath)) {
                fs.mkdirSync(repoRulesPath, { recursive: true });
                console.log('Создана папка для правил в репозитории');
            }

            // --- Новый блок: собираем списки файлов и хеши ---
            const getAllFilesWithHash = async (basePath: string): Promise<Record<string, string>> => {
                const result: Record<string, string> = {};
                if (!fs.existsSync(basePath)) return result;
                const walk = async (dir: string, rel = '') => {
                    const items = fs.readdirSync(dir, { withFileTypes: true });
                    for (const item of items) {
                        const abs = path.join(dir, item.name);
                        const relPath = path.join(rel, item.name);
                        // Используем GitignoreManager для проверки исключений
                        const fullPath = path.join(basePath, relPath);
                        const relativeToWorkspace = path.relative(workspaceRoot, fullPath);
                        if (item.isDirectory()) {
                            if (relPath && this.config.excludePatterns.includes(item.name)) {
                                console.log(`Пропускаем исключённую папку: ${item.name}`);
                                continue;
                            }
                            await walk(abs, relPath);
                        } else {
                            if (!this.gitignoreManager.shouldExcludeFromRulesRepo(relativeToWorkspace, this.config.excludePatterns)) {
                                result[relPath] = fs.existsSync(abs) ? await this.getFileHash(abs) : '';
                            } else {
                                console.log(`Пропускаем исключённый файл: ${relPath}`);
                            }
                        }
                    }
                };
                await walk(basePath);
                return result;
            };

            const localFiles = await getAllFilesWithHash(path.join(workspaceRoot, this.config.globalRulesPath));
            const repoFiles = await getAllFilesWithHash(repoRulesPath);

            // --- Сравниваем списки ---
            let added = 0, modified = 0, deleted = 0;
            const toCopy: string[] = [];
            const toDelete: string[] = [];

            for (const file in localFiles) {
                if (!(file in repoFiles)) {
                    added++;
                    toCopy.push(file);
                } else if (localFiles[file] !== repoFiles[file]) {
                    modified++;
                    toCopy.push(file);
                }
            }
            // --- ЗАЩИТА ОТ УДАЛЕНИЯ РЕПОЗИТОРИЯ ---
            // Проверяем, есть ли локальные файлы вообще
            const hasLocalFiles = Object.keys(localFiles).length > 0;
            if (!hasLocalFiles) {
                console.log('⚠️  ВНИМАНИЕ: Локальная папка .cursor/rules пуста или не содержит файлов для синхронизации');
                console.log('⚠️  Защита активирована: удаление файлов из репозитория заблокировано');
                console.log('⚠️  Это предотвращает случайное удаление всего репозитория при временном удалении локальных правил');
                for (const file in repoFiles) {
                    if (!(file in localFiles)) {
                        console.log(`⚠️  Пропускаем удаление файла из репозитория: ${file}`);
                    }
                }
            } else {
                for (const file in repoFiles) {
                    if (!(file in localFiles)) {
                        deleted++;
                        toDelete.push(file);
                    }
                }
            }
            // --- Удаляем только реально удалённые файлы (если защита не активирована) ---
            for (const file of toDelete) {
                const abs = path.join(repoRulesPath, file);
                if (fs.existsSync(abs)) fs.unlinkSync(abs);
            }
            // --- Копируем только новые и изменённые ---
            for (const file of toCopy) {
                const src = path.join(workspaceRoot, this.config.globalRulesPath, file);
                const dst = path.join(repoRulesPath, file);
                const dstDir = path.dirname(dst);
                if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
                await this.copyFileForSync(src, dst);
            }

            // Переходим в папку репозитория
            await git.cwd(tempDir);
            console.log('Перешел в папку репозитория');
            
            // Проверяем статус git
            const status = await git.status();
            console.log('Git status:', status);
            
            // Добавляем все изменения
            console.log('Добавляю изменения в git...');
            await git.add('.');
            
            // Проверяем есть ли изменения для коммита
            const statusAfterAdd = await git.status();
            console.log('Git status после add:', statusAfterAdd);
            
            if (statusAfterAdd.files.length > 0) {
                // Новый шаблон коммита
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                const dateTimeString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                const commitMessage = `Обновление правил Cursor AI от ${dateTimeString}`;
                console.log('Коммичу изменения...');
                await git.commit(commitMessage);
                console.log('Изменения закоммичены');
                console.log('Отправляю изменения в GitHub...');
                await git.push();
                console.log('Изменения отправлены в GitHub');
            } else {
                console.log('Нет изменений для коммита');
            }
            
            // Удаляем временную папку
            setTimeout(() => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log('Временная папка удалена');
                } catch (e) {
                    console.error('Ошибка удаления временной папки:', e);
                }
            }, 2000);
            
            const stats: SyncStats = {
                added,
                modified,
                deleted,
                total: added + modified + deleted
            };
            
            console.log('Отправка правил завершена успешно', stats);
            return stats;
        } catch (error) {
            console.error('Ошибка отправки правил:', error);
            throw new Error(`Ошибка отправки правил: ${error}`);
        }
    }

    public async getStatus(workspaceRoot: string): Promise<string> {
        try {
            const { localRules, globalRules } = await this.getRulesStructure(workspaceRoot);
            const syncableRules = await this.getSyncableRules(workspaceRoot);
            
            let status = '=== Статус правил Cursor ===\n\n';
            status += `Локальные правила (${localRules.length}):\n`;
            localRules.forEach(rule => {
                status += `  - ${rule.name} (исключено)\n`;
            });
            
            status += `\nГлобальные правила (${globalRules.length}):\n`;
            globalRules.forEach(rule => {
                status += `  - ${rule.name}\n`;
            });
            
            status += `\nПравила для синхронизации (${syncableRules.length}):\n`;
            syncableRules.forEach(rule => {
                status += `  - ${rule.name}\n`;
            });
            
            return status;
            
        } catch (error) {
            return `Ошибка получения статуса: ${error}`;
        }
    }
} 