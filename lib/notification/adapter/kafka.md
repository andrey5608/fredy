### Kafka / Redpanda Adapter

Publishes listings to a Kafka topic. Works with Apache Kafka and with Redpanda. Photos are
**not** sent; follow `url` for the advert.

The topic defaults to `fredy.<jobId>`, one per job; fill in **Topic** to send every job to the same one.
Redpanda creates a missing topic on first use.

Authentication is off unless you fill in a SASL username (mechanism `plain`, `scram-sha-256` or
`scram-sha-512`); **TLS** is its own switch.

Fredy's `docker-compose.yml` starts a Redpanda broker next to Fredy.

| Where Fredy runs | Brokers |
|---|---|
| Inside the compose stack | `redpanda:9092` |
| On your machine (`yarn start`) | `localhost:19092` |

Read the topic from your machine:

```
rpk topic consume 'fredy.<jobId>' --brokers localhost:19092
```

One message per listing. The key is the listing id.

```json
{
  "event": "newListing",
  "jobId": "mg1waX4RHmIzL5NDYtYp-",
  "provider": "immowelt",
  "timestamp": "2026-11-01T12:34:56.000Z",
  "listing": {
    "id": "123456789",
    "title": "Schöne 1-Zimmer-Wohnung in Bielefeld",
    "price": "1.240 €",
    "size": "38 m²",
    "rooms": 1,
    "address": "Str. 123, Bielefeld, Germany",
    "description": "Möbliert: Einziehen & wohlfühlen: Neu möbliert.",
    "url": "https://<target-url>.com/listings/123456789",
    "fredyUrl": "http://localhost:9998/#/listings/listing/123456789"
  }
}
```

Price changes arrive on the same topic with `"event": "priceChange"` and the extra fields
`oldPrice`, `newPrice`, `changePercent` and `direction` inside `listing`.
