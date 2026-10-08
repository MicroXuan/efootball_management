import type { ReactElement } from 'react';

export type AdminIconName = 'league' | 'administrators' | 'audit' | 'sync' | 'teams' | 'seasons' | 'allocation' | 'cup' | 'salary' | 'transfer' | 'valuation' | 'review' | 'finance';

const labels: Record<AdminIconName, string> = {
  league: '联赛',
  administrators: '管理员',
  audit: '审计',
  sync: '数据同步',
  teams: '球队',
  seasons: '赛季',
  allocation: '分组与赛程',
  cup: '杯赛',
  salary: '工资',
  transfer: '转会',
  valuation: '身价',
  review: '审核',
  finance: '财务',
};

const paths: Record<AdminIconName, ReactElement> = {
  league: <><path d="M4 18V7l8-3 8 3v11" /><path d="M7 18v-5h10v5M3 20h18" /></>,
  administrators: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5" /><path d="M16 7.5a2.5 2.5 0 0 1 0 5M17 14.5c2.1.5 3.2 2 3.5 4.5" /></>,
  audit: <><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2" /><path d="m8 14 2.5 2.5L16 11" /></>,
  sync: <><path d="M20 7h-5V2" /><path d="M20 7a8 8 0 0 0-13.7-2.8L4 7" /><path d="M4 17h5v5" /><path d="M4 17a8 8 0 0 0 13.7 2.8L20 17" /></>,
  teams: <><path d="m4 6 8-3 8 3-2 13H6L4 6Z" /><path d="M9 11h6M12 8v6" /></>,
  seasons: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2M5 5l2 2M19 5l-2 2" /></>,
  allocation: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 6h8M7.5 7.5l3.3 8.6M16.5 7.5l-3.3 8.6" /></>,
  cup: <><path d="M8 4h8v4c0 4-1.8 6-4 6s-4-2-4-6V4Z" /><path d="M8 6H5v2c0 2 1.2 3 3.5 3M16 6h3v2c0 2-1.2 3-3.5 3M12 14v4M8 20h8" /></>,
  salary: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h3M8 16h2M14 15.5h2" /></>,
  transfer: <><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" /></>,
  valuation: <><circle cx="12" cy="12" r="8" /><path d="M9 9.5c0-1 1.1-1.8 3-1.8s3 .8 3 1.8-1 1.6-3 2-3 1-3 2 1.1 1.8 3 1.8 3-.8 3-1.8M12 6v12" /></>,
  review: <><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2" /><path d="m8 14 2.5 2.5L16 11" /></>,
  finance: <><path d="M4 6h16v13H4zM4 9h16" /><path d="M8 14h3M15 14h1M8 17h8" /></>,
};

export function AdminIcon({ name, decorative = true }: {
  name: AdminIconName;
  decorative?: boolean;
}): ReactElement {
  return <svg
    className="admin-icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={decorative ? 'true' : undefined}
    aria-label={decorative ? undefined : labels[name]}
    role={decorative ? undefined : 'img'}
    focusable="false"
  >{paths[name]}</svg>;
}
