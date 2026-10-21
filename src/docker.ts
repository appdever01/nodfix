interface Part { text: string; line: number }
export interface DockerBase { image: string; line: number; column: number | null }
function heredocs(text: string): { name: string; tabs: boolean }[] {
  const result: { name: string; tabs: boolean }[] = [];
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (quote === "'") { if (character === quote) quote = ''; continue; }
    if (character === '\\') { i++; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character !== '<' || text[i + 1] !== '<') continue;
    const match = text.slice(i).match(/^<<(-?)(?:["']([\w.-]+)["']|([\w.-]+))/);
    if (match) {
      result.push({ name: match[2] ?? match[3]!, tabs: match[1] === '-' });
      i += match[0].length - 1;
    }
  }
  return result;
}
export function dockerBases(content: string): DockerBase[] {
  const lines = content.split(/\r?\n/);
  const result: DockerBase[] = [];
  let escape = '\\';
  let directives = true;
  let parts: Part[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (directives) {
      const directive = line.match(/^\s*#\s*(syntax|escape|check)\s*=\s*(.*?)\s*$/i);
      if (directive) {
        if (directive[1]!.toLowerCase() === 'escape' && ['\\', '`'].includes(directive[2]!)) escape = directive[2]!;
        continue;
      }
      directives = false;
    }
    if (/^\s*(?:#|$)/.test(line)) continue;
    const trimmed = line.trimEnd();
    let count = 0;
    for (let pos = trimmed.length - 1; pos >= 0 && trimmed[pos] === escape; pos--) count++;
    const continued = count % 2 === 1;
    parts.push({ text: continued ? trimmed.slice(0, -1) : line, line: index + 1 });
    if (continued) continue;
    const statement = parts.map((part) => part.text).join('');
    const from = statement.match(/^\s*FROM\s+(?:--[\w-]+=\S+\s+)*(\S+)/i);
    if (from) {
      const image = from[1]!;
      const start = from[0].length - image.length;
      let offset = 0;
      let base: DockerBase = { image, line: parts[0]!.line, column: null };
      for (const part of parts) {
        if (start >= offset && start + image.length <= offset + part.text.length) {
          base = { image, line: part.line, column: start - offset };
          break;
        }
        offset += part.text.length;
      }
      result.push(base);
    }
    if (/^\s*(?:RUN|COPY|ADD)\s/i.test(statement)) {
      for (const delimiter of heredocs(statement)) {
        while (++index < lines.length) {
          const candidate = delimiter.tabs ? lines[index]!.replace(/^\t+/, '') : lines[index]!;
          if (candidate === delimiter.name) break;
        }
      }
    }
    parts = [];
  }
  return result;
}
