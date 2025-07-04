import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/naming-convention
const Mocha = require('mocha');
const glob = require('glob');

export function run(): Promise<void> {
  // Создаем экземпляр Mocha
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname, '..');

  // Используем синхронный glob
  const files: string[] = glob.globSync('**/**.test.js', { cwd: testsRoot });
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} тестов не прошли.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
} 