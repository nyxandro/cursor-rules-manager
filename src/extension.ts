import * as vscode from 'vscode';
import { RulesManager } from './rulesManager';
import { GitignoreManager } from './gitignoreManager';

let autoSyncTimer: NodeJS.Timeout | undefined;
let lastAutoSyncInterval: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Расширение "Cursor Rules Manager" активировано');
    outputChannel = vscode.window.createOutputChannel('Cursor Rules Manager');
    outputChannel.appendLine(`[${new Date().toLocaleString()}] Расширение "Cursor Rules Manager" активировано`);

    const rulesManager = new RulesManager();
    const gitignoreManager = new GitignoreManager();

    // Функция автосинхронизации
    async function autoSync() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {return;}
        outputChannel?.appendLine(`[${new Date().toLocaleString()}] Автосинхронизация правил...`);
        try {
            const stats = await rulesManager.syncRules(workspaceRoot);
            outputChannel?.appendLine(`[${new Date().toLocaleString()}] Автосинхронизация завершена успешно.`);
            
            // Проверяем настройку показа уведомлений
            const config = vscode.workspace.getConfiguration('cursorRulesManager');
            const showNotifications = config.get<boolean>('showAutoSyncNotifications', false);
            
            // Показываем уведомление только если включено в настройках и есть изменения
            if (showNotifications && stats.total > 0) {
                const parts = [];
                if (stats.added > 0) {parts.push(`+${stats.added} добавлено`);}
                if (stats.modified > 0) {parts.push(`${stats.modified} изменено`);}
                if (stats.deleted > 0) {parts.push(`-${stats.deleted} удалено`);}
                const message = `Автосинхронизация: ${parts.join(', ')}`;
                showNotificationWithTimeout(message, 'info');
            }
        } catch (error) {
            outputChannel?.appendLine(`[${new Date().toLocaleString()}] Ошибка автосинхронизации: ${error}`);
            
            // Показываем ошибку автосинхронизации только если включены уведомления
            const config = vscode.workspace.getConfiguration('cursorRulesManager');
            const showNotifications = config.get<boolean>('showAutoSyncNotifications', false);
            if (showNotifications) {
                showNotificationWithTimeout(`Ошибка автосинхронизации: ${error}`, 'error');
            }
        }
    }

    // Функция для показа уведомлений с таймаутом
    function showNotificationWithTimeout(message: string, type: 'info' | 'error' | 'warning') {
        const config = vscode.workspace.getConfiguration('cursorRulesManager');
        const timeout = config.get<number>('notificationTimeout', 3000);
        
        const notification = type === 'info' 
            ? vscode.window.showInformationMessage(message)
            : type === 'error' 
                ? vscode.window.showErrorMessage(message)
                : vscode.window.showWarningMessage(message);
        
        // Автоматически скрываем уведомление через заданное время
        setTimeout(() => {
            // VS Code не предоставляет прямой API для скрытия уведомлений,
            // но они автоматически исчезают через некоторое время
            // Этот таймаут просто логирует что время истекло
            console.log(`Уведомление "${message}" должно исчезнуть через ${timeout}ms`);
        }, timeout);
        
        return notification;
    }

    // Функция для установки/перезапуска таймера автосинхронизации (без немедленного запуска)
    function setupAutoSyncTimer() {
        const config = vscode.workspace.getConfiguration('cursorRulesManager');
        const intervalMin = config.get<number>('autoSyncInterval', 60);
        if (lastAutoSyncInterval === intervalMin && autoSyncTimer) {return;}
        if (autoSyncTimer) {clearInterval(autoSyncTimer);}
        lastAutoSyncInterval = intervalMin;
        autoSyncTimer = setInterval(autoSync, intervalMin * 60 * 1000);
        outputChannel?.appendLine(`Таймер автосинхронизации установлен на ${intervalMin} мин.`);
    }

    // Следим за изменением настроек
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('cursorRulesManager.autoSyncInterval')) {
            setupAutoSyncTimer();
        }
    }));

    // Устанавливаем таймер автосинхронизации (без немедленного запуска)
    setupAutoSyncTimer();

    // Универсальная функция для проверки и автосинхронизации
    async function syncIfRuleChanged(doc: vscode.TextDocument) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {return;}
        if (!doc.fileName.includes('.cursor/rules') || doc.isUntitled) {return;}
        // Получаем excludePatterns из настроек
        const config = vscode.workspace.getConfiguration('cursorRulesManager');
        const excludePatterns = config.get<string[]>('excludePatterns', ['my-project']);
        // Проверяем, что файл не исключён
        if (gitignoreManager.shouldExclude(doc.fileName, excludePatterns)) {return;}
        await autoSync();
    }

    // Автосинхронизация при сохранении файла правила
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(syncIfRuleChanged));

    // Команда синхронизации правил
    let syncRulesCommand = vscode.commands.registerCommand('cursor-rules-manager.syncRules', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            showNotificationWithTimeout('Начинаю синхронизацию правил...', 'info');
            const stats = await rulesManager.syncRules(workspaceRoot);
            
            let message = 'Синхронизация завершена! ';
            if (stats.total === 0) {
                message += 'Изменений нет';
            } else {
                const parts = [];
                if (stats.added > 0) {parts.push(`+${stats.added} добавлено`);}
                if (stats.modified > 0) {parts.push(`${stats.modified} изменено`);}
                if (stats.deleted > 0) {parts.push(`-${stats.deleted} удалено`);}
                message += parts.join(', ');
            }
            
            showNotificationWithTimeout(message, 'info');
        } catch (error) {
            showNotificationWithTimeout(`Ошибка синхронизации: ${error}`, 'error');
        }
    });

    // Команда загрузки правил из GitHub
    let pullRulesCommand = vscode.commands.registerCommand('cursor-rules-manager.pullRules', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            showNotificationWithTimeout('Загружаю правила из GitHub...', 'info');
            const stats = await rulesManager.pullRules(workspaceRoot);
            
            let message = 'Правила загружены успешно! ';
            if (stats.total === 0) {
                message += 'Изменений нет';
            } else {
                const parts = [];
                if (stats.added > 0) {parts.push(`+${stats.added} добавлено`);}
                if (stats.modified > 0) {parts.push(`${stats.modified} изменено`);}
                if (stats.deleted > 0) {parts.push(`-${stats.deleted} удалено`);}
                message += parts.join(', ');
            }
            
            showNotificationWithTimeout(message, 'info');
        } catch (error) {
            showNotificationWithTimeout(`Ошибка загрузки правил: ${error}`, 'error');
        }
    });

    // Команда отправки правил в GitHub
    let pushRulesCommand = vscode.commands.registerCommand('cursor-rules-manager.pushRules', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            showNotificationWithTimeout('Отправляю правила в GitHub...', 'info');
            const stats = await rulesManager.pushRules(workspaceRoot);
            
            let message = 'Правила отправлены! ';
            if (stats.total === 0) {
                message += 'Изменений нет';
            } else {
                const parts = [];
                if (stats.added > 0) {parts.push(`+${stats.added} добавлено`);}
                if (stats.modified > 0) {parts.push(`${stats.modified} изменено`);}
                if (stats.deleted > 0) {parts.push(`-${stats.deleted} удалено`);}
                message += parts.join(', ');
            }
            
            showNotificationWithTimeout(message, 'info');
        } catch (error) {
            showNotificationWithTimeout(`Ошибка отправки правил: ${error}`, 'error');
        }
    });

    // Команда показа статуса правил
    let showStatusCommand = vscode.commands.registerCommand('cursor-rules-manager.showStatus', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            const status = await rulesManager.getStatus(workspaceRoot);
            
            // Создаем новый документ для отображения статуса
            const document = await vscode.workspace.openTextDocument({
                content: status,
                language: 'markdown'
            });
            
            await vscode.window.showTextDocument(document);
        } catch (error) {
            showNotificationWithTimeout(`Ошибка получения статуса: ${error}`, 'error');
        }
    });

    // Команда проверки статуса первой синхронизации
    let checkFirstSyncCommand = vscode.commands.registerCommand('cursor-rules-manager.checkFirstSync', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            const syncInfo = await rulesManager.checkFirstSyncStatus(workspaceRoot);
            
            let message = 'Статус первой синхронизации:\n';
            message += `• Локальные правила: ${syncInfo.hasLocalRules ? `${syncInfo.localRulesCount} файлов` : 'нет'}\n`;
            message += `• Удаленные правила: ${syncInfo.hasRemoteRules ? `${syncInfo.remoteRulesCount} файлов` : 'нет'}\n`;
            
            if (syncInfo.conflicts.length > 0) {
                message += `• Конфликты имен: ${syncInfo.conflicts.join(', ')}\n`;
            }
            
            if (syncInfo.isFirstSync) {
                message += '\n✅ Это первая синхронизация - можно безопасно начинать';
            } else if (syncInfo.hasLocalRules && syncInfo.hasRemoteRules) {
                message += '\n⚠️ Обнаружены и локальные и удаленные правила - нужна стратегия слияния';
            } else if (syncInfo.hasLocalRules) {
                message += '\n📤 Только локальные правила - можно безопасно отправить в репозиторий';
            } else if (syncInfo.hasRemoteRules) {
                message += '\n📥 Только удаленные правила - можно безопасно загрузить';
            }
            
            // Создаем новый документ для отображения статуса
            const document = await vscode.workspace.openTextDocument({
                content: message,
                language: 'markdown'
            });
            
            await vscode.window.showTextDocument(document);
        } catch (error) {
            showNotificationWithTimeout(`Ошибка проверки статуса: ${error}`, 'error');
        }
    });

    // Команда безопасной первой синхронизации
    let safeFirstSyncCommand = vscode.commands.registerCommand('cursor-rules-manager.safeFirstSync', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            showNotificationWithTimeout('Не открыт рабочий проект', 'error');
            return;
        }

        try {
            const syncInfo = await rulesManager.checkFirstSyncStatus(workspaceRoot);
            
            if (syncInfo.isFirstSync) {
                // Простая первая синхронизация
                const stats = await rulesManager.safeFirstSync(workspaceRoot, {
                    backupLocalRules: false,
                    mergeStrategy: 'local-first',
                    createBackup: false
                });
                showNotificationWithTimeout('Первая синхронизация завершена успешно!', 'info');
                return;
            }
            
            if (syncInfo.hasLocalRules && syncInfo.hasRemoteRules && syncInfo.conflicts.length > 0) {
                // Есть конфликты - предлагаем выбор стратегии
                const strategy = await vscode.window.showQuickPick([
                    'Локальные правила имеют приоритет (ваши правила перезапишут удаленные)',
                    'Удаленные правила имеют приоритет (удаленные правила перезапишут ваши)',
                    'Создать резервную копию и использовать локальные правила',
                    'Отмена'
                ], {
                    placeHolder: 'Выберите стратегию синхронизации'
                });
                
                if (!strategy || strategy === 'Отмена') {
                    return;
                }
                
                const createBackup = strategy.includes('резервную копию');
                const mergeStrategy = strategy.includes('локальные правила') ? 'local-first' : 'remote-first';
                
                if (createBackup) {
                    showNotificationWithTimeout('Создаю резервную копию...', 'info');
                }
                
                const stats = await rulesManager.safeFirstSync(workspaceRoot, {
                    backupLocalRules: false,
                    mergeStrategy,
                    createBackup
                });
                
                let message = 'Безопасная синхронизация завершена! ';
                if (stats.total === 0) {
                    message += 'Изменений нет';
                } else {
                    const parts = [];
                    if (stats.added > 0) {parts.push(`+${stats.added} добавлено`);}
                    if (stats.modified > 0) {parts.push(`${stats.modified} изменено`);}
                    if (stats.deleted > 0) {parts.push(`-${stats.deleted} удалено`);}
                    message += parts.join(', ');
                }
                
                showNotificationWithTimeout(message, 'info');
            } else {
                // Нет конфликтов - выполняем обычную синхронизацию
                const stats = await rulesManager.safeFirstSync(workspaceRoot, {
                    backupLocalRules: false,
                    mergeStrategy: 'local-first',
                    createBackup: false
                });
                
                showNotificationWithTimeout('Безопасная синхронизация завершена успешно!', 'info');
            }
        } catch (error) {
            showNotificationWithTimeout(`Ошибка безопасной синхронизации: ${error}`, 'error');
        }
    });

    // Регистрируем команды
    context.subscriptions.push(syncRulesCommand);
    context.subscriptions.push(pullRulesCommand);
    context.subscriptions.push(pushRulesCommand);
    context.subscriptions.push(showStatusCommand);
    context.subscriptions.push(checkFirstSyncCommand);
    context.subscriptions.push(safeFirstSyncCommand);

    // Показываем уведомление о доступных командах
    showNotificationWithTimeout(
        'Cursor Rules Manager активирован! Автосинхронизация настроена. Используйте команды в палитре команд (Ctrl+Shift+P):\n' +
        '- "Синхронизировать правила Cursor"\n' +
        '- "Загрузить правила из GitHub"\n' +
        '- "Отправить правила в GitHub"\n' +
        '- "Показать статус правил"',
        'info'
    );
}

export function deactivate() {
    console.log('Расширение "Cursor Rules Manager" деактивировано');
    if (autoSyncTimer) {clearInterval(autoSyncTimer);}
    outputChannel?.dispose();
} 