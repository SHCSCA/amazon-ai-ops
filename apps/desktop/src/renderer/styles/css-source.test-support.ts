import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

type CssNode = {
  type: string;
  name?: string;
  params?: string;
  nodes?: CssNode[];
  toString(): string;
  replaceWith(nodes: CssNode[]): void;
};
type CssRoot = CssNode & { nodes: CssNode[]; walkAtRules(name: string, visit: (node: CssNode) => void): void };
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite/package.json'))('postcss') as {
  parse(source: string, options: { from: string }): CssRoot;
};

export function readStyleComposition(input: URL | string, ancestry: readonly string[] = []): string {
  const file = path.resolve(input instanceof URL ? fileURLToPath(input) : input);
  if (ancestry.includes(file)) throw new Error('样式导入存在循环：' + file);
  const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
  let bodyStarted = false;
  for (const node of [...root.nodes]) {
    if (node.type === 'comment' || node.type === 'atrule' && node.name === 'charset') continue;
    if (node.type !== 'atrule' || node.name !== 'import') { bodyStarted = true; continue; }
    if (bodyStarted) throw new Error('样式导入必须位于正文之前：' + file);
    const match = /^(["'])(\.\.?\/[^"']+\.css)\1$/.exec(node.params || '')
      || /^url\(\s*(["'])(\.\.?\/[^"']+\.css)\1\s*\)$/.exec(node.params || '');
    if (!match) throw new Error('样式合同仅解析本地无条件 CSS 导入：' + file);
    const target = path.resolve(path.dirname(file), match[2]);
    const imported = postcss.parse(readStyleComposition(target, [...ancestry, file]), { from: target });
    node.replaceWith(imported.nodes);
  }
  root.walkAtRules('import', () => { throw new Error('样式导入不能嵌套于规则内：' + file); });
  return root.toString();
}
