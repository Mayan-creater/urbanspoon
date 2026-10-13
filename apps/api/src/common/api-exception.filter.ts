import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

function errorCode(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.UNAUTHORIZED) return 'AUTHENTICATION_REQUIRED';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'SERVICE_UNAVAILABLE';
  return 'REQUEST_FAILED';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException ? exception.getResponse() : undefined;
    const responseObject =
      typeof detail === 'object' && detail !== null
        ? (detail as Record<string, unknown>)
        : undefined;
    const rawMessage = responseObject?.message;
    const details = Array.isArray(rawMessage) ? rawMessage : undefined;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'The request could not be processed.'
          : 'The request could not be processed.';

    response.status(status).json({
      error: {
        code: errorCode(status),
        message,
        ...(details ? { details } : {}),
      },
    });
  }
}
