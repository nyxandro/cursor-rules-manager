import * as fs from 'fs';
import * as path from 'path';

export class GitignoreManager {
    
    /**
     * Проверяет и создает/обновляет .gitignore файл для исключения правил
     * @param workspaceRoot Корневая папка проекта
     * @param excludePatterns Массив папок, которые НЕ должны исключаться из .gitignore
     */
    public async ensureGitignore(workspaceRoot: string, excludePatterns: string[]): Promise<void> {
        const gitignorePath = path.join(workspaceRoot, '.gitignore');
        let content = '';
        
        // Читаем существующий .gitignore если он есть
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf8');
        }
        
        // Проверяем есть ли уже правила для .cursor/rules
        const hasCursorRulesSection = content.includes('.cursor/rules');
        
        if (!hasCursorRulesSection) {
            // Добавляем секцию для правил Cursor
            const cursorRulesSection = this.generateCursorRulesSection(excludePatterns);
            
            // Добавляем в конец файла с разделителем
            if (content && !content.endsWith('\n')) {
                content += '\n';
            }
            content += '\n# Cursor Rules\n' + cursorRulesSection;
        } else {
            // Обновляем существующую секцию
            content = this.updateCursorRulesSection(content, excludePatterns);
        }
        
        // Записываем обновленный .gitignore
        fs.writeFileSync(gitignorePath, content, 'utf8');
    }
    
    /**
     * Генерирует секцию .gitignore для правил Cursor
     */
    private generateCursorRulesSection(excludePatterns: string[]): string {
        let section = '# Исключаем все правила Cursor из основного репозитория\n';
        section += '.cursor/rules/*\n';
        
        if (excludePatterns.length > 0) {
            section += '\n# Разрешаем синхронизацию указанных папок с основным проектом\n';
            // Собираем уникальные разрешающие правила
            const allowRules = new Set<string>();
            excludePatterns.forEach(pattern => {
                allowRules.add(`!.cursor/rules/${pattern}/`);
                allowRules.add(`!.cursor/rules/${pattern}/**`);
            });
            section += Array.from(allowRules).join('\n') + '\n';
        }
        
        return section.trimEnd();
    }
    
    /**
     * Обновляет существующую секцию .cursor/rules в .gitignore
     */
    private updateCursorRulesSection(content: string, excludePatterns: string[]): string {
        const lines = content.split('\n');
        const newLines: string[] = [];
        let cursorSectionStart = -1;
        let cursorSectionEnd = -1;
        let inCursorSection = false;

        // Находим границы секции .cursor/rules (начинается с комментария или первой строки с .cursor/rules)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!inCursorSection && (line.includes('# Cursor Rules') || (line.includes('.cursor/rules') && !line.startsWith('!')))) {
                inCursorSection = true;
                cursorSectionStart = i;
            }
            if (inCursorSection && i > cursorSectionStart && (line.trim() === '' || (!line.includes('.cursor/rules') && !line.startsWith('!') && !line.includes('Разрешаем синхронизацию') && !line.includes('Исключаем все правила')))) {
                cursorSectionEnd = i;
                break;
            }
        }
        if (inCursorSection && cursorSectionEnd === -1) {
            cursorSectionEnd = lines.length;
        }
        
        // Копируем строки до секции .cursor/rules
        for (let i = 0; i < (cursorSectionStart === -1 ? lines.length : cursorSectionStart); i++) {
            newLines.push(lines[i]);
        }
        
        // Добавляем обновленную секцию с сохранением пустых строк
        if (cursorSectionStart !== -1) {
            // Всегда добавляем заголовок секции
            newLines.push('# Cursor Rules');
            const updatedSection = this.generateCursorRulesSection(excludePatterns).split('\n');
            updatedSection.forEach(line => {
                newLines.push(line);
            });
        }
        
        // Копируем строки после секции .cursor/rules
        for (let i = (cursorSectionEnd === -1 ? lines.length : cursorSectionEnd); i < lines.length; i++) {
            // Пропускаем дублирующиеся разрешающие правила
            if (lines[i].startsWith('!.cursor/rules/')) continue;
            if (lines[i].includes('.cursor/rules') && !lines[i].startsWith('!')) continue;
            if (lines[i].includes('# Cursor Rules')) continue;
            if (lines[i].includes('Разрешаем синхронизацию')) continue;
            if (lines[i].includes('Исключаем все правила')) continue;
            newLines.push(lines[i]);
        }
        
        // Удаляем дубликаты, но сохраняем пустые строки
        const result: string[] = [];
        const seen = new Set<string>();
        
        for (const line of newLines) {
            if (line.trim() === '') {
                // Для пустых строк проверяем только что предыдущая строка не была пустой
                if (result.length === 0 || result[result.length - 1].trim() !== '') {
                    result.push(line);
                }
            } else {
                // Для непустых строк проверяем что такой строки еще не было
                if (!seen.has(line)) {
                    seen.add(line);
                    result.push(line);
                }
            }
        }
        
        return result.join('\n');
    }
    
    /**
     * Проверяет должен ли файл быть исключен из синхронизации
     * @param filePath Путь к файлу относительно корня проекта
     * @param excludePatterns Массив папок, которые НЕ должны исключаться
     * @returns true если файл должен быть исключен
     */
    public shouldExclude(filePath: string, excludePatterns: string[]): boolean {
        // Проверяем что файл находится в .cursor/rules
        if (!filePath.includes('.cursor/rules')) {
            return false;
        }
        
        // Извлекаем относительный путь от .cursor/rules
        const rulesIndex = filePath.indexOf('.cursor/rules');
        const relativePath = filePath.substring(rulesIndex + '.cursor/rules'.length + 1); // +1 для слеша
        
        // Разбиваем путь на части
        const pathParts = relativePath.split(path.sep);
        
        // Проверяем первую папку (корневую папку в .cursor/rules)
        if (pathParts.length > 0) {
            const rootFolder = pathParts[0];
            
            // Если это файл в корне .cursor/rules (например, .cursor/rules/global-rule.md)
            if (pathParts.length === 1 && rootFolder.includes('.')) {
                // Это файл, проверяем его имя без расширения
                const fileName = rootFolder.split('.')[0];
                return excludePatterns.includes(fileName);
            }
            
            // Если это папка, проверяем её имя
            return excludePatterns.includes(rootFolder);
        }
        
        return false;
    }
    
    /**
     * Проверяет должен ли файл быть исключен из синхронизации (для репозитория правил)
     * @param filePath Путь к файлу относительно корня проекта
     * @param excludePatterns Массив папок, которые НЕ должны исключаться
     * @returns true если файл должен быть исключен из репозитория правил
     */
    public shouldExcludeFromRulesRepo(filePath: string, excludePatterns: string[]): boolean {
        // В репозитории правил исключаем только папки из excludePatterns
        return this.shouldExclude(filePath, excludePatterns);
    }
    
    /**
     * Проверяет должен ли файл быть исключен из синхронизации (для основного проекта)
     * @param filePath Путь к файлу относительно корня проекта
     * @param excludePatterns Массив папок, которые НЕ должны исключаться
     * @returns true если файл должен быть исключен из основного проекта
     */
    public shouldExcludeFromMainProject(filePath: string, excludePatterns: string[]): boolean {
        // В основном проекте исключаем все .cursor/rules кроме папок из excludePatterns
        if (!filePath.includes('.cursor/rules')) {
            return false;
        }
        
        // Извлекаем относительный путь от .cursor/rules
        const rulesIndex = filePath.indexOf('.cursor/rules');
        const relativePath = filePath.substring(rulesIndex + '.cursor/rules'.length + 1);
        
        // Разбиваем путь на части
        const pathParts = relativePath.split(path.sep);
        
        // Проверяем первую папку
        if (pathParts.length > 0) {
            const rootFolder = pathParts[0];
            
            // Если это файл в корне .cursor/rules
            if (pathParts.length === 1 && rootFolder.includes('.')) {
                const fileName = rootFolder.split('.')[0];
                return !excludePatterns.includes(fileName);
            }
            
            // Если это папка, исключаем все кроме папок из excludePatterns
            return !excludePatterns.includes(rootFolder);
        }
        
        return true; // Исключаем по умолчанию
    }
} 