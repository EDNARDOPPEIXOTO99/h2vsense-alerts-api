/** Erros de domínio. A camada HTTP traduz cada um para o status adequado. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Violação de regra/invariante (vira 422). */
export class InvalidReadingError extends DomainError {}

/** Recurso não encontrado (vira 404). */
export class AlertNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Alerta ${id} não encontrado`);
  }
}

/** Transição de estado inválida (vira 409). */
export class AlertAlreadyAcknowledgedError extends DomainError {
  constructor(id: string) {
    super(`Alerta ${id} já foi reconhecido`);
  }
}

/** Configuração de política inválida (falha no boot). */
export class InvalidPolicyError extends DomainError {}

/**
 * Lançado pelo repositório quando já existe alerta aberto para o sensor
 * (índice único parcial no banco). O caso de uso trata com uma nova tentativa.
 */
export class OpenAlertConflictError extends DomainError {
  constructor(sensorId: string) {
    super(`Já existe alerta aberto para o sensor ${sensorId}`);
  }
}
