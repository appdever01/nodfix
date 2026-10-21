import { z } from 'zod';

export interface Declaration {
  file: string;
  kind: 'nvm' | 'fnm' | 'engines' | 'volta' | 'docker';
  value: string;
  line: number;
  pointer: 'engines' | 'volta' | null;
  image: string | null;
}
const packageSchema = z.object({
  engines: z.object({ node: z.string().optional() }).optional(),
  volta: z.object({ node: z.string().optional() }).optional(),
});
export function parseDeclarations(file: string, content: string): Declaration[] {
  const name = file.replaceAll('\\', '/').split('/').at(-1)!;
  const make = (kind: Declaration['kind'], value: string, line = 1, pointer: Declaration['pointer'] = null, image: string | null = null): Declaration => ({ file, kind, value, line, pointer, image });
  if (name === '.nvmrc' || name === '.node-version') {
    return [make(name === '.nvmrc' ? 'nvm' : 'fnm', content.trim())];
  }
  if (name === 'package.json') {
    const pkg = packageSchema.parse(JSON.parse(content));
    const result: Declaration[] = [];
    for (const key of ['engines', 'volta'] as const) {
      const value = pkg[key]?.node;
      if (value !== undefined) {
        const match = content.match(new RegExp(`"${key}"\\s*:\\s*\\{[\\s\\S]*?"node"\\s*:`));
        const index = match ? content.indexOf(match[0]) + match[0].length : 0;
        result.push(make(key, value, content.slice(0, index).split('\n').length, key));
      }
    }
    return result;
  }
  const declarations: Declaration[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const from = line.match(/^\s*FROM\s+(?:--[\w-]+=\S+\s+)*(\S+)/i);
    if (!from) continue;
    const image = from[1]!;
    if (image.includes('$')) {
      declarations.push(make('docker', image, index + 1, null, image));
      continue;
    }
    const node = image.match(/^(?:(?:docker\.io|index\.docker\.io)\/)?(?:library\/)?node(?::([^@]+))?(?:@sha256:[a-f0-9]+)?$/i);
    if (!node) continue;
    const tag = node[1] ?? 'latest';
    const version = tag.match(/^v?(\d+(?:\.\d+){0,2})(?:-(?:alpine|slim|bookworm|bullseye|trixie|buster)[\w.-]*)?$/)?.[1] ?? tag;
    declarations.push(make('docker', version, index + 1, null, image));
  }
  return declarations;
}
