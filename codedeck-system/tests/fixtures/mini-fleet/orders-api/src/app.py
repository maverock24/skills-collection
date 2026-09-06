import urllib.request, json, os

CATALOG_URL = os.environ.get('CATALOG_SERVICE_URL', 'http://catalog-api:9090')
CONSUME_TOPIC = 'order.created'      # published by checkout-api
PUBLISH_TOPIC = 'order.finalized'

def create_order(items, total):
    with urllib.request.urlopen(f"{CATALOG_URL}/catalog/prices",
                                data=json.dumps({'ids': items}).encode()) as r:
        prices = json.load(r)
    return {"status": "created", "prices": prices}

def on_order_created(msg):
    # kafka consumer handler subscribed to 'order.created'
    return create_order(msg.get('items', []), msg.get('total', 0))

def finalize(order_id):
    kafka_producer.send(PUBLISH_TOPIC, value={"id": order_id})
