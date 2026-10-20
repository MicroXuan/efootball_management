import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaginatedRecords } from './paginated-records';

it('shows ten records at a time and allows moving to later records', async () => {
  const items = Array.from({ length: 12 }, (_, index) => `记录${index + 1}`);
  render(<PaginatedRecords items={items} label="记录分页" render={(page) => <div>{page.map((item) => <p key={item}>{item}</p>)}</div>} />);
  expect(screen.getByText('记录1')).toBeInTheDocument();
  expect(screen.queryByText('记录11')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('listitem', { name: '2' }));
  expect(screen.getByText('记录11')).toBeInTheDocument();
  expect(screen.queryByText('记录1')).not.toBeInTheDocument();
});
