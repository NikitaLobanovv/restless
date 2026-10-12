-- pg_trgm нужен для GIN-индексов поиска по requests.name / requests.url
CREATE EXTENSION IF NOT EXISTS pg_trgm;
