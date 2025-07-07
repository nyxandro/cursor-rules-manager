import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { simpleGit, SimpleGit } from 'simple-git';
import * as os from 'os';
import which from 'which';
import { GitignoreManager } from './gitignoreManager';

// Retry конфигурация для сетевых операций
export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
}

// Утилита для retry логики
async function withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    operationName: string
): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;
            const errorMessage = String(error);
            
            // Проверяем, является ли ошибка сетевой/временной
            const isRetryableError = 
                errorMessage.includes('fetch first') ||
                errorMessage.includes('rejected') ||
                errorMessage.includes('timeout') ||
                errorMessage.includes('network') ||
                errorMessage.includes('connection') ||
                errorMessage.includes('unable to access') ||
                errorMessage.includes('Could not resolve host') ||
                errorMessage.includes('Connection timed out') ||
                errorMessage.includes('SSL certificate') ||
                errorMessage.includes('authentication') ||
                errorMessage.includes('permission denied') ||
                errorMessage.includes('remote: Repository not found') ||
                errorMessage.includes('remote: Invalid username or password');
            
            // Если это не retryable ошибка или последняя попытка, выбрасываем ошибку
            if (!isRetryableError || attempt === config.maxAttempts) {
                throw error;
            }
            
            // Вычисляем задержку с экспоненциальным backoff
            const delay = Math.min(
                config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
                config.maxDelay
            );
            
            console.log(`Попытка ${attempt}/${config.maxAttempts} для ${operationName} не удалась: ${errorMessage}`);
            console.log(`Повторная попытка через ${delay}ms...`);
            
            // Ждем перед следующей попыткой
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError!;
}

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

export interface FirstSyncInfo {
    isFirstSync: boolean;
    hasLocalRules: boolean;
    hasRemoteRules: boolean;
    localRulesCount: number;
    remoteRulesCount: number;
    conflicts: string[];
}

export interface SafeSyncOptions {
    backupLocalRules: boolean;
    mergeStrategy: 'local-first' | 'remote-first' | 'manual';
    createBackup: boolean;
}

export class RulesManager {
    public config: Config;
    public gitignoreManager: GitignoreManager;
    private retryConfig: RetryConfig;

    constructor() {
        this.config = this.getDefaultConfig();
        this.gitignoreManager = new GitignoreManager();
        this.retryConfig = this.getRetryConfig();
    }

    private getRetryConfig(): RetryConfig {
        const workspaceConfig = vscode.workspace.getConfiguration('cursorRulesManager');
        return {
            maxAttempts: workspaceConfig.get<number>('retryMaxAttempts', 3),
            baseDelay: workspaceConfig.get<number>('retryBaseDelay', 1000),
            maxDelay: workspaceConfig.get<number>('retryMaxDelay', 10000),
            backoffMultiplier: workspaceConfig.get<number>('retryBackoffMultiplier', 2)
        };
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
            rulesRepoUrl: workspaceConfig.get('rulesRepoUrl', ''),
            globalRulesPath: workspaceConfig.get('globalRulesPath', '.cursor/rules'),
            excludePatterns: workspaceConfig.get('excludePatterns', ['my-project'])
        };
    }

    public validateConfig(config: Config): { isValid: boolean; error?: string } {
        if (!config.rulesRepoUrl || config.rulesRepoUrl.trim() === '') {
            return {
                isValid: false,
                error: 'URL репозитория с правилами не указан. Пожалуйста, укажите Rules Repo Url в настройках расширения и перезапустите IDE.'
            };
        }
        
        if (!config.globalRulesPath || config.globalRulesPath.trim() === '') {
            return {
                isValid: false,
                error: 'Путь к глобальным правилам не указан.'
            };
        }
        
        if (!config.excludePatterns || config.excludePatterns.length === 0) {
            return {
                isValid: false,
                error: 'Список исключаемых папок не указан.'
            };
        }
        
        return { isValid: true };
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
                const srcBody = matchSrc[2]; // не удаляем пустые строки!
                const newContent = destFrontmatter + srcBody;
                fs.writeFileSync(destination, newContent, 'utf8');
            } else {
                // Если нет frontmatter в одном из файлов, копируем как есть
                fs.copyFileSync(source, destination);
            }
            return;
        }
        // Для локальных правил, не markdown или если целевой файл не существует — копируем как есть
        fs.copyFileSync(source, destination);
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
            
            // Проверяем конфигурацию
            const configValidation = this.validateConfig(this.config);
            if (!configValidation.isValid) {
                throw new Error(configValidation.error || 'Неверная конфигурация');
            }
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const syncableRules = await this.getSyncableRules(workspaceRoot);
            console.log('Правила для синхронизации:', syncableRules.map(r => r.name));
            
            const tempDir = this.getTempDir();
            console.log('Временная папка:', tempDir);
            
            // Клонируем репозиторий с retry
            console.log('Клонирую репозиторий...');
            await withRetry(
                async () => {
            await git.clone(this.config.rulesRepoUrl, tempDir);
            console.log('Репозиторий склонирован');
                },
                this.retryConfig,
                'клонирование репозитория'
            );
            
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
                if (!fs.existsSync(basePath)) {return result;}
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
            for (const file in repoFiles) {
                if (!(file in localFiles)) {
                    deleted++;
                    toDelete.push(file);
                }
            }

            // --- Копируем только новые и изменённые ---
            for (const file of toCopy) {
                const src = path.join(workspaceRoot, this.config.globalRulesPath, file);
                const dst = path.join(repoRulesPath, file);
                const dstDir = path.dirname(dst);
                if (!fs.existsSync(dstDir)) {fs.mkdirSync(dstDir, { recursive: true });}
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
                const projectName = path.basename(workspaceRoot);
                const commitMessage = `Обновление правил Cursor AI в проекте ${projectName} от ${dateTimeString}`;
                console.log('Коммичу изменения...');
                await git.commit(commitMessage);
                console.log('Изменения закоммичены');
                
                // Сначала пытаемся получить последние изменения с сервера
                console.log('Получаю последние изменения с сервера...');
                try {
                    await git.pull();
                    console.log('Изменения получены с сервера');
                } catch (pullError) {
                    console.log('Ошибка при получении изменений с сервера:', pullError);
                    // Если pull не удался, продолжаем с push
                }
                
                console.log('Отправляю изменения в GitHub...');
                try {
                await git.push();
                console.log('Изменения отправлены в GitHub');
                } catch (pushError) {
                    console.error('Ошибка при отправке изменений:', pushError);
                    const errorMessage = String(pushError);
                    
                    if (errorMessage.includes('fetch first') || errorMessage.includes('rejected')) {
                        throw new Error(`Конфликт при синхронизации: в удалённом репозитории есть изменения, которых нет локально. 
                        
Для решения:
1. Выполните команду "Загрузить правила из GitHub" для получения последних изменений
2. Затем повторите синхронизацию

Или выполните команду "Синхронизировать правила Cursor" для автоматического разрешения конфликтов.`);
                    } else {
                        throw new Error(`Ошибка отправки в GitHub: ${errorMessage}. 
                        
Возможные причины:
- Нет прав на запись в репозиторий
- Проблемы с сетевым подключением
- Репозиторий недоступен

Проверьте настройки доступа к репозиторию и повторите попытку.`);
                    }
                }
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

    public async pullRules(workspaceRoot: string): Promise<SyncStats> {
        try {
            console.log('Начинаю загрузку правил из GitHub...');
            
            // Проверяем конфигурацию
            const configValidation = this.validateConfig(this.config);
            if (!configValidation.isValid) {
                throw new Error(configValidation.error || 'Неверная конфигурация');
            }
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const tempDir = this.getTempDir();
            // Клонируем репозиторий с retry
            await withRetry(
                async () => {
            await git.clone(this.config.rulesRepoUrl, tempDir);
                    console.log('Репозиторий склонирован');
                },
                this.retryConfig,
                'клонирование репозитория (pullRules)'
            );
            const repoRulesPath = path.join(tempDir, this.config.globalRulesPath);
            const globalRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);
            
            let added = 0, modified = 0, deleted = 0;
            
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
                        added++;
                    } else {
                        await this.copyFile(sourcePath, destPath);
                        added++;
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
            
            const stats: SyncStats = {
                added,
                modified,
                deleted,
                total: added + modified + deleted
            };
            
            console.log('Загрузка правил завершена успешно', stats);
            return stats;
        } catch (error) {
            throw new Error(`Ошибка загрузки правил: ${error}`);
        }
    }

    public async pushRules(workspaceRoot: string): Promise<SyncStats> {
        try {
            console.log('Начинаю отправку правил...');
            console.log('Workspace root:', workspaceRoot);
            
            // Проверяем конфигурацию
            const configValidation = this.validateConfig(this.config);
            if (!configValidation.isValid) {
                throw new Error(configValidation.error || 'Неверная конфигурация');
            }
            
            // Проверяем и обновляем .gitignore
            await this.gitignoreManager.ensureGitignore(workspaceRoot, this.config.excludePatterns);
            console.log('Gitignore обновлен');
            
            const git = this.getSimpleGit();
            const syncableRules = await this.getSyncableRules(workspaceRoot);
            console.log('Правила для отправки:', syncableRules.map(r => r.name));
            
            const tempDir = this.getTempDir();
            console.log('Временная папка:', tempDir);
            
            // Клонируем репозиторий с retry
            await withRetry(
                async () => {
            await git.clone(this.config.rulesRepoUrl, tempDir);
            console.log('Репозиторий склонирован');
                },
                this.retryConfig,
                'клонирование репозитория (pushRules)'
            );
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
                if (!fs.existsSync(basePath)) {return result;}
                const walk = async (dir: string, rel = '') => {
                    const items = fs.readdirSync(dir, { withFileTypes: true });
                    for (const item of items) {
                        const abs = path.join(dir, item.name);
                        const relPath = path.join(rel, item.name);
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
            for (const file in repoFiles) {
                if (!(file in localFiles)) {
                    deleted++;
                    toDelete.push(file);
                }
            }

            // --- Копируем только новые и изменённые ---
            for (const file of toCopy) {
                const src = path.join(workspaceRoot, this.config.globalRulesPath, file);
                const dst = path.join(repoRulesPath, file);
                const dstDir = path.dirname(dst);
                if (!fs.existsSync(dstDir)) {fs.mkdirSync(dstDir, { recursive: true });}
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
                const projectName = path.basename(workspaceRoot);
                const commitMessage = `Обновление правил Cursor AI в проекте ${projectName} от ${dateTimeString}`;
                console.log('Коммичу изменения...');
                await git.commit(commitMessage);
                console.log('Изменения закоммичены');
                
                // pull с retry
                console.log('Получаю последние изменения с сервера...');
                try {
                    await withRetry(
                        async () => {
                            await git.pull();
                            console.log('Изменения получены с сервера');
                        },
                        this.retryConfig,
                        'получение изменений с сервера (pushRules)'
                    );
                } catch (pullError) {
                    console.log('Ошибка при получении изменений с сервера:', pullError);
                }
                
                // push с retry
                console.log('Отправляю изменения в GitHub...');
                await withRetry(
                    async () => {
                await git.push();
                console.log('Изменения отправлены в GitHub');
                    },
                    this.retryConfig,
                    'отправка изменений в GitHub (pushRules)'
                );
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

    /**
     * Проверяет статус первой синхронизации и определяет стратегию
     */
    public async checkFirstSyncStatus(workspaceRoot: string): Promise<FirstSyncInfo> {
        const localRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);
        const hasLocalRules = fs.existsSync(localRulesPath) && 
            fs.readdirSync(localRulesPath, { withFileTypes: true }).length > 0;
        
        const localRulesCount = hasLocalRules ? 
            this.getFilesInDirectory(localRulesPath).length : 0;

        let hasRemoteRules = false;
        let remoteRulesCount = 0;
        let conflicts: string[] = [];

        try {
            const tempDir = this.getTempDir();
            const git = this.getSimpleGit();
            
            // Клонируем репозиторий с retry
            await withRetry(
                async () => {
                    await git.clone(this.config.rulesRepoUrl, tempDir);
                },
                this.retryConfig,
                'клонирование репозитория (checkFirstSyncStatus)'
            );
            
            const remoteRulesPath = path.join(tempDir, this.config.globalRulesPath);
            hasRemoteRules = fs.existsSync(remoteRulesPath) && 
                fs.readdirSync(remoteRulesPath, { withFileTypes: true }).length > 0;
            
            if (hasRemoteRules) {
                remoteRulesCount = this.getFilesInDirectory(remoteRulesPath).length;
                
                // Проверяем конфликты имен файлов
                if (hasLocalRules) {
                    const localFiles = this.getFilesInDirectory(localRulesPath);
                    const remoteFiles = this.getFilesInDirectory(remoteRulesPath);
                    
                    const localNames = localFiles.map(f => path.basename(f));
                    const remoteNames = remoteFiles.map(f => path.basename(f));
                    
                    conflicts = localNames.filter(name => remoteNames.includes(name));
                }
            }
            
            // Удаляем временную папку
            setTimeout(() => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (e) {
                    console.error('Ошибка удаления временной папки:', e);
                }
            }, 1000);
            
        } catch (error) {
            console.log('Не удалось проверить удаленный репозиторий:', error);
        }

        const isFirstSync = !hasLocalRules && !hasRemoteRules;

        return {
            isFirstSync,
            hasLocalRules,
            hasRemoteRules,
            localRulesCount,
            remoteRulesCount,
            conflicts
        };
    }

    /**
     * Создает резервную копию локальных правил
     */
    private async createLocalRulesBackup(workspaceRoot: string): Promise<string> {
        const localRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);
        const backupDir = path.join(workspaceRoot, '.cursor', 'rules-backup');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `backup-${timestamp}`);
        
        if (fs.existsSync(localRulesPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
            await this.copyDirectory(localRulesPath, backupPath);
            console.log(`Создана резервная копия локальных правил: ${backupPath}`);
        }
        
        return backupPath;
    }

    /**
     * Безопасная первая синхронизация с выбором стратегии
     */
    public async safeFirstSync(workspaceRoot: string, options: SafeSyncOptions): Promise<SyncStats> {
        const syncInfo = await this.checkFirstSyncStatus(workspaceRoot);
        
        console.log('Статус первой синхронизации:', syncInfo);
        
        // Создаем резервную копию если нужно
        if (options.createBackup && syncInfo.hasLocalRules) {
            await this.createLocalRulesBackup(workspaceRoot);
        }
        
        if (syncInfo.isFirstSync) {
            // Первая синхронизация - просто создаем структуру
            console.log('Первая синхронизация - создаю структуру папок');
            const localRulesPath = path.join(workspaceRoot, this.config.globalRulesPath);
            if (!fs.existsSync(localRulesPath)) {
                fs.mkdirSync(localRulesPath, { recursive: true });
            }
            return { added: 0, modified: 0, deleted: 0, total: 0 };
        }
        
        if (syncInfo.hasLocalRules && syncInfo.hasRemoteRules) {
            // Есть и локальные и удаленные правила - нужна стратегия слияния
            if (options.mergeStrategy === 'local-first') {
                console.log('Стратегия: локальные правила имеют приоритет');
                return await this.syncRules(workspaceRoot); // Отправляем локальные в репозиторий
            } else if (options.mergeStrategy === 'remote-first') {
                console.log('Стратегия: удаленные правила имеют приоритет');
                return await this.pullRules(workspaceRoot); // Загружаем удаленные
            } else {
                // manual - показываем пользователю конфликты
                throw new Error(`Обнаружены конфликты имен файлов: ${syncInfo.conflicts.join(', ')}. 
                
Выберите стратегию синхронизации:
1. "Локальные правила имеют приоритет" - ваши локальные правила перезапишут удаленные
2. "Удаленные правила имеют приоритет" - удаленные правила перезапишут ваши локальные
3. "Ручное разрешение" - разрешите конфликты вручную

Рекомендуется сначала создать резервную копию локальных правил.`);
            }
        }
        
        if (syncInfo.hasLocalRules && !syncInfo.hasRemoteRules) {
            // Только локальные правила - отправляем в репозиторий
            console.log('Отправляю локальные правила в репозиторий');
            return await this.syncRules(workspaceRoot);
        }
        
        if (!syncInfo.hasLocalRules && syncInfo.hasRemoteRules) {
            // Только удаленные правила - загружаем
            console.log('Загружаю правила из репозитория');
            return await this.pullRules(workspaceRoot);
        }
        
        return { added: 0, modified: 0, deleted: 0, total: 0 };
    }
} 