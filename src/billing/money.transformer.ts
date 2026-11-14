import { ValueTransformer } from 'typeorm';

// Postgres returns decimal columns as strings, SQLite as numbers. Always expose numbers.
export const moneyTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) => (value === null || value === undefined ? value : Number(value)),
};
