// Copy the official coss registry sources using its documented manual installation.
import { mkdir, writeFile } from 'node:fs/promises';
const components = ['popover','button','badge','menu','dialog','alert-dialog','tabs','slider','select','switch','input','textarea','separator','field','card','empty','tooltip','kbd','progress','toggle-group','alert'];
const seen = new Set(), dependencies = new Set(['clsx','tailwind-merge','class-variance-authority','@base-ui/react','lucide-react']);
async function install(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const response = await fetch(`https://coss.com/ui/r/${name}.json`);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const item = await response.json();
  for (const dep of item.dependencies || []) dependencies.add(dep);
  for (const dep of item.registryDependencies || []) if (dep.startsWith('@coss/')) await install(dep.slice(6));
  for (const file of item.files || []) {
    if (!file.path.endsWith('.tsx') && !file.path.endsWith('.ts')) continue;
    const target = file.path.replace('registry/default/ui/', 'src/components/ui/').replace('registry/default/lib/', 'src/lib/').replace('registry/default/hooks/', 'src/hooks/');
    if (!target.startsWith('src/')) throw new Error(`Unexpected path ${target}`);
    await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
    await writeFile(target, file.content.replaceAll('@/registry/default/ui/', '@/components/ui/').replaceAll('@/registry/default/lib/', '@/lib/').replaceAll('@/registry/default/hooks/', '@/hooks/'));
  }
}
for (const name of components) await install(name);
await mkdir('src/lib', { recursive: true });
await writeFile('src/lib/utils.ts', 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n');
console.log(`Installed ${[...seen].join(', ')}`);
console.log(`Dependencies: ${[...dependencies].join(' ')}`);
