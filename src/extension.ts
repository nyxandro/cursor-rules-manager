import * as vscode from 'vscode';
import { RulesManager } from './rulesManager';

let autoSyncTimer: NodeJS.Timeout | undefined;
let lastAutoSyncInterval: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Расширение "Cursor Rules Manager" активировано');

    const rulesManager = new RulesManager();
    outputChannel = vscode.window.createOutputChannel('Cursor Rules Manager');

    // Функция автосинхронизации
    async function autoSync() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;
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
                if (stats.added > 0) parts.push(`+${stats.added} добавлено`);
                if (stats.modified > 0) parts.push(`${stats.modified} изменено`);
                if (stats.deleted > 0) parts.push(`-${stats.deleted} удалено`);
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

    // Функция для запуска/перезапуска таймера автосинхронизации
    function setupAutoSyncTimer() {
        const config = vscode.workspace.getConfiguration('cursorRulesManager');
        const intervalMin = config.get<number>('autoSyncInterval', 60);
        if (lastAutoSyncInterval === intervalMin && autoSyncTimer) return;
        if (autoSyncTimer) clearInterval(autoSyncTimer);
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

    // Запускаем автосинхронизацию при активации
    setupAutoSyncTimer();

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
                if (stats.added > 0) parts.push(`+${stats.added} добавлено`);
                if (stats.modified > 0) parts.push(`${stats.modified} изменено`);
                if (stats.deleted > 0) parts.push(`-${stats.deleted} удалено`);
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
            await rulesManager.pullRules(workspaceRoot);
            showNotificationWithTimeout('Правила загружены успешно!', 'info');
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
                if (stats.added > 0) parts.push(`+${stats.added} добавлено`);
                if (stats.modified > 0) parts.push(`${stats.modified} изменено`);
                if (stats.deleted > 0) parts.push(`-${stats.deleted} удалено`);
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

    // Регистрируем команды
    context.subscriptions.push(syncRulesCommand);
    context.subscriptions.push(pullRulesCommand);
    context.subscriptions.push(pushRulesCommand);
    context.subscriptions.push(showStatusCommand);

    // Показываем уведомление о доступных командах
    showNotificationWithTimeout(
        'Cursor Rules Manager активирован! Используйте команды в палитре команд (Ctrl+Shift+P):\n' +
        '- "Синхронизировать правила Cursor"\n' +
        '- "Загрузить правила из GitHub"\n' +
        '- "Отправить правила в GitHub"\n' +
        '- "Показать статус правил"',
        'info'
    );
}

export function deactivate() {
    console.log('Расширение "Cursor Rules Manager" деактивировано');
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    outputChannel?.dispose();
} 