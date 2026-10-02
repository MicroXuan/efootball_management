import type { ThemeConfig } from 'antd';

export const adminSemanticColors = Object.freeze({
  sidebar: '#10171B',
  sidebarSelected: '#222D32',
  navText: '#D6DEE1',
  navMuted: '#8A989F',
  workspace: '#F2F5F7',
  surface: '#FFFFFF',
  text: '#182126',
  textSecondary: '#5E6A70',
  border: '#D8E0E4',
  accent: '#B6F13A',
});

export const premiumAdminTheme: ThemeConfig = {
  token: {
    colorPrimary: adminSemanticColors.accent,
    colorPrimaryHover: '#A5DE32',
    colorPrimaryActive: '#93C52C',
    colorPrimaryBorder: '#93C52C',
    colorInfo: '#3277A8',
    colorWarning: '#A76D11',
    colorError: '#C34F47',
    colorText: adminSemanticColors.text,
    colorTextSecondary: adminSemanticColors.textSecondary,
    colorBgLayout: adminSemanticColors.workspace,
    colorBgContainer: adminSemanticColors.surface,
    colorBorder: adminSemanticColors.border,
    controlHeight: 44,
    borderRadius: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { borderRadius: 10, fontWeight: 650 },
    Card: { borderRadiusLG: 14 },
    Input: { borderRadius: 10 },
    InputNumber: { borderRadius: 10 },
    Select: { borderRadius: 10 },
    Table: { headerBg: '#F7F9FA', headerColor: '#5E6A70', rowHoverBg: '#F7FAF2' },
    Tabs: { itemColor: '#5E6A70', itemSelectedColor: '#182126', inkBarColor: '#B6F13A' },
  },
};
