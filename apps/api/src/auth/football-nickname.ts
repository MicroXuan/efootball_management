export const FOOTBALL_NICKNAME_STYLES = [
  '疾风', '闪电', '雷霆', '烈焰', '追风', '破晓', '星耀', '飞翼', '灵动',
  '迅捷', '敏锐', '沉着', '冷静', '坚韧', '无畏', '果敢', '精准', '稳健',
  '专注', '执着', '热血', '荣耀', '传奇', '卓越', '非凡', '巅峰', '王牌',
  '黄金', '铁血', '绿茵', '赤焰', '银翼', '战术', '智慧', '勇毅', '从容'
] as const;

export const FOOTBALL_NICKNAME_TITLES = [
  '前锋', '中锋', '边锋', '影锋', '中场', '前腰', '后腰', '边卫', '中卫',
  '门神', '队长', '指挥官', '组织者', '核心', '引擎', '节拍器', '终结者',
  '猎手', '斗士', '铁闸', '屏障', '守护者', '传球手', '盘带手', '突击手',
  '远射手', '自由人', '追梦者'
] as const;

const repetitivePairs = new Set(['铁血铁闸']);

export function generateFootballNickname(random: () => number = Math.random): string {
  const styleIndex = Math.min(
    FOOTBALL_NICKNAME_STYLES.length - 1,
    Math.max(0, Math.floor(random() * FOOTBALL_NICKNAME_STYLES.length))
  );
  let titleIndex = Math.min(
    FOOTBALL_NICKNAME_TITLES.length - 1,
    Math.max(0, Math.floor(random() * FOOTBALL_NICKNAME_TITLES.length))
  );
  const style = FOOTBALL_NICKNAME_STYLES[styleIndex]!;
  let title = FOOTBALL_NICKNAME_TITLES[titleIndex]!;
  if (repetitivePairs.has(`${style}${title}`)) {
    titleIndex = (titleIndex + 1) % FOOTBALL_NICKNAME_TITLES.length;
    title = FOOTBALL_NICKNAME_TITLES[titleIndex]!;
  }
  return `${style}${title}`;
}
