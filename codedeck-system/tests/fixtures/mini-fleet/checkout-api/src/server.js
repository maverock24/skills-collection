// Checkout service. Fans out to orders and catalog on every checkout.
import http from 'node:http';

const ORDERS_URL = process.env.ORDERS_SERVICE_URL || 'http://orders-api:8080';
const CATALOG_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-api:9090';
const KAFKA = process.env.KAFKA_BROKERS || 'kafka:9092';
const TOPIC = 'order.created';

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

export async function checkout(cart) {
  const total = await getJSON(`${CATALOG_URL}/catalog/items?ids=${cart.ids.join(',')}`);
  const order = await fetch(`${ORDERS_URL}/orders`, { method: 'POST',
    body: JSON.stringify({ items: cart.ids, total }) });
  publish(TOPIC, order);              // -> orders-api consumes 'order.created'
  return order;
}

function publish(topic, msg) {
  // kafka producer stub; real impl emits to KAFKA broker.
  console.log(`[checkout] published ${topic}`);
}
