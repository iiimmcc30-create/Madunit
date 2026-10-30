export class AppError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly code = "APP_ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string, userMessage: string) {
    super(`${entity} not found: ${id}`, userMessage, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "forbidden") {
    super(message, "هذا الأمر للمالك فقط.", "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, userMessage: string) {
    super(message, userMessage, "CONFLICT");
    this.name = "ConflictError";
  }
}
