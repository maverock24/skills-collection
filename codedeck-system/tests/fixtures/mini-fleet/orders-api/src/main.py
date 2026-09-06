from app import on_order_created
# consumer bootstrap: subscribe to 'order.created'
def start():
    kafka_client.subscribe('order.created')
    while True:
        msg = kafka_client.poll()
        if msg:
            on_order_created(msg)
