import { z } from 'zod';
import { dockerBases } from './docker.js';

export interface Declaration {
  file: string;
  kind: 'nvm' | 'fnm' | 'engines' | 'volta' | 'docker';
  value: string;
  line: number;
  pointer: 'engines' | 'volta' | null;
  image: string | null;
  imageColumn: number | null;
}
const packageSchema = z.object({
  engines: z.object({ node: z.string().optional() }).optional(),
  volta: z.object({ node: z.string().optional() }).optional(),
});
export function parseDeclarations(file: string, content: string): Declaration[] {
  const name = file.replaceAll('\\', '/').split('/').at(-1)!.toLowerCase();
  const make = (kind: Declaration['kind'], value: string, line = 1, pointer: Declaration['pointer'] = null, image: string | null = null, imageColumn: number | null = null): Declaration => {
    if (value.length > 512 || (image?.length ?? 0) > 512) throw new Error('Version declaration exceeds size limit');
    return { file, kind, value, line, pointer, image, imageColumn };
  };
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
  for (const { image, line, column } of dockerBases(content)) {
    if (image.includes('$')) {
      declarations.push(make('docker', image, line, null, image, column));
      continue;
    }
    const node = image.match(/^(?:(?:docker\.io|index\.docker\.io)\/)?(?:library\/)?node(?::([^@]+))?(?:@sha256:[a-f0-9]+)?$/i);
    if (!node) continue;
    const tag = node[1] ?? 'latest';
    const version = tag.match(/^v?(\d+(?:\.\d+){0,2})(?:-(?:alpine|slim|bookworm|bullseye|trixie|buster)[\w.-]*)?$/)?.[1] ?? tag;
    declarations.push(make('docker', version, line, null, image, column));
  }
  return declarations;
}
