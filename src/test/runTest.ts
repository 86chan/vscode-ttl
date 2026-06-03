/**
 * Integration テストランナー
 *
 * @remarks
 * このスクリプトは VS Code プロセスを起動し、拡張機能をロードした状態で
 * Mocha テストスイートを実行する。
 *
 * WSL/ヘッドレス環境では `DISPLAY` が未設定のため起動できないが、
 * CI (GitHub Actions + xvfb-run 等) や Windows/macOS では動作する。
 *
 * 実行: npm run test:integration
 */

import { runTests } from '@vscode/test-electron';
import * as path from 'path';

async function main(): Promise<void> {
  // 拡張機能のルートディレクトリ（package.json が存在する場所）
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');

  // コンパイル済みテストスイートのエントリポイント
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  // fixtures は src/test/fixtures/ に存在する（コンパイル対象外）
  const fixturesPath = path.resolve(extensionDevelopmentPath, 'src/test/fixtures');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [fixturesPath],
  });
}

main().catch(error => {
  console.error('Failed to run integration tests:', error);
  process.exit(1);
});
