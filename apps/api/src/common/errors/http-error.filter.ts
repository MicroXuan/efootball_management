import {
  Catch,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type ErrorBody = {
  code?: string;
  message?: string | string[];
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const response = http.getResponse<{
      setHeader(name: string, value: string): void;
      status(code: number): { json(value: unknown): void };
    }>();
    const requestHeader = request.headers['x-request-id'];
    const requestId = typeof requestHeader === 'string' ? requestHeader : randomUUID();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody = exception instanceof HttpException
      ? exception.getResponse()
      : undefined;
    const normalized = this.normalizeError(exceptionBody, status);

    response.setHeader('x-request-id', requestId);
    response.status(status).json({
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId
      }
    });
  }

  private normalizeError(body: string | object | undefined, status: number) {
    if (typeof body === 'string') {
      return { code: this.defaultCode(status), message: body };
    }

    const typed = (body ?? {}) as ErrorBody;
    const message = Array.isArray(typed.message)
      ? typed.message.join('; ')
      : typed.message;

    return {
      code: typed.code ?? this.defaultCode(status),
      message: message ?? (status === 500 ? 'Internal server error' : 'Request failed')
    };
  }

  private defaultCode(status: number): string {
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
