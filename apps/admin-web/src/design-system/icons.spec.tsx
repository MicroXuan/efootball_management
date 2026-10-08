import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminIcon } from './icons';

describe('admin navigation icons', () => {
  it('keeps decorative icons out of the accessibility tree', () => {
    const { container } = render(<AdminIcon name="league" decorative />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('names a meaningful icon when it is not decorative', () => {
    const { rerender } = render(<AdminIcon name="seasons" decorative={false} />);
    expect(screen.getByRole('img', { name: '赛季' })).toBeInTheDocument();
    rerender(<AdminIcon name="sync" decorative={false} />);
    expect(screen.getByRole('img', { name: '数据同步' })).toBeInTheDocument();
  });
});
