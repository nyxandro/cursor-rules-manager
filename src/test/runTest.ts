import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // Путь к папке с тестами
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    
    // Запускаем тесты
    await runTests({ 
      extensionDevelopmentPath, 
      extensionTestsPath,
      launchArgs: ['--disable-extensions']
    });
  } catch (err) {
    console.error('Ошибка запуска тестов:', err);
    process.exit(1);
  }
}

main(); 