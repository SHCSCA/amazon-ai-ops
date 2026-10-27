// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { http } from './workspace-ui-test-environment.mjs';
function validPageMarkup(extra = '') {
    return `
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { font: 14px/21px Arial, sans-serif; }
      .app-shell { width: 100vw; height: 100vh; overflow: hidden; }
      .app-content { height: 100%; overflow-y: auto; overflow-x: hidden; }
      .workspace { min-height: 900px; padding: 16px; }
      .virtual-table { height: 80px; overflow-y: auto; }
      .virtual-table-inner { height: 180px; }
    </style>
    <div class="app-shell">
      <main class="app-content">
        <section class="workspace" data-workspace="today" data-workspace-subview="overview" data-workspace-evidence-root>
          <h1>今日任务</h1>
          <button data-action-priority="primary">处理当前阻塞</button>
          <button data-action-priority="secondary">查看详情</button>
          <button data-action-priority="secondary">切换产品</button>
          <p>当前对象：B0TESTASIN</p>
          <div class="virtual-table" data-scroll-owner="virtual-table">
            <div class="virtual-table-inner">显式虚拟表格滚动例外</div>
          </div>
          ${extra}
        </section>
      </main>
    </div>
  `;
}

function validExperiencePageMarkup(extra = '', advanceVirtualWindow = true) {
    const rows = Array.from({ length: 8 }, (_, index) => `
    <div data-row-index="${index}" data-row-key="row-${index}" data-workspace-row>对象 ${index + 1}</div>
  `).join('');
    const virtualWindowScript = advanceVirtualWindow ? `
    <script>
      document.querySelector('[data-scroll-owner="virtual-table"]').addEventListener('scroll', () => {
        document.querySelectorAll('[data-workspace-row]').forEach((row, index) => {
          row.setAttribute('data-row-index', String(index + 56));
          row.setAttribute('data-row-key', 'row-' + String(index + 56));
        });
      }, { once: true });
    </script>
  ` : '';
    return `
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { font: 14px/21px Arial, sans-serif; }
      .app-shell { width: 100vw; height: 100vh; overflow: hidden; }
      .app-content { width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; }
      .workspace { height: 100%; padding: 16px; }
      .work-surface { height: 430px; margin-top: 12px; }
      .queue-region { height: 400px; }
      .queue-scroll { height: 380px; overflow-y: auto; border: 1px solid #ddd; }
      .queue-table { position: relative; min-height: 1800px; }
      .queue-header { position: sticky; z-index: 2; top: 0; height: 36px; background: white; }
      [data-workspace-row] { height: 50px; padding: 8px; }
    </style>
    <div class="app-shell">
      <main class="app-content">
        <section class="workspace" data-workspace="product" data-workspace-subview="products" data-workspace-evidence-root>
          <h1>产品</h1>
          <button data-action-priority="primary">处理当前产品</button>
          <div class="work-surface" data-workspace-work-surface>
            <div class="queue-region" data-workspace-queue-scroll>
              <div class="queue-scroll" data-scroll-owner="virtual-table">
                <div class="queue-table" role="table" aria-rowcount="120">
                  <div class="queue-header" data-workspace-queue-header>对象队列表头</div>
                  ${rows}
                </div>
              </div>
            </div>
          </div>
          ${virtualWindowScript}
          ${extra}
        </section>
      </main>
    </div>
  `;
}

function invalidExperiencePageMarkup() {
    const rows = Array.from({ length: 31 }, (_, index) => `
    <div data-row-index="${index}" data-row-key="duplicate-key" data-workspace-row>对象 ${index + 1}</div>
  `).join('');
    return `
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { font: 14px/21px Arial, sans-serif; }
      .app-shell { width: 100vw; height: 100vh; overflow: hidden; }
      .app-content { width: 100%; height: 400px; overflow-y: auto; overflow-x: hidden; }
      .workspace { min-height: 1200px; padding: 16px; }
      .work-surface { height: 500px; margin-top: 330px; }
      .queue-scroll { height: 120px; overflow-y: hidden; border: 1px solid #ddd; }
      .queue-table { min-height: 1800px; }
      .queue-header { position: static; height: 36px; background: white; }
      [data-workspace-row] { height: 50px; padding: 8px; }
    </style>
    <div class="app-shell">
      <main class="app-content">
        <section class="workspace" data-workspace="product" data-workspace-subview="products" data-workspace-evidence-root>
          <h1>产品</h1>
          <button data-action-priority="primary">处理当前产品</button>
          <div class="work-surface" data-workspace-work-surface>
            <div data-workspace-queue-scroll>
              <div class="queue-scroll" data-scroll-owner="virtual-table" onscroll="document.querySelector('.app-content').scrollTop = 80">
                <div class="queue-table" role="table" aria-rowcount="20">
                  <div class="queue-header" data-workspace-queue-header>对象队列表头</div>
                  ${rows}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

async function serveHtml(html) {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
        url: `http://127.0.0.1:${address.port}/index.html`,
    };
}

async function loadMarkupAtUrl(page, html, url = 'http://workspace-evidence.test/?preview=1&scenario=diagnosis-ready') {
    await page.route('http://workspace-evidence.test/**', async (route) => {
        await route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
    });
    await page.goto(url);
}
export { validPageMarkup, validExperiencePageMarkup, invalidExperiencePageMarkup, serveHtml, loadMarkupAtUrl };
