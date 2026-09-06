export const SERVICES = {
  orders: process.env.ORDERS_SERVICE_URL || 'http://orders-api:8080',
  catalog: process.env.CATALOG_SERVICE_URL || 'http://catalog-api:9090',
};
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'kafka:9092';
