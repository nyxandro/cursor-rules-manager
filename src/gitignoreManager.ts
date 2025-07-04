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
            excludePatterns.forEach(pattern => {
                section += `!.cursor/rules/${pattern}/\n`;
                section += `!.cursor/rules/${pattern}/**\n`;
            });
        }
        
        return section;
    }
    
    /**
     * Обновляет существующую секцию .cursor/rules в .gitignore
     */
    private updateCursorRulesSection(content: string, excludePatterns: string[]): string {
        const lines = content.split('\n');
        const newLines: string[] = [];
        let inCursorSection = false;
        let cursorSectionStart = -1;
        let cursorSectionEnd = -1;
        
        // Находим границы секции .cursor/rules
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('.cursor/rules') && !line.startsWith('!')) {
                inCursorSection = true;
                cursorSectionStart = i;
            }
            
            if (inCursorSection && !line.includes('.cursor/rules') && !line.startsWith('!') && line.trim() !== '') {
                cursorSectionEnd = i;
                break;
            }
        }
        
        if (cursorSectionEnd === -1) {
            cursorSectionEnd = lines.length;
        }
        
        // Копируем строки до секции .cursor/rules
        for (let i = 0; i < cursorSectionStart; i++) {
            newLines.push(lines[i]);
        }
        
        // Добавляем обновленную секцию
        newLines.push(...this.generateCursorRulesSection(excludePatterns).split('\n'));
        
        // Копируем строки после секции .cursor/rules
        for (let i = cursorSectionEnd; i < lines.length; i++) {
            newLines.push(lines[i]);
        }
        
        return newLines.join('\n');
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