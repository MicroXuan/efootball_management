import type { ReactElement } from 'react';

export type AdminIconName = 'league' | 'administrators' | 'audit' | 'teams' | 'seasons' | 'valuation' | 'review';

const labels: Record<AdminIconName, string> = {
  league: '联赛',
  administrators: '管理员',
  audit: '审计',
  teams: '球队',
  seasons: '赛季',
  valuation: '身价',
  review: '审核',
};

const paths: Record<AdminIconName, ReactElement> = {
  league: <><path d="M4 18V7l8-3 8 3v11" /><path d="M7 18v-5h10v5M3 20h18" /></>,
  administrators: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5" /><path d="M16 7.5a2.5 2.5 0 0 1 0 5M17 14.5c2.1.5 3.2 2 3.5 4.5" /></>,
  audit: <><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2" /><path d="m8 14 2.5 2.5L16 11" /></>,
  teams: <><path d="m4 6 8-3 8 3-2 13H6L4 6Z" /><path d="M9 11h6M12 8v6" /></>,
  seasons: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2M5 5l2 2M19 5l-2 2" /></>,
  valuation: <><circle cx="12" cy="12" r="8" /><path d="M9 9.5c0-1 1.1-1.8 3-1.8s3 .8 3 1.8-1 1.6-3 2-3 1-3 2 1.1 1.8 3 1.8 3-.8 3-1.8M12 6v12" /></>,
  review: <><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2" /><path d="m8 14 2.5 2.5L16 11" /></>,
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
