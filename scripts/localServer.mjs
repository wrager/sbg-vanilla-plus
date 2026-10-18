import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const HOST = '127.0.0.1';
const PORT = 5175;
const FILES = new Map([
  ['/release.user.js', 'dist/release/sbg-vanilla-plus.user.js'],
  ['/debug.user.js', 'dist/debug/sbg-vanilla-plus.user.js'],
  ['/local.user.js', 'dist/debug/sbg-vanilla-plus.local.user.js'],
]);

const PAGE = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Локальные сборки SBG Vanilla+</title>
<style>
body { font: 18px/1.6 system-ui, sans-serif; max-width: 800px; margin: 48px auto; padding: 0 24px; }
code { font-size: .9em; }
</style>
<h1>Локальные сборки SBG Vanilla+</h1>
<p>Откройте ссылку в Chrome с Tampermonkey и проверьте содержимое перед установкой.
Если сборка ещё не создана, сервер покажет нужную команду.</p>
<ul>
<li><a href="/release.user.js">Релизная сборка</a> — <code>npm run build</code></li>
<li><a href="/debug.user.js">Отладочная сборка [DEBUG]</a> — <code>npm run build:debug</code></li>
<li><a href="/local.user.js">Локальный загрузчик [LOCAL]</a> — <code>npm run dev:watch</code></li>
<li><a href="http://127.0.0.1:5174/">Vite dev-сервер [DEV]</a> — <code>npm run dev</code></li>
</ul>
<p>Для [LOCAL] разрешите Tampermonkey доступ к URL файлов. Загрузчик устанавливается один раз
и читает свежую отладочную сборку с диска при следующей загрузке страницы.</p>
<p>Включайте только один вариант SVP. Перезагрузку и действия в игре выполняет пользователь.
Этот сервер не открывает и не обновляет игру.</p>
</html>`;

/** Only explicitly listed build outputs are served; source files and browser data stay private. */
export function createLocalServer(root = ROOT) {
  return createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const route = request.url;
    if (route === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end(request.method === 'HEAD' ? undefined : PAGE);
      return;
    }
    const file = FILES.get(route);
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    void readFile(resolve(root, file)).then(
      (content) => {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end(request.method === 'HEAD' ? undefined : content);
      },
      (error) => {
        const missing = error.code === 'ENOENT';
        response.writeHead(missing ? 404 : 500, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        const command = route === '/release.user.js' ? 'npm run build' : 'npm run build:debug';
        response.end(
          request.method === 'HEAD'
            ? undefined
            : missing
              ? `Сборка отсутствует. Выполните ${command} и повторите установку.`
              : 'Не удалось прочитать сборку. Проверьте права доступа к dist/.',
        );
      },
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createLocalServer();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `[SVP] Порт ${PORT} занят. Используйте уже запущенный local:serve или остановите его.`
        : `[SVP] ${error.message}`,
    );
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`[SVP] Установка локальных сборок: http://${HOST}:${PORT}/`);
    console.log('[SVP] Остановка: Ctrl+C. Сервер не управляет вкладкой игры.');
  });
}
