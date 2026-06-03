/**
 * Mocha テストスイートのエントリポイント
 *
 * @remarks
 * VS Code 拡張機能の統合テストでは、このモジュールが `run()` を export する規約になっている。
 * @vscode/test-electron がこの関数を呼び出してテストを実行する。
 */

import * as path from 'path';
import * as fs from 'node:fs';
import Mocha from 'mocha';

/**
 * テストスイートの実行
 *
 * @returns テスト完了を表すPromise（失敗件数 > 0 の場合は reject）
 */
export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    // 拡張機能のアクティベーションを待つため余裕を持たせる
    timeout: 15_000,
  });

  const suiteDir = path.resolve(__dirname, '.');

  // コンパイル済み *.test.js を再帰的に収集
  const testFiles = fs
    .readdirSync(suiteDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.resolve(suiteDir, file));

  for (const file of testFiles) {
    mocha.addFile(file);
  }

  return new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
