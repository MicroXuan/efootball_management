import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  it('returns normalized parsed values', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string().trim().min(1) }));

    expect(pipe.transform({ name: '  player  ' })).toEqual({ name: 'player' });
  });

  it('returns stable field errors without leaking Zod internals', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1) }));

    try {
      pipe.transform({ name: '' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        fields: [{ path: 'name', message: 'Too small: expected string to have >=1 characters' }]
      });
    }
  });
});

