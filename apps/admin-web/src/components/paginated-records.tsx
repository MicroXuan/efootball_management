import { Pagination } from 'antd';
import { useState, type ReactNode } from 'react';

export function PaginatedRecords<T>({
  items, render, label, pageSize = 10, initialPage = 1
}: {
  items: T[];
  render: (pageItems: T[], offset: number) => ReactNode;
  label: string;
  pageSize?: number;
  initialPage?: number;
}) {
  const [requestedPage, setRequestedPage] = useState(initialPage);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(items.length / pageSize)));
  const offset = (page - 1) * pageSize;
  return <>
    {render(items.slice(offset, offset + pageSize), offset)}
    {items.length > pageSize ? <div className="record-pagination"><Pagination aria-label={label} current={page} pageSize={pageSize} total={items.length} showSizeChanger={false} onChange={setRequestedPage} /></div> : null}
  </>;
}
