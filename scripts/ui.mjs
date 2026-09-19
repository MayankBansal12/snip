// Interact with coss controls through their accessible roles.
export const action = (page, name) => page.getByRole('button', { name, exact: true })
  .or(page.getByRole('tab', { name, exact: true }))
  .or(page.getByRole('menuitem', { name, exact: true }));
export async function select(page, label, value) {
  const names = { original: /^Original/, mp4: /^MP4/, webm: /^WebM/, maximum: 'Maximum quality', compact: 'Smaller file', Custom: 'Custom', Free: 'Free', Original: 'Original' };
  let name = names[value];
  if (!name) {
    if (label.includes('resolution')) name = new RegExp(`^${value}p`);
    else if (label.toLowerCase().includes('speed')) name = new RegExp(`^${String(value).replaceAll('.', '\\.')}×`);
    else if (label === 'Canvas aspect ratio') name = new RegExp(` · ${value}$`);
    else name = String(value);
  }
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name, exact: typeof name === 'string' }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
}
