from redis import Redis
from json import dumps


if __name__ == "__main__":
    client = Redis()
    topic = "/home/sensors/ABCD1234/current_battery_level"
    json = {"value":60.1,"units":"%"}
    payload = dumps(json).encode('utf-8')
    client.publish(topic, payload)