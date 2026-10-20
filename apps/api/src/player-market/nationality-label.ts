const english = new Intl.DisplayNames(['en'], { type: 'region' });
const chinese = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const countryCodes = new Map<string, string>();

for (let first = 65; first <= 90; first += 1) {
  for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second);
    const label = english.of(code);
    if (label && label !== code) countryCodes.set(label.toLowerCase(), code);
  }
}

const aliases: Record<string, string> = {
  england: '英格兰', scotland: '苏格兰', wales: '威尔士', 'northern ireland': '北爱尔兰',
  'korea republic': '韩国', 'south korea': '韩国', 'korea dpr': '朝鲜',
  'côte d’ivoire': '科特迪瓦', "côte d'ivoire": '科特迪瓦',
  'united states of america': '美国', usa: '美国',
};

export function nationalityLabelZh(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (aliases[normalized]) return aliases[normalized];
  const code = countryCodes.get(normalized);
  return code ? chinese.of(code) ?? value : value;
}
