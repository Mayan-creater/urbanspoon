export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    database: 'connected';
  };
}
